import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, test } from "node:test";
import {
  createGridlockHttpServer,
  createInMemoryGridlockRepository,
  DEFAULT_LINEAGE_ID,
  PlateLineageResponseSchema,
  type GridlockHttpDeps,
} from "../src/index.ts";

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
});
