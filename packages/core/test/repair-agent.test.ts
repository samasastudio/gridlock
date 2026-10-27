import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  CandidateSelectorPatchSchema,
  createInMemoryGridlockRepository,
  ingestTdlrFiling,
  REPAIR_AGENT_MODEL,
  RepairChangelogEntrySchema,
  runOutOfBandRepairAgent,
  type GeminiInteractionCreateRequest,
  type GeminiInteractionsClient,
  type TelemetrySpan,
} from "../src/index.ts";

const HISTORICAL_FIXTURE_V1_HTML = `<!DOCTYPE html>
<html lang="en">
<head><title>TDLR TABS - Historical Filing</title></head>
<body>
<div class="project-details">
  <div class="project-details-project">
    <dl class="dl-horizontal">
      <dt>Project Name:</dt>
      <dd>Compass Datacenters - DFWIII-III - Building 10</dd>
      <dt>Project Number:</dt>
      <dd>TABS2027003697</dd>
      <dt>Facility Name:</dt>
      <dd>DFWIII III - Building 10</dd>
      <dt>Location Address:</dt>
      <dd>590 Austin Blvd</dd>
      <dd>Red Oak, TX 75154</dd>
      <dt>Location County:</dt>
      <dd>Ellis</dd>
      <dt>Start Date:</dt>
      <dd>12/1/2024</dd>
      <dt>Completion Date:</dt>
      <dd>8/22/2028</dd>
      <dt>Estimated Cost:</dt>
      <dd>$100,000,000</dd>
      <dt>Type of Work:</dt>
      <dd>Renovation/Alteration</dd>
      <dt>Scope of Work:</dt>
      <dd>251,815 sq. ft Data Center fit-out.</dd>
      <dt>Square Footage:</dt>
      <dd>251,815 ft <sup>2</sup></dd>
      <dt>Current Status:</dt>
      <dd>Project Registered</dd>
      <dt>Owner Name:</dt>
      <dd>COMPASS DATACENTERS DFW III-I LLC</dd>
    </dl>
  </div>
</div>
</body>
</html>`;

const MUTATED_PORTAL_V2_HTML = HISTORICAL_FIXTURE_V1_HTML
  .replace('<div class="project-details">', '<div class="tabs-project-details-v2">')
  .replace("<dt>Estimated Cost:</dt>", "<dt>Total Estimated Cost:</dt>")
  .replace("<dd>TABS2027003697</dd>", "<dd>TABS2027009888</dd>");

describe("Out-of-Band Repair Agent & Sandbox Replay Gate (Seam 2 Core, Ticket #5)", () => {
  let server: Server;
  let baseUrl: string;
  let routeMap: Map<
    string,
    { status?: number; headers?: Record<string, string>; body: string }
  >;

  beforeEach(async () => {
    routeMap = new Map();
    routeMap.set("/robots.txt", {
      status: 200,
      headers: { "content-type": "text/plain" },
      body: "User-agent: *\nAllow: /\n",
    });
    server = createServer((req, res) => {
      const route = routeMap.get(req.url ?? "");
      if (!route) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("Not Found");
        return;
      }
      res.writeHead(route.status ?? 200, {
        "content-type": "text/html; charset=utf-8",
        ...(route.headers ?? {}),
      });
      res.end(route.body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
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
});
