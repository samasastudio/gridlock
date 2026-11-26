import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import type { AddressInfo } from "node:net";
import {
  ARTIFACT_BUCKET_URI, bootstrapCanvas, branchTimeline, createCorridorBaseCanvasWebp, createGridlockHttpServer,
  createInMemoryGridlockRepository, getFrameTimeline, ObservationSchema, paintMilestoneDelta,
  PlateLineageResponseSchema, RawCaptureSchema,
  type GeminiInteractionsClient, type GridlockHttpDeps, type PlateLineageResponse,
} from "@samasastudio/gridlock-core";

const PLATE_FIXTURE_NOW = new Date("2026-11-15T12:00:00.000Z");

export async function withTestPlatesServer(
  deps: GridlockHttpDeps,
  run: (apiBaseUrl: string) => Promise<void>
): Promise<void> {
  const server = createGridlockHttpServer({ now: () => PLATE_FIXTURE_NOW, ...deps });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

function buildFixtureArtifact(sha256: string, expiresAt: string | null) {
  return RawCaptureSchema.parse({
    sha256, connectorId: "tdlr-tabs",
    sourceUrl: `https://www.tdlr.texas.gov/TABS/Search/Project/${sha256.slice(0, 8)}`,
    contentType: "text/html", rawByteLength: 512, compressedByteLength: 128,
    storageUri: `${ARTIFACT_BUCKET_URI}/artifacts/${sha256}.gz`,
    capturedAt: "2026-10-27T14:00:00.000Z", expiresAt, referencedByMilestone: false,
  });
}

export async function seedTestPlateLineage() {
  const repository = createInMemoryGridlockRepository();
  const [h1, h2, hAged] = ["a".repeat(64), "b".repeat(64), "c".repeat(64)];
  const gzBytes = Buffer.from("gridlock-fixture-gz");

  await repository.saveRawCapture(buildFixtureArtifact(h1, "2027-01-25T14:00:00.000Z"), gzBytes);
  await repository.saveRawCapture(buildFixtureArtifact(h2, "2027-01-25T14:00:00.000Z"), gzBytes);

  const obs1 = ObservationSchema.parse({
    id: "obs_TABS2027003697_m1", projectNumber: "TABS2027003697", rawCaptureHash: h1,
    observedAt: "2026-10-27T14:00:00.000Z", status: "Project Registered",
    estimatedCostUsd: 125_000_000, squareFootage: 250_000,
    scopeOfWork: "250,000 sq ft hyperscale data center hall and 345kV substation yard", isMilestone: true,
  });
  const obs2 = ObservationSchema.parse({
    ...obs1, id: "obs_TABS2027003697_m2", rawCaptureHash: h2,
    observedAt: "2026-10-28T09:00:00.000Z", status: "Construction Started",
    scopeOfWork: "250,000 sq ft structural steel erection and chilled-water loop expansion",
  });
  const obsAged = ObservationSchema.parse({
    id: "obs_TABS2027004200_m1", projectNumber: "TABS2027004200", rawCaptureHash: hAged,
    observedAt: "2026-10-28T09:10:00.000Z", status: "Project Registered",
    estimatedCostUsd: 65_000_000, squareFootage: 140_000,
    scopeOfWork: "140,000 sq ft adjacent switchgear interconnect building", isMilestone: true,
  });
  for (const obs of [obs1, obs2, obsAged]) await repository.appendObservation(obs);

  let seq = 0;
  let b1InteractionId = "";
  let rejectedExpiredOnce = false;
  const geminiClient: GeminiInteractionsClient = {
    interactions: {
      create: async (request) => {
        if (b1InteractionId.length > 0 && request.previous_interaction_id === b1InteractionId && !rejectedExpiredOnce) {
          rejectedExpiredOnce = true;
          throw new Error("previous_interaction_id expired past TTL");
        }
        seq += 1;
        return {
          id: `inter_plate_seed_${seq}`,
          status: "completed",
          output_image: { mime_type: "image/webp", data: createCorridorBaseCanvasWebp(`corridor-seed-${seq}`).toString("base64") },
          usage: { total_tokens: 140 },
        };
      },
    },
  };

  const t1 = await bootstrapCanvas({ observations: [obs1], now: new Date("2026-10-27T14:05:00.000Z") }, { repository, geminiClient });
  const t2 = await paintMilestoneDelta({ observations: [obs2, obsAged], now: new Date("2026-10-28T09:15:00.000Z") }, { repository, geminiClient });
  await repository.saveRawCapture(buildFixtureArtifact(hAged, "2026-10-01T00:00:00.000Z"), gzBytes);
  assert.equal(t1.status, "illustration_painted");
  assert.equal(t2.status, "illustration_painted");

  const b1 = await branchTimeline(
    { parentInteractionId: t2.illustration.interactionId, scenarioPrompt: "Simulate +400MW ERCOT substation interconnection delay", now: new Date("2026-10-29T11:00:00.000Z") },
    { repository, geminiClient }
  );
  assert.equal(b1.status, "illustration_painted");
  b1InteractionId = b1.illustration.interactionId;

  const b2 = await branchTimeline(
    { parentInteractionId: b1.illustration.interactionId, scenarioPrompt: "Model dual-feed 345kV transmission reroute around Ellis County", now: new Date("2026-10-30T15:00:00.000Z") },
    { repository, geminiClient }
  );
  assert.equal(b2.status, "illustration_painted");
  assert.equal(b2.illustration.rebootstrappedFromParentWebp, true);

  const hydrated = await getFrameTimeline({ now: PLATE_FIXTURE_NOW }, { repository });
  if (!hydrated.ok) throw new Error(hydrated.message);

  return { repository, geminiClient, lineage: hydrated.timeline, t1: t1.illustration, t2: t2.illustration, b1: b1.illustration, b2: b2.illustration, h1, h2, hAged };
}

export function buildBranchOnlyLineage(
  lineage: PlateLineageResponse,
  b1PlateId: string,
  b2PlateId: string
): PlateLineageResponse {
  const b1Node = lineage.nodes.find((node) => node.plate.illustrationId === b1PlateId)!;
  const b2Node = lineage.nodes.find((node) => node.plate.illustrationId === b2PlateId)!;

  return PlateLineageResponseSchema.parse({
    timelineId: lineage.timelineId,
    activeCanonicalIllustrationId: null,
    nodes: [b1Node, b2Node],
    edges: lineage.edges.filter(
      (edge) => edge.parentIllustrationId === b1PlateId && edge.childIllustrationId === b2PlateId
    ),
  });
}

export async function seedTurn1ForkLineage(
  seeded: Awaited<ReturnType<typeof seedTestPlateLineage>>
) {
  const bFromT1 = await branchTimeline(
    {
      parentInteractionId: seeded.t1.interactionId,
      scenarioPrompt: "Model direct Turn 1 substation fork",
      now: new Date("2026-10-31T10:00:00.000Z"),
    },
    { repository: seeded.repository, geminiClient: seeded.geminiClient }
  );
  const refreshed = await getFrameTimeline(
    { now: PLATE_FIXTURE_NOW },
    { repository: seeded.repository }
  );

  if (bFromT1.status !== "illustration_painted" || !refreshed.ok) {
    assert.fail("Expected Turn 1 scenario branch and lineage hydration to succeed");
  }

  return {
    lineage: refreshed.timeline,
    branchPlate: bFromT1.illustration,
  };
}

export function createGatedGeminiClient() {
  const gate = {
    calls: 0,
    release: null as (() => void) | null,
  };

  const geminiClient: GeminiInteractionsClient = {
    interactions: {
      create: async () => {
        gate.calls += 1;
        if (gate.release === null) {
          await new Promise<void>((resolve) => {
            gate.release = resolve;
          });
        }

        return {
          id: `inter_ui_branch_${gate.calls}`,
          status: "completed",
          output_image: {
            mime_type: "image/webp",
            data: createCorridorBaseCanvasWebp(`ui-branch-${gate.calls}`).toString("base64"),
          },
          usage: { total_tokens: 140 },
        };
      },
    },
  };

  return { gate, geminiClient };
}
