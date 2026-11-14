import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { describe, test } from "node:test";
import {
  ARTIFACT_BUCKET_URI,
  bootstrapCanvas,
  branchLineage,
  createGridlockHttpServer,
  createInMemoryGridlockRepository,
  DEFAULT_LINEAGE_ID,
  isWebpBuffer,
  NINETY_DAYS_MS,
  ObservationSchema,
  paintMilestoneDelta,
  PlateLineageResponseSchema,
  SCENARIO_BRANCH_WATERMARK,
  SourceArtifactSchema,
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

    const proxyRepo: GridlockRepository = {
      ...repository,
      readVisualPlateWebp: async (id) =>
        dropBlob ? null : repository.readVisualPlateWebp(id),
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

        for (const bad of [
          "unknown_plate.webp",
          "",
          ".webp",
          "foo.png",
          "sub/x.webp",
          "%E0%A4%A.webp",
          "a%2Fb.webp",
        ]) {
          assert.equal(
            (await fetch(`${baseUrl}/api/plates/assets/${bad}`)).status,
            404
          );
        }

        dropBlob = true;
        await assertErr(
          fetch(`${baseUrl}/api/plates/assets/${t1.plateId}.webp`),
          404,
          "plate_not_found"
        );
        dropBlob = false;

        clock = new Date(Date.parse(b1.createdAt) + NINETY_DAYS_MS + 1_000);
        assert.equal(
          (await fetch(`${baseUrl}/api/plates/assets/${b1.plateId}.webp`))
            .status,
          404
        );
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
      readVisualPlateWebp: async (id) =>
        fault in blobFaults
          ? blobFaults[fault]!
          : repository.readVisualPlateWebp(id),
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
          const corruptRes = await assertErr(
            fetch(assetUrl),
            500,
            "plate_asset_error"
          );
          assert.equal(corruptRes.headers.get("cache-control"), "no-store");
        }

        fault = "none";
        assert.equal((await fetch(assetUrl)).status, 200);
      }
    );
  });
});
