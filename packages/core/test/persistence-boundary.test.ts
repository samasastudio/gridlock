import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { describe, test } from "node:test";
import { gzipSync } from "node:zlib";
import {
  ARTIFACT_BUCKET_URI,
  DEFAULT_EFFICIENCY_SCORECARD,
  DEFAULT_TDLR_CONNECTOR_CONFIG,
  RECENT_RUN_RECORDS_LIMIT,
  RawCaptureSchema,
  RepairChangelogEntrySchema,
  bootstrapCanvas,
  createCorridorBaseCanvasWebp,
  createInMemoryGridlockRepository,
  recordAgenticStageRun,
  recordStageRun,
  runOutOfBandRepairAgent,
  type GeminiInteractionsClient,
  type GridlockRepository,
  type Observation,
  type RawCapture,
  type RepairChangelogEntry,
} from "../src/index.ts";
import {
  FROZEN_TABS_2027003697_HTML,
  MUTATED_PORTAL_V2_HTML,
} from "./helpers/fixtures.ts";

function buildChangelogEntry(
  version: number,
  sha256: string,
  mttrMs = 2_000
): RepairChangelogEntry {
  return RepairChangelogEntrySchema.parse({
    id: `repair_tdlr-tabs_v${version}_${sha256.slice(0, 8)}`,
    connectorId: "tdlr-tabs",
    previousVersion: version - 1,
    promotedVersion: version,
    quarantinedArtifactHash: sha256,
    brokenInvariants: ["document: Missing detailContainerSelector"],
    selectorDiffs: [
      {
        field: "detailContainerSelector",
        before: ".project-details",
        after: ".project-details, .tabs-project-details-v2",
      },
    ],
    rootCauseSummary: `Selector update v${version}`,
    historicalFixturesTested: 1,
    historicalFixturesPassed: 1,
    totalFixturesVerified: 2,
    anomalyDetectedAt: "2026-10-26T18:00:00.000Z",
    patchPromotedAt: "2026-10-26T18:00:02.000Z",
    mttrMs,
    interactionId: `inter_repair_v${version}`,
    repairTokensUsed: 200,
    estimatedRepairCostUsd: 0.0005,
    subsequentDeterministicRunsServed: 0,
    expiresAt: null,
  });
}

function buildCapture(sha256: string, quarantined: boolean): RawCapture {
  const folder = quarantined ? "quarantine" : "artifacts";
  return RawCaptureSchema.parse({
    sha256,
    connectorId: "tdlr-tabs",
    sourceUrl: "https://www.tdlr.texas.gov/TABS/Search/Project/TABS2027003697",
    contentType: "text/html",
    rawByteLength: 512,
    compressedByteLength: 128,
    storageUri: `${ARTIFACT_BUCKET_URI}/${folder}/${sha256}.gz`,
    capturedAt: "2026-10-26T18:00:00.000Z",
    expiresAt: "2027-01-24T18:00:00.000Z",
    referencedByMilestone: false,
  });
}

function buildMilestoneObservation(
  id: string,
  projectNumber: string,
  rawCaptureHash: string
): Observation {
  return {
    id,
    projectNumber,
    rawCaptureHash,
    observedAt: "2026-10-26T18:00:00.000Z",
    status: "Project Registered",
    estimatedCostUsd: 50_000_000,
    squareFootage: 200_000,
    scopeOfWork: "Data Center",
    isMilestone: true,
  };
}

interface SpyReadCounts {
  saveRawCapture: number;
  readArtifactGzip: number;
  listRuns: number;
  getScorecard: number;
  listChangelog: number;
  getConfig: number;
  getRawCapture: number;
}

