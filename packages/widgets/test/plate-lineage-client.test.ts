import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createInMemoryGridlockRepository,
  type GridlockRepository,
} from "@samasastudio/gridlock-core";
import {
  buildPlateAssetUrl,
  buildPlateLineageUrl,
  fetchPlateLineageSnapshot,
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
        t2Node?.sourceArtifacts.map((a) => a.sha256),
        [seeded.h2]
      );
      assert.ok(t2Node?.plate.sourceArtifactHashes.includes(seeded.hAged));

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
});
