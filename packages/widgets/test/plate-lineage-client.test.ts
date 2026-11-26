import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createInMemoryGridlockRepository,
  SCENARIO_BRANCH_WATERMARK,
  type GridlockRepository,
} from "@samasastudio/gridlock-core";
import {
  buildPlateAssetUrl,
  buildPlateBranchUrl,
  buildPlateLineageUrl,
  fetchPlateLineageSnapshot,
  submitPlateBranch,
} from "../src/index.ts";
import { seedTestPlateLineage, withTestPlatesServer } from "./helpers/plate-fixtures.ts";

describe("Plate Lineage HTTP Client (Ticket #34 Phase 1)", () => {
  test("buildPlateLineageUrl, buildPlateAssetUrl, and fetchPlateLineageSnapshot handle same-origin, 200, 400, 500, malformed JSON, and AbortSignal", async () => {
    assert.equal(buildPlateLineageUrl({ apiBaseUrl: "" }), "/api/plates/lineage");
    assert.equal(
      buildPlateLineageUrl({ apiBaseUrl: "https://api.example.com///", lineageId: " ercot-west " }),
      "https://api.example.com/api/plates/lineage?lineage_id=ercot-west"
    );
    assert.equal(
      buildPlateAssetUrl("", "/api/plates/assets/plate_1.webp"),
      "/api/plates/assets/plate_1.webp"
    );
    assert.equal(
      buildPlateAssetUrl("", "//example.com/plate_1.webp"),
      "/example.com/plate_1.webp"
    );
    assert.equal(
      buildPlateAssetUrl("https://api.example.com/", "api/plates/assets/plate_1.webp"),
      "https://api.example.com/api/plates/assets/plate_1.webp"
    );

    const seeded = await seedTestPlateLineage();
    await withTestPlatesServer({ repository: seeded.repository }, async (apiBaseUrl) => {
      const okSnap = await fetchPlateLineageSnapshot({ apiBaseUrl });
      assert.equal(okSnap.ok, true);
      if (!okSnap.ok) return;
      assert.equal(okSnap.lineage.activeCanonicalPlateId, seeded.t2.plateId);
      assert.equal(okSnap.lineage.nodes.length, 4);
      const t2Node = okSnap.lineage.nodes.find((n) => n.plate.plateId === seeded.t2.plateId);
      assert.deepEqual(
        t2Node?.rawCaptures.map((a) => a.sha256),
        [seeded.h2]
      );
      assert.ok(t2Node?.plate.rawCaptureHashes.includes(seeded.hAged));

      const emptySnap = await fetchPlateLineageSnapshot({
        apiBaseUrl,
        lineageId: "unknown-corridor",
      });
      assert.equal(emptySnap.ok, true);
      if (emptySnap.ok) {
        assert.equal(emptySnap.lineage.activeCanonicalPlateId, null);
        assert.equal(emptySnap.lineage.nodes.length, 0);
      }

      const badQuery = await fetchPlateLineageSnapshot({ apiBaseUrl, lineageId: "bad/id" });
      assert.equal(badQuery.ok, false);
      if (!badQuery.ok) {
        assert.equal(badQuery.statusCode, 400);
        assert.match(badQuery.message, /lineage_id/i);
      }

      const abortController = new AbortController();
      abortController.abort(new Error("Caller cancelled lineage request"));
      const aborted = await fetchPlateLineageSnapshot({
        apiBaseUrl,
        signal: abortController.signal,
      });
      assert.equal(aborted.ok, false);
      if (!aborted.ok) {
        assert.equal(aborted.statusCode, undefined);
        assert.match(aborted.message, /Caller cancelled lineage request/);
      }
    });

    const corruptRepo: GridlockRepository = {
      ...createInMemoryGridlockRepository(),
      async listVisualPlatesByLineage() {
        return [{ broken: true }] as never;
      },
    };
    await withTestPlatesServer({ repository: corruptRepo }, async (apiBaseUrl) => {
      const err500 = await fetchPlateLineageSnapshot({ apiBaseUrl });
      assert.equal(err500.ok, false);
      if (!err500.ok) assert.equal(err500.statusCode, 500);
    });

    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ lineageId: 42 });
    try {
      const malformed = await fetchPlateLineageSnapshot({ apiBaseUrl: "" });
      assert.deepEqual(malformed, { ok: false, message: "Malformed Plate Lineage payload" });
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("buildPlateBranchUrl and submitPlateBranch handle 201, 400, 404, 429, 503, 500, malformed JSON, and AbortSignal", async () => {
    assert.equal(buildPlateBranchUrl(""), "/api/plates/branch");
    assert.equal(
      buildPlateBranchUrl("https://api.example.com///"),
      "https://api.example.com/api/plates/branch"
    );

    const seeded = await seedTestPlateLineage();

    await withTestPlatesServer(
      {
        repository: seeded.repository,
        geminiClient: seeded.geminiClient,
        maxBranchesPerLineage: 3,
      },
      async (apiBaseUrl) => {
        const created = await submitPlateBranch({
          apiBaseUrl,
          interactionId: `  ${seeded.t2.interactionId}  `,
          scenarioPrompt: "  Simulate 345kV loop upgrade at Navarro County  ",
          lineageId: "  texas-corridor-main  ",
        });
        assert.equal(created.ok, true);
        if (created.ok) {
          assert.equal(created.branch.plate.isBranch, true);
          assert.equal(created.branch.plate.epistemicLabel, SCENARIO_BRANCH_WATERMARK);
          assert.equal(created.branch.plate.parentInteractionId, seeded.t2.interactionId);
          assert.equal(
            created.branch.plate.scenarioPrompt,
            "Simulate 345kV loop upgrade at Navarro County"
          );
          assert.equal(created.branch.node.plate.plateId, created.branch.plate.plateId);
        }

        const quota429 = await submitPlateBranch({
          apiBaseUrl,
          interactionId: seeded.t2.interactionId,
          scenarioPrompt: "Exceed active branch quota",
        });
        assert.equal(quota429.ok, false);
        if (!quota429.ok) {
          assert.equal(quota429.statusCode, 429);
          assert.equal(quota429.errorCode, "branch_quota_exceeded");
        }

        const invalid400 = await submitPlateBranch({
          apiBaseUrl,
          interactionId: seeded.t2.interactionId,
          scenarioPrompt: "   ",
        });
        assert.equal(invalid400.ok, false);
        if (!invalid400.ok) {
          assert.equal(invalid400.statusCode, 400);
          assert.equal(invalid400.errorCode, "invalid_request_body");
        }

        const missing404 = await submitPlateBranch({
          apiBaseUrl,
          interactionId: "inter_missing_parent",
          scenarioPrompt: "Fork unknown parent interaction",
        });
        assert.equal(missing404.ok, false);
        if (!missing404.ok) {
          assert.equal(missing404.statusCode, 404);
          assert.equal(missing404.errorCode, "parent_plate_not_found");
        }

        const abortController = new AbortController();
        abortController.abort(new Error("Caller cancelled scenario branch"));
        const aborted = await submitPlateBranch({
          apiBaseUrl,
          interactionId: seeded.t2.interactionId,
          scenarioPrompt: "Cancelled prompt",
          signal: abortController.signal,
        });
        assert.equal(aborted.ok, false);
        if (!aborted.ok) {
          assert.equal(aborted.statusCode, undefined);
          assert.equal(aborted.errorCode, undefined);
          assert.match(aborted.message, /Caller cancelled scenario branch/);
        }
      }
    );

    const unavailableSeeded = await seedTestPlateLineage();
    await withTestPlatesServer({ repository: unavailableSeeded.repository }, async (apiBaseUrl) => {
      const err503 = await submitPlateBranch({
        apiBaseUrl,
        interactionId: unavailableSeeded.t2.interactionId,
        scenarioPrompt: "Attempt branch without Gemini client",
      });
      assert.equal(err503.ok, false);
      if (!err503.ok) {
        assert.equal(err503.statusCode, 503);
        assert.equal(err503.errorCode, "painter_unavailable");
      }
    });

    const corruptRepo: GridlockRepository = {
      ...createInMemoryGridlockRepository(),
      async getVisualPlateByInteractionId() {
        return { broken: true } as never;
      },
    };
    await withTestPlatesServer({ repository: corruptRepo }, async (apiBaseUrl) => {
      const err500 = await submitPlateBranch({
        apiBaseUrl,
        interactionId: seeded.t2.interactionId,
        scenarioPrompt: "Trigger corrupt parent 500",
      });
      assert.equal(err500.ok, false);
      if (!err500.ok) {
        assert.equal(err500.statusCode, 500);
        assert.equal(err500.errorCode, "plate_branch_error");
      }
    });

    const origFetch = globalThis.fetch;
    const stubCapture = { requestJson: "" };
    globalThis.fetch = async (_input, init) => {
      stubCapture.requestJson = String(init?.body ?? "");
      return Response.json({ broken: true }, { status: 201 });
    };
    try {
      const malformed = await submitPlateBranch({
        apiBaseUrl: "",
        interactionId: `  ${seeded.t2.interactionId}  `,
        scenarioPrompt: "  Malformed 201 response  ",
        lineageId: "  texas-corridor-main  ",
      });
      assert.deepEqual(JSON.parse(stubCapture.requestJson), {
        interactionId: seeded.t2.interactionId,
        scenarioPrompt: "Malformed 201 response",
        lineageId: "texas-corridor-main",
      });
      assert.deepEqual(malformed, { ok: false, message: "Malformed Scenario Branch payload" });

      globalThis.fetch = async () =>
        new Response("Bad Gateway", {
          status: 502,
          headers: { "content-type": "text/plain" },
        });
      const gateway502 = await submitPlateBranch({
        apiBaseUrl: "",
        interactionId: seeded.t2.interactionId,
        scenarioPrompt: "Plain-text gateway error",
      });
      assert.deepEqual(gateway502, {
        ok: false,
        statusCode: 502,
        message: "Scenario Branch HTTP 502",
      });
      if (!gateway502.ok) {
        assert.equal(gateway502.errorCode, undefined);
      }
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