function createSpiedRepository(baseRepo: GridlockRepository): {
  spiedRepo: GridlockRepository;
  counts: SpyReadCounts;
} {
  const counts: SpyReadCounts = {
    saveRawCapture: 0,
    readArtifactGzip: 0,
    listRuns: 0,
    getScorecard: 0,
    listChangelog: 0,
    getConfig: 0,
    getRawCapture: 0,
  };

  const spiedRepo: GridlockRepository = {
    ...baseRepo,
    saveRawCapture: async (capture, gzipBuffer) => {
      counts.saveRawCapture += 1;
      return baseRepo.saveRawCapture(capture, gzipBuffer);
    },
    readArtifactGzip: async (sha256) => {
      counts.readArtifactGzip += 1;
      return baseRepo.readArtifactGzip(sha256);
    },
    listRunRecords: async (options) => {
      counts.listRuns += 1;
      return baseRepo.listRunRecords(options);
    },
    getEfficiencyScorecard: async (options) => {
      counts.getScorecard += 1;
      return baseRepo.getEfficiencyScorecard(options);
    },
    listRepairChangelog: async (connectorId) => {
      counts.listChangelog += 1;
      return baseRepo.listRepairChangelog(connectorId);
    },
    getActiveConnectorConfig: async (connectorId) => {
      counts.getConfig += 1;
      return baseRepo.getActiveConnectorConfig(connectorId);
    },
    getRawCaptureByHash: async (sha256) => {
      counts.getRawCapture += 1;
      return baseRepo.getRawCaptureByHash(sha256);
    },
  };

  return { spiedRepo, counts };
}

