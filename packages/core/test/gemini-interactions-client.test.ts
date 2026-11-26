import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  bootstrapCanvas,
  CANDIDATE_SELECTOR_PATCH_JSON_SCHEMA,
  createCorridorBaseCanvasWebp,
  createGeminiInteractionsClient,
  createInMemoryGridlockRepository,
  PAINTER_AGENT_MODEL,
  UI_ORCHESTRATION_AGENT_MODEL,
  type GeminiInteractionCreateRequest,
} from "../src/index.ts";
import {
  createPainterTestObservations,
  createTestProject,
  createTestRawCapture,
  GZIP_HTML_STUB,
} from "./helpers/fixtures.ts";

describe("Gemini v1 Interactions Client Adapter (Ticket #11 Slice 1a)", () => {
  test("Happy Path: forwards structured JSON + image requests, defaults painter turns to image response_format, and normalizes steps, usage, and errors", async () => {
    const baseWebpBase64 = createCorridorBaseCanvasWebp(
      "texas-corridor-main"
    ).toString("base64");
    const seenPayloads: Record<string, unknown>[] = [];
    const client = createGeminiInteractionsClient({
      sdkClient: {
        interactions: {
          async create(params) {
            seenPayloads.push(params);
            if (seenPayloads.length === 1) {
              return {
                id: "inter_json_1",
                status: "completed",
                previous_interaction_id: "inter_prev_0",
                steps: [
                  {
                    type: "user_input",
                    content: [{ type: "text", text: "old" }],
                  },
                  {
                    type: "model_output",
                    content: [
                      { type: "text", text: '{"rootCauseSummary":' },
                      { type: "text", text: '"selector drift"}' },
                    ],
                  },
                ],
                usage: { total_tokens: 185 },
              };
            }
            if (seenPayloads.length === 2) {
              return {
                id: "inter_err_2",
                status: "failed",
                error: { code: "RESOURCE_EXHAUSTED", message: "Quota reached" },
                errors: [{ code: "429", message: "Rate limit" }],
              };
            }
            return {
              id: "inter_paint_3",
              status: "completed",
              steps: [
                {
                  type: "model_output",
                  content: [
                    {
                      type: "image",
                      mime_type: "image/webp",
                      data: baseWebpBase64,
                    },
                  ],
                },
              ],
              usage: { total_tokens: 320 },
            };
          },
        },
      },
    });

    const jsonReq: GeminiInteractionCreateRequest = {
      model: UI_ORCHESTRATION_AGENT_MODEL,
      input: "Plan workspace",
      previous_interaction_id: "inter_prev_0",
      store: false,
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: CANDIDATE_SELECTOR_PATCH_JSON_SCHEMA,
      },
    };
    const jsonRes = await client.interactions.create(jsonReq);
    assert.equal(seenPayloads[0]?.model, UI_ORCHESTRATION_AGENT_MODEL);
    assert.equal(seenPayloads[0]?.input, "Plan workspace");
    assert.equal(seenPayloads[0]?.previous_interaction_id, "inter_prev_0");
    assert.equal(seenPayloads[0]?.store, false);
    assert.deepEqual(seenPayloads[0]?.response_format, {
      type: "text",
      mime_type: "application/json",
      schema: CANDIDATE_SELECTOR_PATCH_JSON_SCHEMA,
    });
    assert.equal(jsonRes.output_text, '{"rootCauseSummary":"selector drift"}');
    assert.equal(jsonRes.usage?.total_tokens, 185);

    const errRes = await client.interactions.create({
      model: PAINTER_AGENT_MODEL,
      input: "Paint corridor",
      response_format: {
        type: "image",
        aspect_ratio: "16:9",
        image_size: "1K",
      },
    });
    assert.deepEqual(seenPayloads[1]?.response_format, {
      type: "image",
      aspect_ratio: "16:9",
      image_size: "1K",
    });
    assert.equal(errRes.errors?.length, 2);
    assert.equal(errRes.errors?.[1]?.code, "RESOURCE_EXHAUSTED");

    const repository = createInMemoryGridlockRepository();
    const { milestoneObs } = createPainterTestObservations();
    const artifact = createTestRawCapture(
      milestoneObs.rawCaptureHash,
      milestoneObs.projectNumber
    );
    await repository.saveRawCapture(artifact, GZIP_HTML_STUB);
    await repository.upsertProject(
      createTestProject(milestoneObs.projectNumber, artifact.sha256)
    );
    await repository.appendObservation(milestoneObs);

    const boot = await bootstrapCanvas(
      { lineageId: "texas-corridor-main", observations: [milestoneObs] },
      { repository, geminiClient: client }
    );
    assert.equal(boot.status, "plate_painted");
    assert.deepEqual(seenPayloads[2]?.response_format, { type: "image" });
    const bootInput = seenPayloads[2]?.input as Array<{
      type?: string;
      content?: Array<{ type?: string }>;
    }>;
    assert.equal(Array.isArray(bootInput), true);
    assert.equal(bootInput.length, 1);
    assert.equal(bootInput[0]?.type, "user_input");
    assert.deepEqual(
      bootInput[0]?.content?.map((block) => block.type),
      ["text", "image"]
    );

    const wrappedStep = [
      { type: "user_input", content: [{ type: "text", text: "Already wrapped" }] },
    ];
    await client.interactions.create({
      model: UI_ORCHESTRATION_AGENT_MODEL,
      input: wrappedStep,
    });
    assert.deepEqual(seenPayloads[3]?.input, wrappedStep);

    await client.interactions.create({
      model: UI_ORCHESTRATION_AGENT_MODEL,
      input: [],
    });
    assert.deepEqual(seenPayloads[4]?.input, []);

    const mixedSteps = [
      { type: "user_input", content: [{ type: "text", text: "Prior turn" }] },
      { type: "text", text: "Loose trailing block" },
    ];
    await client.interactions.create({
      model: UI_ORCHESTRATION_AGENT_MODEL,
      input: mixedSteps,
    });
    assert.deepEqual(seenPayloads[5]?.input, mixedSteps);
  });

  test("Sad Path: rejects omitted, empty, and whitespace API keys without echoing key material", () => {
    const invalidConfigs = [
      {},
      { apiKey: undefined },
      { apiKey: "" },
      { apiKey: "   " },
    ];
    for (const config of invalidConfigs) {
      assert.throws(
        () => createGeminiInteractionsClient(config),
        (err: unknown) =>
          err instanceof Error &&
          err.message ===
            "createGeminiInteractionsClient requires a non-empty Gemini API key or sdkClient"
      );
    }
  });
});
