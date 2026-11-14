import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, test } from "node:test";
import {
  ARTIFACT_BUCKET_URI,
  bootstrapCanvas,
  branchLineage,
  BranchPlateRequestSchema,
  BranchPlateResponseSchema,
  createGridlockHttpServer,
  createInMemoryGridlockRepository,
  DEFAULT_LINEAGE_ID,
  isWebpBuffer,
  LineageNodeSchema,
  MAX_SCENARIO_PROMPT_LENGTH,
  NINETY_DAYS_MS,
  ObservationSchema,
  paintMilestoneDelta,
  PlateLineageResponseSchema,
  SCENARIO_BRANCH_WATERMARK,
  SourceArtifactSchema,
  VisualPlateSchema,
  type GeminiInteractionCreateRequest,
  type GeminiInteractionResponse,
  type GeminiInteractionsClient,
  type GridlockHttpDeps,
  type GridlockRepository,
} from "../src/index.ts";
import {
  createFixtureWebpBuffer,
  createPainterTestObservations,
} from "./helpers/fixtures.ts";

async function withPlatesServer(
  deps: GridlockHttpDeps,
  run: (baseUrl: string) => Promise<void>
): Promise<void> {
  const server = createGridlockHttpServer(deps);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

function postJson(url: string, body: string): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

async function assertErr(
  resPromise: Promise<Response>,
  expectedStatus: number,
  expectedError: string
): Promise<Response> {
  const res = await resPromise;
  assert.equal(res.status, expectedStatus);
  const payload = (await res.json()) as { error: string };
  assert.equal(payload.error, expectedError);
  return res;
}

async function seedLineageGraph() {
  const repository = createInMemoryGridlockRepository();
  const { milestoneObs: obs1 } = createPainterTestObservations();

  const h1 = "a".repeat(64);
  const h2 = "b".repeat(64);
  const hAged = "c".repeat(64);
  const hQuar = "d".repeat(64);
  const gzBuffer = Buffer.from("gz");

  const mkArtifact = (
    sha256: string,
    storageUri: string,
    expiresAt: string | null
  ) =>
    SourceArtifactSchema.parse({
      sha256,
      connectorId: "tdlr-tabs",
      sourceUrl: `https://www.tdlr.texas.gov/TABS/Search/Project/${sha256.slice(0, 8)}`,
      contentType: "text/html",
      rawByteLength: 512,
      compressedByteLength: 128,
      storageUri,
      capturedAt: "2026-10-27T14:00:00.000Z",
      expiresAt,
      referencedByMilestone: false,
    });

  for (const [hash, dir] of [
    [h1, "artifacts"],
    [h2, "artifacts"],
    [hQuar, "quarantine"],
  ] as const) {
    await repository.saveSourceArtifact(
      mkArtifact(
        hash,
        `${ARTIFACT_BUCKET_URI}/${dir}/${hash}.gz`,
        "2027-01-25T14:00:00.000Z"
      ),
      gzBuffer
    );
  }

  const [obs2, obsAged, obsQuar] = [h2, hAged, hQuar].map((hash, index) =>
    ObservationSchema.parse({
      ...obs1,
      id: `obs_TABS2027003697_m${index + 2}`,
      sourceArtifactHash: hash,
      observedAt: `2026-10-27T14:1${index}:00.000Z`,
    })
  );
  for (const obs of [obs1, obs2, obsAged, obsQuar]) {
    await repository.appendObservation(obs);
  }

  let seq = 0;
  const geminiClient: GeminiInteractionsClient = {
    interactions: {
      create: async () => ({
        id: `inter_seed_${++seq}`,
        status: "completed",
        output_image: {
          mime_type: "image/webp",
          data: createFixtureWebpBuffer(`seed-${seq}`).toString("base64"),
        },
        usage: { total_tokens: 120 },
      }),
    },
  };

  const t1 = await bootstrapCanvas(
    { observations: [obs1], now: new Date("2026-10-27T14:05:00.000Z") },
    { repository, geminiClient }
  );
  const t2 = await paintMilestoneDelta(
    {
      observations: [obs2, obsAged, obsQuar],
      now: new Date("2026-10-27T14:15:00.000Z"),
    },
    { repository, geminiClient }
  );
  await repository.saveSourceArtifact(
    mkArtifact(
      hAged,
      `${ARTIFACT_BUCKET_URI}/artifacts/${hAged}.gz`,
      "2026-11-16T00:00:00.000Z"
    ),
    gzBuffer
  );
  const b1 = await branchLineage(
    {
      parentInteractionId: t2.status === "plate_painted" ? t2.plate.interactionId : "",
      scenarioPrompt: "Simulate +400MW interconnection delay",
      now: new Date("2026-10-27T14:20:00.000Z"),
    },
    { repository, geminiClient }
  );
  const b2 = await branchLineage(
    {
      parentInteractionId: b1.status === "plate_painted" ? b1.plate.interactionId : "",
      scenarioPrompt: "Add ERCOT transmission constraint",
      now: new Date("2026-12-10T14:20:00.000Z"),
    },
    { repository, geminiClient }
  );

  assert.equal(t1.status, "plate_painted");
  assert.equal(t2.status, "plate_painted");
  assert.equal(b1.status, "plate_painted");
  assert.equal(b2.status, "plate_painted");

  return {
    repository,
    obs1,
    t1: t1.plate,
    t2: t2.plate,
    b1: b1.plate,
    b2: b2.plate,
    h1,
    h2,
    hAged,
    hQuar,
  };
}

describe("GET /api/plates/lineage HTTP Seam (Seam 3 API, Ticket #33 Phase 1)", () => {
  test("Empty lineage returns 200 across default and explicit unknown lineage_id, and schema rejects broken cross-record invariants", async () => {
    await withPlatesServer(
      { repository: createInMemoryGridlockRepository() },
      async (baseUrl) => {
        for (const [suffix, expectedId] of [
          ["", DEFAULT_LINEAGE_ID],
          ["?lineage_id=unknown-corridor", "unknown-corridor"],
        ] as const) {
          const res = await fetch(`${baseUrl}/api/plates/lineage${suffix}`);
          assert.equal(res.status, 200);
          assert.equal(res.headers.get("cache-control"), "no-store");
          assert.deepEqual(PlateLineageResponseSchema.parse(await res.json()), {
            lineageId: expectedId,
            activeCanonicalPlateId: null,
            nodes: [],
            edges: [],
          });
        }
      }
    );

    assert.throws(() =>
      PlateLineageResponseSchema.parse({
        lineageId: DEFAULT_LINEAGE_ID,
        activeCanonicalPlateId: "ghost",
        nodes: [],
        edges: [],
      })
    );

    const { obs1, t1, t2 } = await seedLineageGraph();
    assert.equal(VisualPlateSchema.safeParse({ ...t1, plateId: "plate/1" }).success, false);
    assert.equal(VisualPlateSchema.safeParse({ ...t1, lineageId: "austin/north" }).success, false);
    assert.equal(VisualPlateSchema.safeParse({ ...t1, lineageId: "austin north" }).success, false);
    const t1NodeBase = {
      plate: t1,
      assetPath: `/api/plates/assets/${t1.plateId}.webp`,
      triggeringObservations: [obs1],
      sourceArtifacts: [],
    };
    assert.equal(
      LineageNodeSchema.safeParse({
        ...t1NodeBase,
        assetPath: "/api/plates/assets/other_plate.webp",
      }).success,
      false
    );
    assert.equal(
      LineageNodeSchema.safeParse({
        ...t1NodeBase,
        triggeringObservations: [{ ...obs1, id: "obs_unreferenced" }],
      }).success,
      false
    );
    assert.equal(
      PlateLineageResponseSchema.safeParse({
        lineageId: DEFAULT_LINEAGE_ID,
        activeCanonicalPlateId: t1.plateId,
        nodes: [t1NodeBase],
        edges: [
          {
            parentInteractionId: t1.interactionId,
            childInteractionId: t2.interactionId,
            parentPlateId: t1.plateId,
            childPlateId: t2.plateId,
            isBranch: false,
          },
        ],
      }).success,
      false
    );
  });

  test("Hydrates multi-turn canonical + branch graph and enforces +90d branch TTL, non-milestone artifact expiry, and quarantine filtering", async () => {
    const { repository, obs1, t1, t2, b1, b2, h1, h2, hAged, hQuar } =
      await seedLineageGraph();
    let clock = new Date("2026-11-01T00:00:00.000Z");

    await withPlatesServer(
      { repository, now: () => clock },
      async (baseUrl) => {
        const initialRes = await fetch(`${baseUrl}/api/plates/lineage`);
        const initial = PlateLineageResponseSchema.parse(await initialRes.json());

        assert.equal(initial.activeCanonicalPlateId, t2.plateId);
        assert.deepEqual(
          initial.nodes.map((node) => node.plate.plateId),
          [t1.plateId, t2.plateId, b1.plateId, b2.plateId]
        );
        assert.deepEqual(initial.nodes[0]?.triggeringObservations, [obs1]);
        assert.equal(
          initial.nodes[2]?.plate.epistemicLabel,
          SCENARIO_BRANCH_WATERMARK
        );
        assert.equal(initial.nodes[0]?.sourceArtifacts[0]?.sha256, h1);
        assert.equal(
          initial.nodes[0]?.sourceArtifacts[0]?.referencedByMilestone,
          true
        );
        assert.deepEqual(
          initial.nodes[1]?.sourceArtifacts.map((art) => art.sha256),
          [h2, hAged]
        );
        assert.deepEqual(initial.nodes[1]?.plate.sourceArtifactHashes, [
          h2,
          hAged,
          hQuar,
        ]);
        assert.equal(initial.edges.length, 3);

        clock = new Date(Date.parse(b1.createdAt) + NINETY_DAYS_MS + 1_000);
        const afterTtlRes = await fetch(`${baseUrl}/api/plates/lineage`);
        const afterTtl = PlateLineageResponseSchema.parse(await afterTtlRes.json());

        assert.deepEqual(
          afterTtl.nodes.map((node) => node.plate.plateId),
          [t1.plateId, t2.plateId, b2.plateId]
        );
        assert.equal(afterTtl.nodes[2]?.plate.parentInteractionId, b1.interactionId);
        assert.deepEqual(afterTtl.edges, [
          {
            parentInteractionId: t1.interactionId,
            childInteractionId: t2.interactionId,
            parentPlateId: t1.plateId,
            childPlateId: t2.plateId,
            isBranch: false,
          },
        ]);
        assert.deepEqual(
          afterTtl.nodes[1]?.sourceArtifacts.map((art) => art.sha256),
          [h2]
        );
      }
    );
  });

  test("Enforces 400 strict single-value query params, 405 Allow: GET, and 500 fail-closed storage corruption with clean 200 recovery", async () => {
    const { repository, t1 } = await seedLineageGraph();
    let fault: "none" | "plate" | "obs" | "art" | "throw" = "none";

    const proxyRepo: GridlockRepository = {
      ...repository,
      listVisualPlatesByLineage: async (id) => {
        if (fault === "throw") {
          throw new Error("db down");
        }
        if (fault === "plate") {
          return [{ ...t1, lineageId: "wrong" }] as never;
        }
        return repository.listVisualPlatesByLineage(id);
      },
      listObservationsByProject: async (projectNumber) =>
        fault === "obs"
          ? ([{ id: "bad" }] as never)
          : repository.listObservationsByProject(projectNumber),
      getSourceArtifactByHash: async (hash) =>
        fault === "art"
          ? ({ sha256: "mismatch" } as never)
          : repository.getSourceArtifactByHash(hash),
    };

    await withPlatesServer(
      { repository: proxyRepo, now: () => new Date("2026-11-01T00:00:00.000Z") },
      async (baseUrl) => {
        for (const bad of [
          "?lineage_id=a&lineage_id=b",
          "?lineage_id=%20",
          "?lineage_id=austin%2Fnorth",
          "?lineage_id=..",
          "?lineage_id=.",
          "?foo=1",
        ]) {
          await assertErr(
            fetch(`${baseUrl}/api/plates/lineage${bad}`),
            400,
            "invalid_query_parameters"
          );
        }

        const methodErr = await assertErr(
          fetch(`${baseUrl}/api/plates/lineage`, { method: "POST" }),
          405,
          "method_not_allowed"
        );
        assert.equal(methodErr.headers.get("allow"), "GET");

        for (const mode of ["plate", "obs", "art", "throw"] as const) {
          fault = mode;
          await assertErr(
            fetch(`${baseUrl}/api/plates/lineage`),
            500,
            "plate_lineage_error"
          );
        }

        fault = "none";
        const okRes = await fetch(`${baseUrl}/api/plates/lineage`);
        assert.equal(okRes.status, 200);
        const okLineage = PlateLineageResponseSchema.parse(await okRes.json());
        assert.equal(okLineage.nodes.length, 4);
      }
    );
  });
});

describe("GET /api/plates/assets/:plateId.webp HTTP Seam (Seam 3 API, Ticket #33 Phase 2)", () => {
  test("Round-trips 200 canonical (immutable) and active branch (no-store) WebP bytes and enforces 404 on missing, expired, blobless, or malformed paths", async () => {
    const { repository, t1, b1, b2 } = await seedLineageGraph();
    let clock = new Date("2026-11-01T00:00:00.000Z");
    let dropBlob = false;
    let readWebpCalls = 0;

    const proxyRepo: GridlockRepository = {
      ...repository,
      readVisualPlateWebp: async (id) => {
        readWebpCalls += 1;
        return dropBlob ? null : repository.readVisualPlateWebp(id);
      },
    };

    await withPlatesServer(
      { repository: proxyRepo, now: () => clock },
      async (baseUrl) => {
        const lineage = PlateLineageResponseSchema.parse(
          await (await fetch(`${baseUrl}/api/plates/lineage`)).json()
        );
        assert.equal(lineage.nodes.length, 4);

        for (const node of lineage.nodes) {
          const res = await fetch(`${baseUrl}${node.assetPath}`);
          assert.equal(res.status, 200);
          assert.equal(res.headers.get("content-type"), "image/webp");
          assert.equal(
            res.headers.get("content-length"),
            String(node.plate.byteLength)
          );
          assert.equal(res.headers.get("access-control-allow-origin"), "*");
          assert.equal(
            res.headers.get("cache-control"),
            node.plate.isBranch
              ? "no-store"
              : "public, max-age=31536000, immutable"
          );

          const buf = Buffer.from(await res.arrayBuffer());
          assert.ok(isWebpBuffer(buf));
          assert.equal(
            createHash("sha256").update(buf).digest("hex"),
            node.plate.sha256
          );
        }

        readWebpCalls = 0;
        for (const bad of [
          "unknown_plate.webp",
          "",
          ".webp",
          "foo.png",
          "sub/x.webp",
          "%E0%A4%A.webp",
          "a%2Fb.webp",
          `%20${t1.plateId}%20.webp`,
          "..webp",
        ]) {
          assert.equal(
            (await fetch(`${baseUrl}/api/plates/assets/${bad}`)).status,
            404
          );
        }
        assert.equal(readWebpCalls, 0);

        dropBlob = true;
        await assertErr(
          fetch(`${baseUrl}/api/plates/assets/${t1.plateId}.webp`),
          404,
          "plate_not_found"
        );
        dropBlob = false;

        clock = new Date(Date.parse(b1.createdAt) + NINETY_DAYS_MS + 1_000);
        readWebpCalls = 0;
        assert.equal(
          (await fetch(`${baseUrl}/api/plates/assets/${b1.plateId}.webp`))
            .status,
          404
        );
        assert.equal(readWebpCalls, 0);
        assert.equal(
          (await fetch(`${baseUrl}/api/plates/assets/${t1.plateId}.webp`))
            .status,
          200
        );
        assert.equal(
          (await fetch(`${baseUrl}/api/plates/assets/${b2.plateId}.webp`))
            .status,
          200
        );
      }
    );
  });

  test("Enforces 400 query rejection, 405 Allow: GET, and 500 fail-closed metadata/WebP integrity verification with clean 200 recovery", async () => {
    const { repository, t1 } = await seedLineageGraph();
    const validBuf = (await repository.readVisualPlateWebp(t1.plateId))!;
    const flippedBuf = createFixtureWebpBuffer("tampered-valid-webp");

    assert.ok(isWebpBuffer(flippedBuf));
    assert.equal(flippedBuf.byteLength, t1.byteLength);
    assert.notEqual(
      createHash("sha256").update(flippedBuf).digest("hex"),
      t1.sha256
    );

    let fault:
      | "none"
      | "id_mismatch"
      | "bad_schema"
      | "non_webp"
      | "len_mismatch"
      | "sha_mismatch"
      | "throw" = "none";

    const metaFaults: Record<string, unknown> = {
      id_mismatch: { ...t1, plateId: "wrong_id" },
      bad_schema: { plateId: t1.plateId },
    };
    const blobFaults: Record<string, Buffer> = {
      non_webp: Buffer.alloc(t1.byteLength, 0x42),
      len_mismatch: Buffer.concat([validBuf, Buffer.from([0, 0])]),
      sha_mismatch: flippedBuf,
    };

    let readWebpCalls = 0;
    const proxyRepo: GridlockRepository = {
      ...repository,
      getVisualPlateById: async (id) => {
        if (fault === "throw") {
          throw new Error("offline");
        }
        if (fault in metaFaults) {
          return metaFaults[fault] as never;
        }
        return repository.getVisualPlateById(id);
      },
      readVisualPlateWebp: async (id) => {
        readWebpCalls += 1;
        return fault in blobFaults
          ? blobFaults[fault]!
          : repository.readVisualPlateWebp(id);
      },
    };

    await withPlatesServer(
      { repository: proxyRepo, now: () => new Date("2026-11-01T00:00:00.000Z") },
      async (baseUrl) => {
        const assetUrl = `${baseUrl}/api/plates/assets/${encodeURIComponent(t1.plateId)}.webp`;

        await assertErr(
          fetch(`${assetUrl}?unexpected=1`),
          400,
          "invalid_query_parameters"
        );
        const methodErr = await assertErr(
          fetch(assetUrl, { method: "POST" }),
          405,
          "method_not_allowed"
        );
        assert.equal(methodErr.headers.get("allow"), "GET");

        for (const mode of [
          "id_mismatch",
          "bad_schema",
          "non_webp",
          "len_mismatch",
          "sha_mismatch",
          "throw",
        ] as const) {
          fault = mode;
          readWebpCalls = 0;
          const corruptRes = await assertErr(
            fetch(assetUrl),
            500,
            "plate_asset_error"
          );
          assert.equal(corruptRes.headers.get("cache-control"), "no-store");
          if (mode === "id_mismatch" || mode === "bad_schema") {
            assert.equal(readWebpCalls, 0);
          }
        }

        fault = "none";
        assert.equal((await fetch(assetUrl)).status, 200);
      }
    );
  });
});

describe("POST /api/plates/branch HTTP Seam (Seam 3 API, Ticket #33 Phase 3)", () => {
  test("Returns 201 Created with watermarked WebP + XMP dc:rights and updates GET /api/plates/lineage without advancing activeCanonicalPlateId", async () => {
    const { repository, t2, h2, hAged } = await seedLineageGraph();
    const recordedRequests: GeminiInteractionCreateRequest[] = [];
    const clock = new Date("2026-11-02T12:00:00.000Z");

    const geminiClient: GeminiInteractionsClient = {
      interactions: {
        create: async (req) => {
          recordedRequests.push(req);
          return {
            id: "inter_http_b1",
            status: "completed",
            output_image: {
              mime_type: "image/webp",
              data: createFixtureWebpBuffer("http-b1").toString("base64"),
            },
            usage: { total_tokens: 145 },
          };
        },
      },
    };

    await withPlatesServer(
      { repository, geminiClient, now: () => clock },
      async (baseUrl) => {
        const res = await postJson(
          `${baseUrl}/api/plates/branch`,
          JSON.stringify({
            interactionId: t2.interactionId,
            scenarioPrompt: "  Simulate +300MW Austin North substation  ",
          })
        );
        assert.equal(res.status, 201);
        assert.equal(res.headers.get("cache-control"), "no-store");

        const created = BranchPlateResponseSchema.parse(await res.json());
        assert.equal(created.plate.isBranch, true);
        assert.equal(created.plate.epistemicLabel, SCENARIO_BRANCH_WATERMARK);
        assert.equal(created.plate.watermarkText, SCENARIO_BRANCH_WATERMARK);
        assert.equal(
          created.plate.scenarioPrompt,
          "Simulate +300MW Austin North substation"
        );
        assert.equal(
          created.plate.expiresAt,
          new Date(clock.getTime() + NINETY_DAYS_MS).toISOString()
        );
        assert.equal(created.tokensUsed, 145);
        assert.equal(created.node.triggeringObservations.length, 3);
        assert.deepEqual(
          created.node.sourceArtifacts.map((art) => art.sha256),
          [h2, hAged]
        );

        assert.throws(() =>
          BranchPlateResponseSchema.parse({ ...created, plate: t2 })
        );
        assert.throws(() =>
          BranchPlateRequestSchema.parse({
            interactionId: t2.interactionId,
            scenarioPrompt: "ok",
            extra: 1,
          })
        );

        const assetRes = await fetch(`${baseUrl}${created.node.assetPath}`);
        assert.equal(assetRes.status, 200);
        assert.equal(assetRes.headers.get("cache-control"), "no-store");

        const webpBytes = Buffer.from(await assetRes.arrayBuffer());
        assert.ok(isWebpBuffer(webpBytes));
        assert.equal(
          createHash("sha256").update(webpBytes).digest("hex"),
          created.plate.sha256
        );
        assert.ok(
          webpBytes
            .toString("utf-8")
            .includes(`<dc:rights>${SCENARIO_BRANCH_WATERMARK}</dc:rights>`)
        );

        const lineage = PlateLineageResponseSchema.parse(
          await (await fetch(`${baseUrl}/api/plates/lineage`)).json()
        );
        assert.equal(lineage.activeCanonicalPlateId, t2.plateId);
        assert.ok(
          lineage.nodes.some((node) => node.plate.plateId === created.plate.plateId)
        );
        assert.ok(
          lineage.edges.some(
            (edge) =>
              edge.parentInteractionId === t2.interactionId &&
              edge.childInteractionId === created.plate.interactionId &&
              edge.isBranch
          )
        );
      }
    );

    assert.equal(recordedRequests.length, 1);
    assert.equal(recordedRequests[0]?.previous_interaction_id, t2.interactionId);
    assert.equal(recordedRequests[0]?.store, true);
  });

  test("Enforces 0-token / 0-telemetry preconditions across 405, 400 (including >16KB), 404, and 429 quota with post-TTL recovery", async () => {
    const { repository, t1, t2, b1 } = await seedLineageGraph();
    let clock = new Date("2026-11-01T00:00:00.000Z");
    const recordedRequests: GeminiInteractionCreateRequest[] = [];

    const geminiClient: GeminiInteractionsClient = {
      interactions: {
        create: async (req) => {
          recordedRequests.push(req);
          return {
            id: "inter_after_ttl",
            status: "completed",
            output_image: {
              mime_type: "image/webp",
              data: createFixtureWebpBuffer("ttl-freed").toString("base64"),
            },
            usage: { total_tokens: 90 },
          };
        },
      },
    };

    const runsBefore = (await repository.listTelemetryRuns()).length;
    const agenticBefore = (await repository.getEfficiencyLedger()).agenticRunsCount;

    await withPlatesServer(
      {
        repository,
        geminiClient,
        maxBranchesPerLineage: 2,
        now: () => clock,
      },
      async (baseUrl) => {
        const methodErr = await assertErr(
          fetch(`${baseUrl}/api/plates/branch`),
          405,
          "method_not_allowed"
        );
        assert.equal(methodErr.headers.get("allow"), "POST");

        await assertErr(
          postJson(`${baseUrl}/api/plates/branch?extra=1`, "{}"),
          400,
          "invalid_query_parameters"
        );

        const badBodies: Array<[string, string]> = [
          ["", "invalid_request_body"],
          ["{bad", "invalid_request_body"],
          ["[]", "invalid_request_body"],
          [
            JSON.stringify({
              interactionId: t1.interactionId,
              scenarioPrompt: "ok",
              pad: "x".repeat(17_000),
            }),
            "request_body_too_large",
          ],
          [
            JSON.stringify({
              interactionId: t1.interactionId,
              scenarioPrompt: "ok",
              parentInteractionId: "bad",
            }),
            "invalid_request_body",
          ],
          [
            JSON.stringify({ interactionId: "   ", scenarioPrompt: "ok" }),
            "invalid_request_body",
          ],
          [
            JSON.stringify({
              interactionId: t1.interactionId,
              scenarioPrompt: "   ",
            }),
            "invalid_request_body",
          ],
          [
            JSON.stringify({
              interactionId: t1.interactionId,
              scenarioPrompt: "a".repeat(MAX_SCENARIO_PROMPT_LENGTH + 1),
            }),
            "invalid_request_body",
          ],
          [
            JSON.stringify({
              interactionId: t1.interactionId,
              scenarioPrompt: "ok",
              lineageId: "austin/north",
            }),
            "invalid_request_body",
          ],
          [
            JSON.stringify({
              interactionId: t1.interactionId,
              scenarioPrompt: "ok",
              lineageId: "..",
            }),
            "invalid_request_body",
          ],
        ];
        for (const [rawBody, expectedError] of badBodies) {
          await assertErr(
            postJson(`${baseUrl}/api/plates/branch`, rawBody),
            400,
            expectedError
          );
        }

        for (const payload of [
          { interactionId: "inter_missing", scenarioPrompt: "ok" },
          {
            interactionId: t2.interactionId,
            scenarioPrompt: "ok",
            lineageId: "other-corridor",
          },
        ]) {
          await assertErr(
            postJson(`${baseUrl}/api/plates/branch`, JSON.stringify(payload)),
            404,
            "parent_plate_not_found"
          );
        }

        await assertErr(
          postJson(
            `${baseUrl}/api/plates/branch`,
            JSON.stringify({
              interactionId: t2.interactionId,
              scenarioPrompt: "ok",
            })
          ),
          429,
          "branch_quota_exceeded"
        );

        clock = new Date(Date.parse(b1.createdAt) + NINETY_DAYS_MS + 1_000);
        await assertErr(
          postJson(
            `${baseUrl}/api/plates/branch`,
            JSON.stringify({
              interactionId: b1.interactionId,
              scenarioPrompt: "ok",
            })
          ),
          404,
          "parent_plate_not_found"
        );

        assert.equal(recordedRequests.length, 0);
        assert.equal((await repository.listTelemetryRuns()).length, runsBefore);
        assert.equal(
          (await repository.getEfficiencyLedger()).agenticRunsCount,
          agenticBefore
        );

        const recovered = await postJson(
          `${baseUrl}/api/plates/branch`,
          JSON.stringify({
            interactionId: t2.interactionId,
            scenarioPrompt: "Post-TTL branch",
          })
        );
        assert.equal(recovered.status, 201);
        assert.equal(recordedRequests.length, 1);
      }
    );
  });

  test("Orders 500/400/404/429 ahead of 503 unconfigured Gemini and maps Gemini/image faults to 502 with clean recovery", async () => {
    const { repository, t2, b1 } = await seedLineageGraph();
    let clock = new Date("2026-11-01T00:00:00.000Z");
    let fault: "none" | "parent" | "lineage" | "obs" | "art" = "none";

    const proxyRepo: GridlockRepository = {
      ...repository,
      getVisualPlateByInteractionId: async (id) =>
        fault === "parent"
          ? ({ ...t2, interactionId: "mismatch" } as never)
          : repository.getVisualPlateByInteractionId(id),
      listVisualPlatesByLineage: async (id) =>
        fault === "lineage"
          ? ([{ plateId: "corrupt" }] as never)
          : repository.listVisualPlatesByLineage(id),
      listObservationsByProject: async (projectNumber) =>
        fault === "obs"
          ? ([{ id: "bad" }] as never)
          : repository.listObservationsByProject(projectNumber),
      getSourceArtifactByHash: async (hash) =>
        fault === "art"
          ? ({ sha256: "mismatch" } as never)
          : repository.getSourceArtifactByHash(hash),
    };

    const runsBefore503 = (await repository.listTelemetryRuns()).length;
    await withPlatesServer(
      {
        repository: proxyRepo,
        maxBranchesPerLineage: 2,
        now: () => clock,
      },
      async (baseUrl) => {
        for (const mode of ["parent", "lineage"] as const) {
          fault = mode;
          await assertErr(
            postJson(
              `${baseUrl}/api/plates/branch`,
              JSON.stringify({
                interactionId: t2.interactionId,
                scenarioPrompt: "ok",
              })
            ),
            500,
            "plate_branch_error"
          );
        }

        fault = "none";
        await assertErr(
          postJson(`${baseUrl}/api/plates/branch`, "{bad"),
          400,
          "invalid_request_body"
        );
        await assertErr(
          postJson(
            `${baseUrl}/api/plates/branch`,
            JSON.stringify({ interactionId: "ghost", scenarioPrompt: "ok" })
          ),
          404,
          "parent_plate_not_found"
        );
        await assertErr(
          postJson(
            `${baseUrl}/api/plates/branch`,
            JSON.stringify({
              interactionId: t2.interactionId,
              scenarioPrompt: "ok",
            })
          ),
          429,
          "branch_quota_exceeded"
        );

        clock = new Date(Date.parse(b1.createdAt) + NINETY_DAYS_MS + 1_000);
        for (const mode of ["obs", "art"] as const) {
          fault = mode;
          await assertErr(
            postJson(
              `${baseUrl}/api/plates/branch`,
              JSON.stringify({
                interactionId: t2.interactionId,
                scenarioPrompt: "ok",
              })
            ),
            500,
            "plate_branch_error"
          );
        }

        fault = "none";
        await assertErr(
          postJson(
            `${baseUrl}/api/plates/branch`,
            JSON.stringify({
              interactionId: t2.interactionId,
              scenarioPrompt: "ok",
            })
          ),
          503,
          "painter_unavailable"
        );
        assert.equal((await repository.listTelemetryRuns()).length, runsBefore503);
      }
    );

    const queue: Array<() => GeminiInteractionResponse> = [
      () => {
        throw new Error("Gemini 503");
      },
      () => ({
        id: "inter_failed",
        status: "failed",
        error: { message: "blocked" },
      }),
      () => ({
        id: "inter_bad_img",
        status: "completed",
        output_image: { mime_type: "image/webp", data: "not-webp!!" },
      }),
      () => ({
        id: "inter_recovered",
        status: "completed",
        output_image: {
          mime_type: "image/webp",
          data: createFixtureWebpBuffer("ok").toString("base64"),
        },
        usage: { total_tokens: 80 },
      }),
    ];

    await withPlatesServer(
      {
        repository,
        geminiClient: { interactions: { create: async () => queue.shift()!() } },
        now: () => clock,
      },
      async (baseUrl) => {
        for (let attempt = 0; attempt < 3; attempt++) {
          await assertErr(
            postJson(
              `${baseUrl}/api/plates/branch`,
              JSON.stringify({
                interactionId: t2.interactionId,
                scenarioPrompt: "ok",
              })
            ),
            502,
            "painter_upstream_error"
          );
        }

        const recovered = await postJson(
          `${baseUrl}/api/plates/branch`,
          JSON.stringify({
            interactionId: t2.interactionId,
            scenarioPrompt: "ok",
          })
        );
        assert.equal(recovered.status, 201);
      }
    );
  });

  test("Serializes concurrent POST /api/plates/branch and branchLineage quota checks without calling Gemini twice", async () => {
    const { repository, t2, b1 } = await seedLineageGraph();
    const clock = new Date(Date.parse(b1.createdAt) + NINETY_DAYS_MS + 1_000);
    const recordedRequests: GeminiInteractionCreateRequest[] = [];

    const geminiClient: GeminiInteractionsClient = {
      interactions: {
        create: async (req) => {
          recordedRequests.push(req);
          await new Promise((resolve) => setTimeout(resolve, 20));
          return {
            id: `inter_concurrent_${recordedRequests.length}`,
            status: "completed",
            output_image: {
              mime_type: "image/webp",
              data: createFixtureWebpBuffer(`concurrent-${recordedRequests.length}`).toString("base64"),
            },
            usage: { total_tokens: 90 },
          };
        },
      },
    };

    await withPlatesServer(
      {
        repository,
        geminiClient,
        maxBranchesPerLineage: 2,
        now: () => clock,
      },
      async (baseUrl) => {
        const raceResponses = await Promise.all([
          postJson(
            `${baseUrl}/api/plates/branch`,
            JSON.stringify({
              interactionId: t2.interactionId,
              scenarioPrompt: "Concurrent POST A",
            })
          ),
          postJson(
            `${baseUrl}/api/plates/branch`,
            JSON.stringify({
              interactionId: t2.interactionId,
              scenarioPrompt: "Concurrent POST B",
            })
          ),
        ]);

        const statuses = raceResponses.map((res) => res.status).sort((a, b) => a - b);
        assert.deepEqual(statuses, [201, 429]);

        const rejectedRes = raceResponses.find((res) => res.status === 429)!;
        const rejectedBody = (await rejectedRes.json()) as { error: string };
        assert.equal(rejectedBody.error, "branch_quota_exceeded");
        assert.equal(recordedRequests.length, 1);
      }
    );

    await withPlatesServer(
      {
        repository,
        geminiClient,
        maxBranchesPerLineage: 3,
        now: () => clock,
      },
      async (baseUrl) => {
        const [httpOutcome, directOutcome] = await Promise.all([
          postJson(
            `${baseUrl}/api/plates/branch`,
            JSON.stringify({
              interactionId: t2.interactionId,
              scenarioPrompt: "Mixed HTTP branch",
            })
          ),
          branchLineage(
            {
              parentInteractionId: t2.interactionId,
              scenarioPrompt: "Mixed direct branch",
              maxBranchesPerLineage: 3,
              now: clock,
            },
            { repository, geminiClient }
          ),
        ]);

        const paintedCount =
          Number(httpOutcome.status === 201) +
          Number(directOutcome.status === "plate_painted");
        assert.equal(paintedCount, 1);
        assert.equal(recordedRequests.length, 2);

        if (httpOutcome.status !== 201) {
          assert.equal(httpOutcome.status, 429);
          const body = (await httpOutcome.json()) as { error: string };
          assert.equal(body.error, "branch_quota_exceeded");
        }
        if (directOutcome.status === "painter_failed") {
          assert.equal(directOutcome.errorCode, "branch_quota_exceeded");
        } else if (directOutcome.status !== "plate_painted") {
          assert.fail(`Unexpected directOutcome status: ${directOutcome.status}`);
        }
      }
    );

    const { repository: teleRepo, t2: teleT2, b1: teleB1 } = await seedLineageGraph();
    const teleClock = new Date(Date.parse(teleB1.createdAt) + NINETY_DAYS_MS + 1_000);
    let markSaved: (() => void) | undefined;
    const savedPromise = new Promise<void>((resolve) => {
      markSaved = resolve;
    });
    let releaseTelemetry: (() => void) | undefined;
    const telemetryGate = new Promise<void>((resolve) => {
      releaseTelemetry = resolve;
    });
    let notifiedSaved = false;
    let blockedFirstTelemetry = false;

    const delayedTelemetryRepo: GridlockRepository = {
      ...teleRepo,
      saveVisualPlate: async (plate, webpBuf) => {
        await teleRepo.saveVisualPlate(plate, webpBuf);
        if (plate.isBranch && !notifiedSaved) {
          notifiedSaved = true;
          markSaved?.();
        }
      },
      recordTelemetryRun: async (run, updates) => {
        if (run.stage === "painter_branch_lineage" && !blockedFirstTelemetry) {
          blockedFirstTelemetry = true;
          await telemetryGate;
        }
        return teleRepo.recordTelemetryRun(run, updates);
      },
    };

    await withPlatesServer(
      {
        repository: delayedTelemetryRepo,
        geminiClient,
        maxBranchesPerLineage: 3,
        now: () => teleClock,
      },
      async (baseUrl) => {
        const post1Promise = postJson(
          `${baseUrl}/api/plates/branch`,
          JSON.stringify({
            interactionId: teleT2.interactionId,
            scenarioPrompt: "Telemetry overlap HTTP A",
          })
        );
        await savedPromise;

        const post2Res = await postJson(
          `${baseUrl}/api/plates/branch`,
          JSON.stringify({
            interactionId: teleT2.interactionId,
            scenarioPrompt: "Telemetry overlap HTTP B",
          })
        );
        assert.equal(post2Res.status, 201);

        releaseTelemetry?.();
        const post1Res = await post1Promise;
        assert.equal(post1Res.status, 201);
      }
    );
  });

  test("Flushes HTTP 400 and Connection: close for streaming payloads > 1 MiB before closing socket", async () => {
    const repository = createInMemoryGridlockRepository();

    await withPlatesServer({ repository }, async (baseUrl) => {
      const outcome = await new Promise<{
        status: number | undefined;
        connection: string | string[] | undefined;
        error: unknown;
      }>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Timed out waiting for 400 response")),
          2000
        ).unref();

        const req = httpRequest(
          new URL("/api/plates/branch", baseUrl),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => {
              chunks.push(chunk);
            });
            res.on("end", () => {
              clearTimeout(timer);
              const parsed = JSON.parse(
                Buffer.concat(chunks).toString("utf-8")
              ) as { error: unknown };
              resolve({
                status: res.statusCode,
                connection: res.headers.connection,
                error: parsed.error,
              });
            });
          }
        );

        req.on("error", () => {});

        const chunk = Buffer.alloc(65_536, 0x61);
        const writeNext = (remaining: number): void => {
          if (remaining === 0) {
            req.end();
            return;
          }
          if (!req.destroyed && !req.writableEnded) {
            req.write(chunk, () => writeNext(remaining - 1));
          }
        };
        writeNext(20);
      });

      assert.equal(outcome.status, 400);
      assert.equal(outcome.connection, "close");
      assert.equal(outcome.error, "request_body_too_large");
    });
  });
});
