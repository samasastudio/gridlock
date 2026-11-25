import { Buffer } from "node:buffer";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  bootstrapCanvas,
  CANDIDATE_SELECTOR_PATCH_JSON_SCHEMA,
  CandidateSelectorPatchSchema,
  createGeminiInteractionsClient,
  createInMemoryGridlockRepository,
  createSharpImageEncoder,
  isWebpBuffer,
  ObservationSchema,
  paintMilestoneDelta,
  REPAIR_AGENT_MODEL,
  SCENARIO_BRANCH_WATERMARK,
  sharpImageEncoder,
} from "../src/index.ts";
import {
  createPainterTestObservations,
  createTestProject,
  createTestSourceArtifact,
  GZIP_HTML_STUB,
} from "./helpers/fixtures.ts";
import { withGridlockTestServer } from "./helpers/planner-test-helpers.ts";

function createSolidRaster(width: number, height: number, channels: 3 | 4 = 3) {
  return sharp({
    create: {
      width,
      height,
      channels,
      background:
        channels === 4
          ? { r: 220, g: 215, b: 204, alpha: 1 }
          : { r: 232, g: 226, b: 214 },
    },
  });
}

describe("Sharp WebP Image Encoder Adapter & Smoke Step 2 (Ticket #11 Slice 1b)", () => {
  test("Happy Path: sharpImageEncoder transcodes JPEG/PNG/WebP payloads, clamps non-finite quality, drives bootstrapCanvas and POST /api/plates/branch on JPEG outputs, and stamps crimson/ivory banner + XMP rights", async () => {
    const [jpegBuf, pngBuf, webpBuf] = await Promise.all([
      createSolidRaster(360, 200, 3).jpeg({ quality: 92 }).toBuffer(),
      createSolidRaster(240, 140, 4).png().toBuffer(),
      createSolidRaster(240, 140, 3).webp().toBuffer(),
    ]);

    for (const [mimeType, srcBuf] of [
      ["image/jpeg", jpegBuf],
      ["image/png", pngBuf],
      ["image/webp", webpBuf],
    ] as const) {
      const encoded = await createSharpImageEncoder({ quality: 88 })({
        mime_type: mimeType,
        data: srcBuf.toString("base64"),
      });
      assert.equal(encoded.ok, true);
      if (encoded.ok) {
        assert.equal(isWebpBuffer(encoded.webpBuffer), true);
        assert.equal(encoded.sha256.length, 64);
      }
    }

    for (const nonFiniteQuality of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const fallbackEncoded = await createSharpImageEncoder({
        quality: nonFiniteQuality,
      })({
        mime_type: "image/jpeg",
        data: jpegBuf.toString("base64"),
      });
      assert.equal(fallbackEncoded.ok, true);
      if (fallbackEncoded.ok) {
        assert.equal(isWebpBuffer(fallbackEncoded.webpBuffer), true);
      }
    }

    const repository = createInMemoryGridlockRepository();
    const { milestoneObs } = createPainterTestObservations();
    const artifact = createTestSourceArtifact(
      milestoneObs.sourceArtifactHash,
      milestoneObs.projectNumber
    );
    await repository.saveSourceArtifact(artifact, GZIP_HTML_STUB);
    await repository.upsertProject(
      createTestProject(milestoneObs.projectNumber, artifact.sha256)
    );
    await repository.appendObservation(milestoneObs);

    const capturedSdkRequests: Record<string, unknown>[] = [];
    const geminiClient = createGeminiInteractionsClient({
      sdkClient: {
        interactions: {
          async create(params) {
            capturedSdkRequests.push(params);
            return {
              id: `inter_jpeg_${capturedSdkRequests.length}`,
              status: "completed",
              steps: [
                {
                  type: "model_output",
                  content: [
                    {
                      type: "image",
                      mime_type: "image/jpeg",
                      data: jpegBuf.toString("base64"),
                    },
                  ],
                },
              ],
              usage: { total_tokens: 410 },
            };
          },
        },
      },
    });

    const boot = await bootstrapCanvas(
      { lineageId: "texas-corridor-main", observations: [milestoneObs] },
      { repository, geminiClient, imageEncoder: sharpImageEncoder }
    );
    assert.equal(boot.status, "plate_painted");
    assert.deepEqual(capturedSdkRequests[0]?.response_format, {
      type: "image",
    });

    await withGridlockTestServer(
      { repository, geminiClient, imageEncoder: sharpImageEncoder },
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/plates/branch`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            interactionId: "inter_jpeg_1",
            scenarioPrompt: "Simulate +500MW substation interconnection",
          }),
        });
        assert.equal(res.status, 201);
        const body = (await res.json()) as {
          plate: { plateId: string; watermarkText: string };
        };
        assert.equal(body.plate.watermarkText, SCENARIO_BRANCH_WATERMARK);
        assert.deepEqual(capturedSdkRequests[1]?.response_format, {
          type: "image",
        });

        const assetRes = await fetch(
          `${baseUrl}/api/plates/assets/${encodeURIComponent(body.plate.plateId)}.webp`
        );
        assert.equal(assetRes.status, 200);
        const branchWebp = Buffer.from(await assetRes.arrayBuffer());
        assert.equal(isWebpBuffer(branchWebp), true);

        const meta = await sharp(branchWebp).metadata();
        const xmpText = meta.xmp?.toString("utf-8") ?? "";
        assert.ok(
          xmpText.includes(
            `<dc:rights>${SCENARIO_BRANCH_WATERMARK}</dc:rights>`
          )
        );

        const { data: rawPixels, info } = await sharp(branchWebp)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const topBannerRowCount = 12;
        const bannerPixels = Array.from(
          { length: info.width * topBannerRowCount },
          (_, idx) => ({
            r: rawPixels[idx * 4] ?? 0,
            g: rawPixels[idx * 4 + 1] ?? 0,
            b: rawPixels[idx * 4 + 2] ?? 0,
          })
        );
        assert.ok(
          bannerPixels.some((p) => p.r > 130 && p.g < 75 && p.b < 75),
          "Expected crimson banner background pixels in top rows"
        );
        assert.ok(
          bannerPixels.some((p) => p.r > 210 && p.g > 205 && p.b > 195),
          "Expected ivory watermark glyph pixels in top rows"
        );
      }
    );
  });

  test("Sad Path: fails closed on empty, invalid base64, corrupt, unsupported GIF/SVG, or oversized (>4096) images", async () => {
    const svgBytes = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>',
      "utf-8"
    );
    const gifBytes = Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      "base64"
    );
    const oversizedPng = await sharp({
      create: {
        width: 4_100,
        height: 16,
        channels: 3,
        background: { r: 100, g: 100, b: 100 },
      },
    })
      .png()
      .toBuffer();

    const invalidInputs = [
      null,
      { data: "" },
      { data: "%%%not-base64%%%" },
      { data: Buffer.from("not-an-image").toString("base64") },
      { mime_type: "image/gif", data: gifBytes.toString("base64") },
      { mime_type: "image/svg+xml", data: svgBytes.toString("base64") },
      { mime_type: "image/png", data: oversizedPng.toString("base64") },
    ];
    for (const badBlock of invalidInputs) {
      const res = await sharpImageEncoder(badBlock);
      assert.equal(res.ok, false);
    }

    const repository = createInMemoryGridlockRepository();
    const { milestoneObs } = createPainterTestObservations();
    const failedBoot = await bootstrapCanvas(
      { lineageId: "sad-corridor", observations: [milestoneObs] },
      {
        repository,
        imageEncoder: sharpImageEncoder,
        geminiClient: {
          interactions: {
            create: async () => ({
              id: "inter_bad_gif",
              status: "completed",
              output_image: {
                mime_type: "image/gif",
                data: gifBytes.toString("base64"),
              },
              usage: { total_tokens: 120 },
            }),
          },
        },
      }
    );
    assert.equal(failedBoot.status, "painter_failed");
    if (failedBoot.status === "painter_failed") {
      assert.equal(failedBoot.errorCode, "corrupt_or_empty_image");
    }
  });

  test(
    "Smoke Step 2: live Gemini v1 Interactions Turn 1 + Turn 2 previous_interaction_id WebP chaining and Flash JSON schema (opt-in via LIVE_GEMINI_TEST=1)",
    { skip: process.env.LIVE_GEMINI_TEST !== "1" },
    async () => {
      const geminiClient = createGeminiInteractionsClient({
        apiKey: process.env.GEMINI_API_KEY,
      });
      const repository = createInMemoryGridlockRepository();
      const { milestoneObs } = createPainterTestObservations();
      const secondMilestone = ObservationSchema.parse({
        ...milestoneObs,
        id: "obs_TABS2027003697_m2",
        status: "Construction Complete",
        observedAt: "2026-10-28T14:05:00.000Z",
      });

      const turn1 = await bootstrapCanvas(
        { lineageId: "smoke-corridor", observations: [milestoneObs] },
        { repository, geminiClient, imageEncoder: sharpImageEncoder }
      );
      assert.equal(
        turn1.status,
        "plate_painted",
        turn1.status === "painter_failed"
          ? `${turn1.errorCode}: ${turn1.reason}`
          : undefined
      );
      assert.equal(isWebpBuffer(turn1.webpBuffer), true);

      const turn2 = await paintMilestoneDelta(
        { lineageId: "smoke-corridor", observations: [secondMilestone] },
        { repository, geminiClient, imageEncoder: sharpImageEncoder }
      );
      assert.equal(
        turn2.status,
        "plate_painted",
        turn2.status === "painter_failed"
          ? `${turn2.errorCode}: ${turn2.reason}`
          : undefined
      );
      assert.equal(isWebpBuffer(turn2.webpBuffer), true);
      assert.equal(turn2.plate.turnNumber, 2);
      assert.equal(turn2.rebootstrappedFromParentWebp, false);
      assert.equal(turn2.plate.parentInteractionId, turn1.plate.interactionId);

      const flashJson = await geminiClient.interactions.create({
        model: REPAIR_AGENT_MODEL,
        store: false,
        input:
          'Return a minimal selector repair patch JSON with rootCauseSummary set to "smoke test ok".',
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: CANDIDATE_SELECTOR_PATCH_JSON_SCHEMA,
        },
      });
      assert.equal(flashJson.status, "completed");
      const parsedPatch = CandidateSelectorPatchSchema.parse(
        JSON.parse(flashJson.output_text ?? "{}")
      );
      assert.ok(parsedPatch.rootCauseSummary.length > 0);
    }
  );
});