describe("Persistence boundary atomic transitions and bounded reads (Issue #83)", () => {
  test("recordStageRun bounds recent run reads to 50, skips unlocked reads, amortizes only the active changelog entry, and handles concurrent calls", async () => {
    const baseRepo = createInMemoryGridlockRepository();
    await baseRepo.promoteConnectorConfig(
      { ...DEFAULT_TDLR_CONNECTOR_CONFIG, version: 2 },
      buildChangelogEntry(2, "a".repeat(64)),
      ({ currentScorecard }) => ({ updatedScorecard: currentScorecard })
    );
    await baseRepo.promoteConnectorConfig(
      { ...DEFAULT_TDLR_CONNECTOR_CONFIG, version: 3 },
      buildChangelogEntry(3, "b".repeat(64)),
      ({ currentScorecard }) => ({ updatedScorecard: currentScorecard })
    );

    const anchorMs = Date.parse("2026-10-27T00:00:00.000Z");
    for (let idx = 0; idx < 60; idx += 1) {
      const startedAt = new Date(anchorMs + idx * 1_000);
      await recordStageRun(
        {
          stage: "tdlr_ingest",
          connectorId: "tdlr-tabs",
          execution_mode: "deterministic",
          status: "ingested",
          rawByteLength: 400,
          tokensUsed: 0,
          naiveTokensAvoided: 100,
          startedAt,
          endedAt: new Date(startedAt.getTime() + 10),
        },
        { repository: baseRepo }
      );
    }

    const defaultRuns = await baseRepo.listRunRecords();
    assert.equal(defaultRuns.length, RECENT_RUN_RECORDS_LIMIT);
    assert.equal((await baseRepo.listRunRecords({ limit: 5 })).length, 5);
    assert.equal((await baseRepo.listRunRecords({ limit: 0 })).length, 0);

    const { spiedRepo: baseSpy, counts } = createSpiedRepository(baseRepo);
    const observedRecentCounts: number[] = [];
    const spiedRepo: GridlockRepository = {
      ...baseSpy,
      recordRunRecord: async (run, transition) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return baseRepo.recordRunRecord(run, (ctx) => {
          observedRecentCounts.push(ctx.recentRuns.length);
          return transition(ctx);
        });
      },
    };

    const firstStart = new Date("2026-10-27T02:00:00.000Z");
    const secondStart = new Date("2026-10-27T02:01:00.000Z");
    await Promise.all([
      recordStageRun(
        {
          stage: "tdlr_ingest",
          connectorId: "tdlr-tabs",
          execution_mode: "deterministic",
          status: "ingested",
          rawByteLength: 400,
          tokensUsed: 0,
          naiveTokensAvoided: 100,
          startedAt: firstStart,
          endedAt: new Date(firstStart.getTime() + 10),
        },
        { repository: spiedRepo }
      ),
      recordStageRun(
        {
          stage: "tdlr_ingest",
          connectorId: "tdlr-tabs",
          execution_mode: "deterministic",
          status: "unchanged_artifact",
          rawByteLength: 800,
          tokensUsed: 0,
          naiveTokensAvoided: 200,
          startedAt: secondStart,
          endedAt: new Date(secondStart.getTime() + 10),
        },
        { repository: spiedRepo }
      ),
    ]);

    assert.equal(counts.listRuns, 0);
    assert.equal(counts.getScorecard, 0);
    assert.equal(counts.listChangelog, 0);
    assert.equal(counts.getConfig, 0);
    assert.deepEqual(observedRecentCounts, [
      RECENT_RUN_RECORDS_LIMIT,
      RECENT_RUN_RECORDS_LIMIT,
    ]);

    const finalScorecard = await baseRepo.getEfficiencyScorecard();
    assert.equal(finalScorecard.totalRunsCount, 62);
    assert.equal(finalScorecard.deterministicRunsCount, 62);
    assert.equal(finalScorecard.naiveTokensAvoided, 6_300);
    assert.equal(finalScorecard.recentRuns.length, RECENT_RUN_RECORDS_LIMIT);
    assert.equal(finalScorecard.subsequentDeterministicRunsServed, 62);

    const changelog = await baseRepo.listRepairChangelog("tdlr-tabs");
    assert.equal(changelog[0]?.subsequentDeterministicRunsServed, 0);
    assert.equal(changelog[1]?.subsequentDeterministicRunsServed, 62);
  });

  test("failed and aborted runs leave deterministic counters, savings, and changelog amortization unchanged", async () => {
    const repo = createInMemoryGridlockRepository();
    const v2Entry = buildChangelogEntry(2, "c".repeat(64));
    await repo.promoteConnectorConfig(
      { ...DEFAULT_TDLR_CONNECTOR_CONFIG, version: 2 },
      v2Entry,
      ({ currentScorecard }) => ({ updatedScorecard: currentScorecard })
    );

    const startedAt = new Date("2026-10-27T03:00:00.000Z");
    const endedAt = new Date("2026-10-27T03:00:01.000Z");
    const failedStatuses = [
      "aborted",
      "blocked_by_waf",
      "selector_anomaly",
    ] as const;

    for (const status of failedStatuses) {
      await recordStageRun(
        {
          stage: "tdlr_ingest",
          connectorId: "tdlr-tabs",
          execution_mode: "deterministic",
          status,
          rawByteLength: 4_000,
          tokensUsed: 0,
          naiveTokensAvoided: 1_000,
          startedAt,
          endedAt,
        },
        { repository: repo }
      );
    }

    await recordAgenticStageRun(
      {
        stage: "repair_agent",
        connectorId: "tdlr-tabs",
        status: "agentic_failed",
        tokensUsed: 50,
        startedAt,
        endedAt,
      },
      { repository: repo }
    );

    const scorecard = await repo.getEfficiencyScorecard();
    assert.equal(scorecard.failedOrBlockedRunsCount, 4);
    assert.equal(scorecard.deterministicRunsCount, 0);
    assert.equal(scorecard.agenticRunsCount, 0);
    assert.equal(scorecard.naiveTokensAvoided, 0);
    assert.equal(scorecard.estimatedCostSavedUsd, 0);

    const changelog = await repo.listRepairChangelog();
    assert.equal(changelog[0]?.subsequentDeterministicRunsServed, 0);
  });

  test("throwing or invalid transition callbacks leave repository state unchanged with zero partial writes", async () => {
    const repo = createInMemoryGridlockRepository();
    const captureHash = "c".repeat(64);
    const v2Entry = buildChangelogEntry(2, captureHash);
    const capture = buildCapture(captureHash, true);
    const gz = gzipSync(Buffer.from("<html>test</html>", "utf-8"));

    await repo.saveRawCapture(capture, gz);
    await repo.promoteConnectorConfig(
      { ...DEFAULT_TDLR_CONNECTOR_CONFIG, version: 2 },
      v2Entry,
      ({ currentScorecard }) => ({ updatedScorecard: currentScorecard })
    );

    const startedAt = new Date("2026-10-27T03:00:00.000Z");
    const endedAt = new Date("2026-10-27T03:00:01.000Z");
    await recordStageRun(
      {
        stage: "tdlr_ingest",
        connectorId: "tdlr-tabs",
        execution_mode: "deterministic",
        status: "aborted",
        rawByteLength: 4_000,
        tokensUsed: 0,
        naiveTokensAvoided: 1_000,
        startedAt,
        endedAt,
      },
      { repository: repo }
    );

    const beforeErrors = await repo.getEfficiencyScorecard();
    const validRun = beforeErrors.recentRuns[0];
    assert.ok(validRun);

    await assert.rejects(
      () =>
        repo.recordRunRecord(validRun, () => {
          throw new Error("Run transition boom");
        }),
      /Run transition boom/
    );
    await assert.rejects(
      () =>
        repo.recordRunRecord(validRun, ({ currentScorecard }) => ({
          updatedScorecard: currentScorecard,
          updatedChangelogEntry: { ...v2Entry, id: "repair_wrong_id" },
        })),
      /non-matching RepairChangelogEntry/
    );
    assert.deepEqual(await repo.getEfficiencyScorecard(), beforeErrors);
    assert.equal((await repo.listRunRecords()).length, 1);

    const v3Entry = buildChangelogEntry(3, captureHash);
    await assert.rejects(
      () =>
        repo.promoteConnectorConfig(
          { ...DEFAULT_TDLR_CONNECTOR_CONFIG, version: 3 },
          v3Entry,
          () => {
            throw new Error("Promotion boom");
          }
        ),
      /Promotion boom/
    );
    await assert.rejects(
      () =>
        repo.promoteConnectorConfig(
          { ...DEFAULT_TDLR_CONNECTOR_CONFIG, version: 3 },
          v3Entry,
          ({ currentScorecard }) => ({
            updatedScorecard: currentScorecard,
            promotedArtifact: buildCapture("d".repeat(64), true),
          })
        ),
      /artifact hash mismatch/
    );
    assert.equal((await repo.getActiveConnectorConfig("tdlr-tabs")).version, 2);
    assert.equal((await repo.listRepairChangelog()).length, 1);
    assert.deepEqual(await repo.getEfficiencyScorecard(), beforeErrors);

    assert.equal(
      await repo.updateRawCaptureMetadata("f".repeat(64), (existing) => existing),
      null
    );
    assert.deepEqual(
      await repo.updateRawCaptureMetadata(capture.sha256, () => null),
      capture
    );
    await assert.rejects(
      () =>
        repo.updateRawCaptureMetadata(capture.sha256, (existing) => ({
          ...existing,
          sha256: "e".repeat(64),
        })),
      /changed sha256/
    );
    assert.deepEqual(await repo.getRawCaptureByHash(capture.sha256), capture);
    assert.deepEqual(await repo.readArtifactGzip(capture.sha256), gz);
  });

  test("bootstrapCanvas pins canonical milestone RawCaptures via metadata-only updates without pinning quarantined captures or re-uploading .gz bytes", async () => {
    const baseRepo = createInMemoryGridlockRepository();
    const canonicalHash = "1".repeat(64);
    const quarantineHash = "2".repeat(64);
    const canonicalGz = gzipSync(Buffer.from(FROZEN_TABS_2027003697_HTML, "utf-8"));
    const quarantineGz = gzipSync(Buffer.from(MUTATED_PORTAL_V2_HTML, "utf-8"));
    const canonicalCapture = buildCapture(canonicalHash, false);
    const quarantineCapture = buildCapture(quarantineHash, true);

    await baseRepo.saveRawCapture(canonicalCapture, canonicalGz);
    await baseRepo.saveRawCapture(quarantineCapture, quarantineGz);

    const { spiedRepo, counts } = createSpiedRepository(baseRepo);
    const webp = createCorridorBaseCanvasWebp("gridlock-persistence-test");
    const painterClient: GeminiInteractionsClient = {
      interactions: {
        create: async () => ({
          id: "inter_paint_01",
          status: "completed",
          output_image: {
            data: webp.toString("base64"),
            mime_type: "image/webp",
          },
          usage: { total_tokens: 150 },
        }),
      },
    };

    const painted = await bootstrapCanvas(
      {
        observations: [
          buildMilestoneObservation("obs_canon", "TABS2027003697", canonicalHash),
          buildMilestoneObservation(
            "obs_quarantine",
            "TABS2027003698",
            quarantineHash
          ),
        ],
        now: new Date("2026-10-26T18:10:00.000Z"),
      },
      { repository: spiedRepo, geminiClient: painterClient }
    );

    assert.equal(painted.status, "illustration_painted");
    assert.equal(counts.saveRawCapture, 0);
    assert.equal(counts.readArtifactGzip, 0);

    const pinnedCanon = await baseRepo.getRawCaptureByHash(canonicalHash);
    assert.equal(pinnedCanon?.referencedByMilestone, true);
    assert.equal(pinnedCanon?.expiresAt, null);
    assert.deepEqual(await baseRepo.readArtifactGzip(canonicalHash), canonicalGz);

    const unpinnedQuarantine = await baseRepo.getRawCaptureByHash(quarantineHash);
    assert.equal(unpinnedQuarantine?.referencedByMilestone, false);
    assert.equal(unpinnedQuarantine?.expiresAt, quarantineCapture.expiresAt);
  });

  test("rejected repair leaves connector config, changelog, scorecard MTTR, and quarantined RawCapture untouched", async () => {
    const baseRepo = createInMemoryGridlockRepository();
    const quarantineHash = "2".repeat(64);
    const quarantineGz = gzipSync(Buffer.from(MUTATED_PORTAL_V2_HTML, "utf-8"));
    const quarantineCapture = buildCapture(quarantineHash, true);
    await baseRepo.saveRawCapture(quarantineCapture, quarantineGz);

    const { spiedRepo } = createSpiedRepository(baseRepo);
    const badRepairClient: GeminiInteractionsClient = {
      interactions: {
        create: async () => ({
          id: "inter_bad",
          output_text: "{not-json",
          usage: { total_tokens: 80 },
        }),
      },
    };

    const rejected = await runOutOfBandRepairAgent(
      {
        quarantinedArtifact: quarantineCapture,
        brokenInvariants: ["document: Missing detailContainerSelector"],
        historicalFixtures: [FROZEN_TABS_2027003697_HTML],
        now: new Date("2026-10-26T18:15:00.000Z"),
      },
      { repository: spiedRepo, geminiClient: badRepairClient }
    );

    assert.equal(rejected.status, "repair_rejected");
    assert.equal((await baseRepo.getActiveConnectorConfig("tdlr-tabs")).version, 1);
    assert.equal((await baseRepo.listRepairChangelog()).length, 0);
    assert.equal(
      (await baseRepo.getEfficiencyScorecard()).averageRepairMttrMs,
      DEFAULT_EFFICIENCY_SCORECARD.averageRepairMttrMs
    );
    assert.equal(
      (await baseRepo.getRawCaptureByHash(quarantineHash))?.expiresAt,
      quarantineCapture.expiresAt
    );
  });

  test("promoted repair updates quarantined RawCapture metadata atomically with zero .gz re-uploads and zero unlocked reads", async () => {
    const baseRepo = createInMemoryGridlockRepository();
    const quarantineHash = "2".repeat(64);
    const quarantineGz = gzipSync(Buffer.from(MUTATED_PORTAL_V2_HTML, "utf-8"));
    const quarantineCapture = buildCapture(quarantineHash, true);
    await baseRepo.saveRawCapture(quarantineCapture, quarantineGz);

    const { spiedRepo, counts } = createSpiedRepository(baseRepo);
    const goodRepairClient: GeminiInteractionsClient = {
      interactions: {
        create: async () => ({
          id: "inter_good",
          output_text: JSON.stringify({
            detailContainerSelector: ".project-details, .tabs-project-details-v2",
            fieldLabels: {
              estimatedCost: "Estimated Cost:|Total Estimated Cost:",
            },
            rootCauseSummary:
              "TDLR TABS migrated detail container and estimated cost label",
          }),
          usage: { total_tokens: 220 },
        }),
      },
    };

    const promoted = await runOutOfBandRepairAgent(
      {
        quarantinedArtifact: quarantineCapture,
        brokenInvariants: ["document: Missing detailContainerSelector"],
        historicalFixtures: [FROZEN_TABS_2027003697_HTML],
        anomalyDetectedAt: new Date("2026-10-26T18:00:00.000Z"),
        now: new Date("2026-10-26T18:00:05.000Z"),
      },
      { repository: spiedRepo, geminiClient: goodRepairClient }
    );

    assert.equal(promoted.status, "repair_promoted");
    assert.equal(counts.saveRawCapture, 0);
    assert.equal(counts.listChangelog, 0);
    assert.equal(counts.getScorecard, 0);
    assert.equal(counts.getRawCapture, 0);

    const promotedCapture = await baseRepo.getRawCaptureByHash(quarantineHash);
    assert.equal(promotedCapture?.referencedByMilestone, true);
    assert.equal(promotedCapture?.expiresAt, null);
    assert.ok(promotedCapture?.storageUri.includes("/quarantine/"));
    assert.deepEqual(
      await baseRepo.readArtifactGzip(quarantineHash),
      quarantineGz
    );
    assert.equal(
      (await baseRepo.getEfficiencyScorecard()).averageRepairMttrMs,
      5_000
    );
  });
});
