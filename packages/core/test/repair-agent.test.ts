import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  applyConnectorPromotion,
  applyHealAmortization,
  CandidateSelectorPatchSchema,
  createInMemoryGridlockRepository,
  DEFAULT_EFFICIENCY_LEDGER,
  DEFAULT_TDLR_CONNECTOR_CONFIG,
  ingestTdlrFiling,
  REPAIR_AGENT_MODEL,
  RepairChangelogEntrySchema,
  runOutOfBandRepairAgent,
  type GeminiInteractionCreateRequest,
  type GeminiInteractionsClient,
  type TelemetrySpan,
} from "../src/index.ts";
import {
  evaluatePullRequestLineBudget,
  evaluateSourceFileLintRules,
  runRepoLintChecks,
} from "../../../scripts/lint-checks.mjs";
import {
  HISTORICAL_FIXTURE_V1_HTML,
  MUTATED_PORTAL_V2_HTML,
} from "./helpers/fixtures.ts";
import {
  startMockPortalServer,
  type MockPortalRoute,
  type MockPortalServerHarness,
} from "./helpers/mock-portal-server.ts";

describe("Out-of-Band Repair Agent & Sandbox Replay Gate (Seam 2 Core, Ticket #5 & #17)", () => {
  let harness: MockPortalServerHarness;
  let baseUrl: string;
  let routeMap: Map<string, MockPortalRoute>;

  beforeEach(async () => {
    harness = await startMockPortalServer({ defaultRobotsAllowAll: true });
    baseUrl = harness.baseUrl;
    routeMap = harness.routeMap;
  });

  afterEach(async () => {
    await harness.close();
  });

  test("Happy Path: mutated TDLR HTML triggers selector_anomaly, invokes gemini-3.8-flash Repair Agent, passes 100% of historical + quarantined fixtures in Sandbox Replay Gate, promotes ConnectorConfig v2, writes RepairChangelogEntry, and increments subsequentDeterministicRunsServed on following runs", async () => {
    routeMap.set("/TABS/Search/Project/TABS2027009888", {
      status: 200,
      body: MUTATED_PORTAL_V2_HTML,
    });

    const repository = createInMemoryGridlockRepository();
    const anomalyDetectedAt = new Date("2026-10-26T18:00:00.000Z");

    // 1. Mutated markup triggers selector_anomaly and quarantines SourceArtifact with referencedByMilestone: true
    const anomalyResult = await ingestTdlrFiling(
      {
        projectNumber: "TABS2027009888",
        baseUrl,
        now: anomalyDetectedAt,
      },
      { repository }
    );
    assert.equal(anomalyResult.status, "selector_anomaly");
    assert.equal(anomalyResult.sourceArtifact.referencedByMilestone, true);
    assert.ok(anomalyResult.sourceArtifact.storageUri.includes("/quarantine/"));
    assert.equal((await repository.listProjects()).length, 0);

    // 2. Out-of-Band Repair Agent synthesizes backward-compatible selector patch via gemini-3.8-flash
    const recordedRequests: GeminiInteractionCreateRequest[] = [];
    const emittedSpans: TelemetrySpan[] = [];
    const candidatePatch = CandidateSelectorPatchSchema.parse({
      detailContainerSelector: ".project-details, .tabs-project-details-v2",
      fieldLabels: {
        estimatedCost: "Estimated Cost: | Total Estimated Cost:",
      },
      rootCauseSummary:
        "TDLR renamed container class to .tabs-project-details-v2 and label to Total Estimated Cost:.",
    });

    const geminiClient: GeminiInteractionsClient = {
      interactions: {
        async create(req) {
          recordedRequests.push(req);
          return {
            id: "inter_repair_v2_001",
            status: "completed",
            output_text: JSON.stringify(candidatePatch),
            usage: { total_tokens: 420 },
          };
        },
      },
    };

    const patchPromotedAt = new Date("2026-10-26T18:00:02.450Z");
    const repairResult = await runOutOfBandRepairAgent(
      {
        connectorId: "tdlr-tabs",
        quarantinedArtifact: anomalyResult.sourceArtifact,
        brokenInvariants: anomalyResult.invariantErrors,
        historicalFixtures: [HISTORICAL_FIXTURE_V1_HTML],
        anomalyDetectedAt,
        now: patchPromotedAt,
      },
      {
        repository,
        geminiClient,
        spanSink: (span) => emittedSpans.push(span),
      }
    );

    assert.equal(repairResult.status, "repair_promoted");
    assert.equal(recordedRequests.length, 1);
    assert.equal(recordedRequests[0]?.model, REPAIR_AGENT_MODEL);
    assert.equal(recordedRequests[0]?.response_format?.mime_type, "application/json");

    // Verify promoted ConnectorConfig v2
    const activeConfig = await repository.getActiveConnectorConfig("tdlr-tabs");
    assert.equal(activeConfig.version, 2);
    assert.equal(activeConfig.status, "healthy");
    assert.equal(
      activeConfig.detailContainerSelector,
      ".project-details, .tabs-project-details-v2"
    );
    assert.equal(
      activeConfig.fieldLabels.estimatedCost,
      "Estimated Cost: | Total Estimated Cost:"
    );

    // Verify RepairChangelogEntry
    const entry = RepairChangelogEntrySchema.parse(repairResult.changelogEntry);
    assert.equal(entry.previousVersion, 1);
    assert.equal(entry.promotedVersion, 2);
    assert.equal(entry.mttrMs, 2450);
    assert.equal(entry.repairTokensUsed, 420);
    assert.equal(entry.historicalFixturesTested, 1);
    assert.equal(entry.historicalFixturesPassed, 1);
    assert.equal(entry.totalFixturesVerified, 2);
    assert.equal(entry.subsequentDeterministicRunsServed, 0);
    assert.equal(entry.selectorDiffs.length, 2);
    assert.equal(entry.expiresAt, null);

    // Verify agentic span emitted
    assert.equal(emittedSpans.at(-1)?.execution_mode, "agentic");
    assert.equal(emittedSpans.at(-1)?.interactionId, "inter_repair_v2_001");
    assert.equal(emittedSpans.at(-1)?.tokensUsed, 420);

    // 3. Subsequent deterministic runs use healed v2 config, re-parse quarantined filing, and increment subsequentDeterministicRunsServed
    const healedIngest = await ingestTdlrFiling(
      {
        projectNumber: "TABS2027009888",
        baseUrl,
        now: new Date("2026-10-26T18:05:00.000Z"),
      },
      { repository }
    );
    assert.equal(healedIngest.status, "ingested");
    assert.ok(healedIngest.sourceArtifact.storageUri.includes("/artifacts/"));

    const secondHealedRun = await ingestTdlrFiling(
      {
        projectNumber: "TABS2027009888",
        baseUrl,
        now: new Date("2026-10-26T18:10:00.000Z"),
      },
      { repository }
    );
    assert.equal(secondHealedRun.status, "unchanged_artifact");

    const changelog = await repository.listRepairChangelog("tdlr-tabs");
    assert.equal(changelog.length, 1);
    assert.equal(changelog[0]?.subsequentDeterministicRunsServed, 2);

    const ledger = await repository.getEfficiencyLedger();
    assert.equal(ledger.subsequentDeterministicRunsServed, 2);
    assert.equal(ledger.averageRepairMttrMs, 2450);
  });

  test("Sad Path (Fail-Closed): rejects patches that fix the quarantined artifact but regress 1 historical fixture, malformed/unparseable JSON, or Gemini timeouts, leaving connector in selector_anomaly with zero promotion or unverified writes", async () => {
    routeMap.set("/TABS/Search/Project/TABS2027009888", {
      status: 200,
      body: MUTATED_PORTAL_V2_HTML,
    });

    const repository = createInMemoryGridlockRepository();
    const anomalyResult = await ingestTdlrFiling(
      {
        projectNumber: "TABS2027009888",
        baseUrl,
        now: new Date("2026-10-26T19:00:00.000Z"),
      },
      { repository }
    );
    assert.equal(anomalyResult.status, "selector_anomaly");

    // Case 1: Candidate patch fixes quarantined V2 HTML but regresses historical V1 HTML
    const regressingPatchResult = await runOutOfBandRepairAgent(
      {
        connectorId: "tdlr-tabs",
        quarantinedArtifact: anomalyResult.sourceArtifact,
        brokenInvariants: anomalyResult.invariantErrors,
        historicalFixtures: [HISTORICAL_FIXTURE_V1_HTML],
        now: new Date("2026-10-26T19:00:01.000Z"),
      },
      {
        repository,
        geminiClient: {
          interactions: {
            async create() {
              return {
                id: "inter_regress_01",
                status: "completed",
                output_text: JSON.stringify({
                  detailContainerSelector: ".tabs-project-details-v2",
                  fieldLabels: { estimatedCost: "Total Estimated Cost:" },
                  rootCauseSummary: "Replaced v1 selectors instead of preserving compatibility",
                }),
                usage: { total_tokens: 310 },
              };
            },
          },
        },
      }
    );

    assert.equal(regressingPatchResult.status, "repair_rejected");
    assert.equal(regressingPatchResult.connectorStatus, "selector_anomaly");
    assert.equal(regressingPatchResult.replay?.quarantinedPassed, true);
    assert.equal(regressingPatchResult.replay?.historicalFixturesTested, 1);
    assert.equal(regressingPatchResult.replay?.historicalFixturesPassed, 0);

    // Case 2: Malformed / unparseable JSON response from Gemini
    const malformedJsonResult = await runOutOfBandRepairAgent(
      {
        connectorId: "tdlr-tabs",
        quarantinedArtifact: anomalyResult.sourceArtifact,
        brokenInvariants: anomalyResult.invariantErrors,
        historicalFixtures: [HISTORICAL_FIXTURE_V1_HTML],
        now: new Date("2026-10-26T19:00:02.000Z"),
      },
      {
        repository,
        geminiClient: {
          interactions: {
            async create() {
              return {
                id: "inter_malformed_02",
                status: "completed",
                output_text: "{not-valid-json",
                usage: { total_tokens: 95 },
              };
            },
          },
        },
      }
    );
    assert.equal(malformedJsonResult.status, "repair_rejected");
    assert.match(malformedJsonResult.reason, /Malformed JSON/);

    // Case 3: Gemini request timeout / network rejection
    const timeoutResult = await runOutOfBandRepairAgent(
      {
        connectorId: "tdlr-tabs",
        quarantinedArtifact: anomalyResult.sourceArtifact,
        brokenInvariants: anomalyResult.invariantErrors,
        historicalFixtures: [HISTORICAL_FIXTURE_V1_HTML],
        now: new Date("2026-10-26T19:00:03.000Z"),
      },
      {
        repository,
        geminiClient: {
          interactions: {
            async create() {
              throw new Error("Deadline exceeded: Gemini interactions.create timed out");
            },
          },
        },
      }
    );
    assert.equal(timeoutResult.status, "repair_rejected");
    assert.match(timeoutResult.reason, /timed out/);

    // Verify fail-closed invariants: config remains v1 in selector_anomaly, 0 changelog entries, 0 projects
    const configAfterFailures = await repository.getActiveConnectorConfig("tdlr-tabs");
    assert.equal(configAfterFailures.version, 1);
    assert.equal(configAfterFailures.status, "selector_anomaly");
    assert.equal((await repository.listRepairChangelog("tdlr-tabs")).length, 0);
    assert.equal((await repository.listProjects()).length, 0);

    const ledger = await repository.getEfficiencyLedger();
    assert.equal(ledger.agenticRunsCount, 0);
    assert.equal(ledger.failedOrBlockedRunsCount, 4); // 1 selector_anomaly + 3 rejected repairs
    assert.equal(ledger.actualTokensUsed, 405); // 310 + 95 + 0
  });

  test("Clean Architecture Prefactor (Ticket #17): pure state transitions and repository lint guardrails pass on valid layout and fail on >300-line files, unapproved root directories, or upward layer imports", () => {
    // 1. Happy Path: entire workspace passes Clean Architecture lint checks
    assert.deepEqual(runRepoLintChecks(), []);

    // Pure applyHealAmortization and applyConnectorPromotion transitions work deterministically without I/O
    const sampleEntry = RepairChangelogEntrySchema.parse({
      id: "repair_tdlr-tabs_v2_aaaaaaaa",
      connectorId: "tdlr-tabs",
      previousVersion: 1,
      promotedVersion: 2,
      quarantinedArtifactHash: "a".repeat(64),
      brokenInvariants: ["document: Missing detailContainerSelector"],
      selectorDiffs: [
        {
          field: "detailContainerSelector",
          before: ".project-details",
          after: ".project-details, .tabs-project-details-v2",
        },
      ],
      rootCauseSummary: "Portal container class updated",
      historicalFixturesTested: 1,
      historicalFixturesPassed: 1,
      totalFixturesVerified: 2,
      anomalyDetectedAt: "2026-10-26T18:00:00.000Z",
      patchPromotedAt: "2026-10-26T18:00:02.000Z",
      mttrMs: 2000,
      interactionId: "inter_unit_01",
      repairTokensUsed: 200,
      estimatedRepairCostUsd: 0.0005,
      subsequentDeterministicRunsServed: 0,
      expiresAt: null,
    });

    const promoted = applyConnectorPromotion({
      changelogEntry: sampleEntry,
      allChangelogEntries: [sampleEntry],
      quarantinedArtifact: undefined,
      ledger: DEFAULT_EFFICIENCY_LEDGER,
    });
    assert.equal(promoted.updatedLedger.averageRepairMttrMs, 2000);

    const amortized = applyHealAmortization({
      run: {
        runId: "run_1",
        stage: "tdlr_ingest",
        connectorId: "tdlr-tabs",
        execution_mode: "deterministic",
        status: "ingested",
        durationMs: 12,
        rawByteLength: 1024,
        tokensUsed: 0,
        naiveTokensAvoided: 256,
        estimatedCostSavedUsd: 0.00064,
        recordedAt: "2026-10-26T18:05:00.000Z",
        expiresAt: null,
      },
      activeConfig: { ...DEFAULT_TDLR_CONNECTOR_CONFIG, version: 2 },
      repairChangelog: [sampleEntry],
      ledger: promoted.updatedLedger,
    });
    assert.equal(amortized.updatedChangelog[0]?.subsequentDeterministicRunsServed, 1);
    assert.equal(amortized.updatedLedger.subsequentDeterministicRunsServed, 1);

    // 2. Sad Path: >300-line file, unapproved directory, and upward layer imports are rejected
    const oversizedContent = Array.from({ length: 305 }, () => "export const x = 1;").join("\n");
    const oversizedViolations = evaluateSourceFileLintRules(
      "packages/core/src/use-cases/oversized.ts",
      oversizedContent
    );
    assert.ok(oversizedViolations.some((v) => v.includes("exceeds 300-line core module budget")));

    const looseRootViolations = evaluateSourceFileLintRules(
      "packages/core/src/tdlr-connector.ts",
      "export const x = 1;"
    );
    assert.ok(looseRootViolations.some((v) => v.includes("Must reside inside interfaces/")));

    const upwardInterfaceImportViolations = evaluateSourceFileLintRules(
      "packages/core/src/interfaces/bad-model.ts",
      "import { defaultPageLoader } from \"../adapters/http-loaders.ts\";"
    );
    assert.ok(
      upwardInterfaceImportViolations.some((v) =>
        v.includes("interfaces/ must not import")
      )
    );

    const controllerAdapterImportViolations = evaluateSourceFileLintRules(
      "packages/core/src/controllers/bad-controller.ts",
      "import { createInMemoryGridlockRepository } from \"../adapters/in-memory-repository.ts\";"
    );
    assert.ok(
      controllerAdapterImportViolations.some((v) =>
        v.includes("controllers/ must delegate to use-cases/ orchestrators and not import from adapters/")
      )
    );

    const controllerHelperBypassViolations = evaluateSourceFileLintRules(
      "packages/core/src/controllers/bad-controller-2.ts",
      "import { verifySiteAccess } from \"../use-cases/helpers/site-access.ts\";"
    );
    assert.ok(
      controllerHelperBypassViolations.some((v) =>
        v.includes("controllers/ must delegate to use-cases/ orchestrators and not import from use-cases/helpers/")
      )
    );

    const useCaseAdapterImportViolations = evaluateSourceFileLintRules(
      "packages/core/src/use-cases/bad-use-case.ts",
      "import { defaultPageLoader } from \"../adapters/http-loaders.ts\";"
    );
    assert.ok(
      useCaseAdapterImportViolations.some((v) =>
        v.includes("use-cases/ must not import from outer adapters/")
      )
    );

    const rootBarrelBypassViolations = evaluateSourceFileLintRules(
      "packages/core/src/use-cases/bad-barrel.ts",
      "import { defaultPageLoader } from \"../index.ts\";"
    );
    assert.ok(
      rootBarrelBypassViolations.some((v) =>
        v.includes("internal modules must not import the root barrel")
      )
    );

    const dotDotSlashBypassViolations = evaluateSourceFileLintRules(
      "packages/core/src/use-cases/helpers/bad-helper-path.ts",
      "import { recordStageTelemetry } from \"./../record-telemetry.ts\";"
    );
    assert.ok(
      dotDotSlashBypassViolations.some((v) =>
        v.includes("use-cases/helpers/ must remain pure")
      )
    );

    const adapterUseCaseImportViolations = evaluateSourceFileLintRules(
      "packages/core/src/adapters/bad-adapter.ts",
      "const mod = await import(\"../use-cases/helpers/telemetry-math.ts\");"
    );
    assert.ok(
      adapterUseCaseImportViolations.some((v) =>
        v.includes("adapters/ must only import from interfaces/")
      )
    );

    const mutativeStyleViolations = evaluateSourceFileLintRules(
      "packages/core/src/use-cases/helpers/bad-style.ts",
      [
        "let count = 0;",
        "for (const item of items) { count += item; }",
        'const origin = "https://www.tdlr.texas.gov"; items.forEach((item) => push(origin, item));',
      ].join("\n")
    );
    assert.ok(
      mutativeStyleViolations.some((v) => v.includes("Avoid mutable `let`"))
    );
    assert.ok(
      mutativeStyleViolations.some((v) => v.includes("Avoid imperative `for (...)`"))
    );
    assert.ok(
      mutativeStyleViolations.some((v) => v.includes("Avoid side-effecting `.forEach(...)`"))
    );

    const barrelHelperLeakViolations = evaluateSourceFileLintRules(
      "packages/core/src/index.ts",
      [
        "export {\n  // legacy helper\n  verifySiteAccess,\n} from \"./use-cases/helpers/site-access.ts\";",
        "export { applyScenarioBranchWatermarkToWebp } from \"./use-cases/helpers/webp-codec.ts\";",
        "export { applyScenarioBranchWatermarkToWebp as isWebpBuffer } from \"./use-cases/helpers/webp-codec.ts\";",
        "import { readRiffChunks } from \"./use-cases/helpers/webp-codec.ts\";",
      ].join("\n")
    );
    assert.equal(barrelHelperLeakViolations.length, 3);
    assert.ok(
      barrelHelperLeakViolations.some((v) =>
        v.includes("symbol \"applyScenarioBranchWatermarkToWebp\"")
      )
    );
    assert.ok(
      barrelHelperLeakViolations.some((v) =>
        v.includes("symbol \"applyScenarioBranchWatermarkToWebp as isWebpBuffer\"")
      )
    );
    assert.ok(
      barrelHelperLeakViolations.some((v) =>
        v.includes("importing or wildcard re-exporting internal use-cases/helpers/")
      )
    );

    const testSeamBypassViolations = evaluateSourceFileLintRules(
      "packages/widgets/test/seam-bypass.test.ts",
      [
        "import { bootstrapCanvas } from \"../../core/src/index.ts\";",
        "import { isWebpBuffer } from \"../../core/src/use-cases/helpers/webp-codec.ts\";",
      ].join("\n")
    );
    assert.equal(testSeamBypassViolations.length, 1);
    assert.ok(
      testSeamBypassViolations[0]?.includes(
        "tests must import through the public package barrel"
      )
    );

    assert.deepEqual(
      evaluatePullRequestLineBudget({
        insertions: 520,
        deletions: 180,
        baseRef: "origin/main",
      }),
      []
    );
    assert.equal(
      evaluatePullRequestLineBudget({
        insertions: 650,
        deletions: 51,
        baseRef: "origin/main",
      }).length,
      1
    );

    const impureHelperImportViolations = evaluateSourceFileLintRules(
      "packages/core/src/use-cases/helpers/bad-helper.ts",
      "import { defaultPageLoader } from \"../../adapters/http-loaders.ts\";"
    );
    assert.ok(
      impureHelperImportViolations.some((v) =>
        v.includes("use-cases/helpers/ must remain pure")
      )
    );
  });
});
