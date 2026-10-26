import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  calculateNaiveTokensAvoided,
  calculateEstimatedCostSavedUsd,
  createCloudLoggingSpanSink,
  createGridlockHttpServer,
  createInMemoryGridlockRepository,
  EfficiencyLedgerSchema,
  ingestTdlrFiling,
  recordAgenticStageTelemetry,
  runTdlrDiscoverySweep,
  TelemetryRunSchema,
  TelemetrySpanSchema,
  type TelemetrySpan,
} from "../src/index.ts";

const FROZEN_TABS_2027003697_HTML = `<!DOCTYPE html>
<html lang="en">
<head><title>TDLR TABS - Project Details</title></head>
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

describe("Efficiency Ledger & Cloud Trace Spans (Ticket #4)", () => {
  let server: Server;
  let baseUrl: string;
  let routeMap: Map<
    string,
    { status?: number; headers?: Record<string, string>; body: string }
  >;

  beforeEach(async () => {
    routeMap = new Map();
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

  test("Happy Path: fresh deterministic extraction and duplicate SHA-256 short-circuit atomically increment naiveTokensAvoided, deterministicRunsCount, and estimatedCostSavedUsd, write permanent telemetry_runs (expiresAt: null), and emit execution_mode: 'deterministic' spans", async () => {
    routeMap.set("/robots.txt", {
      status: 200,
      headers: { "content-type": "text/plain" },
      body: "User-agent: *\nAllow: /\n",
    });
    routeMap.set("/TABS/Search/Project/TABS2027003697", {
      status: 200,
      body: FROZEN_TABS_2027003697_HTML,
    });

    const repository = createInMemoryGridlockRepository();
    const emittedSpans: TelemetrySpan[] = [];
    const structuredLogs: string[] = [];
    const cloudLogSink = createCloudLoggingSpanSink((line) => {
      structuredLogs.push(line);
    });
    const spanSink = (span: TelemetrySpan) => {
      emittedSpans.push(span);
      cloudLogSink(span);
    };

    const rawByteLength = Buffer.byteLength(FROZEN_TABS_2027003697_HTML, "utf-8");
    const expectedTokensPerRun = Math.ceil(rawByteLength / 4);
    assert.equal(calculateNaiveTokensAvoided(rawByteLength), expectedTokensPerRun);
    const expectedCostPerRun = calculateEstimatedCostSavedUsd(expectedTokensPerRun);
    assert.ok(expectedCostPerRun > 0);

    // Run 1: Fresh deterministic extraction
    const firstResult = await ingestTdlrFiling(
      {
        projectNumber: "TABS2027003697",
        baseUrl,
        now: new Date("2026-10-26T14:00:00.000Z"),
      },
      { repository, spanSink }
    );
    assert.equal(firstResult.status, "ingested");

    // Run 2: Duplicate SHA-256 content-hash short-circuit
    const secondResult = await ingestTdlrFiling(
      {
        projectNumber: "TABS2027003697",
        baseUrl,
        now: new Date("2026-10-26T14:05:00.000Z"),
      },
      { repository, spanSink }
    );
    assert.equal(secondResult.status, "unchanged_artifact");

    // Verify EfficiencyLedger summary
    const ledger = EfficiencyLedgerSchema.parse(
      await repository.getEfficiencyLedger()
    );
    assert.equal(ledger.deterministicRunsCount, 2);
    assert.equal(ledger.agenticRunsCount, 0);
    assert.equal(ledger.failedOrBlockedRunsCount, 0);
    assert.equal(ledger.totalRunsCount, 2);
    assert.equal(ledger.naiveTokensAvoided, expectedTokensPerRun * 2);
    assert.equal(ledger.actualTokensUsed, 0);
    assert.equal(ledger.deterministicExecutionRatio, 1);
    assert.equal(ledger.deterministicExecutionPercentage, 100);
    assert.equal(ledger.tokenReductionPercentage, 100);
    assert.equal(
      ledger.estimatedCostSavedUsd,
      Number((expectedCostPerRun * 2).toFixed(8))
    );
    assert.equal(ledger.expiresAt, null);
    assert.equal(ledger.recentRuns.length, 2);

    // Verify permanent telemetry_runs records (expiresAt: null)
    const runs = await repository.listTelemetryRuns();
    assert.equal(runs.length, 2);
    for (const run of runs) {
      const parsedRun = TelemetryRunSchema.parse(run);
      assert.equal(parsedRun.execution_mode, "deterministic");
      assert.equal(parsedRun.tokensUsed, 0);
      assert.equal(parsedRun.naiveTokensAvoided, expectedTokensPerRun);
      assert.equal(parsedRun.rawByteLength, rawByteLength);
      assert.equal(parsedRun.expiresAt, null);
      assert.equal(parsedRun.interactionId, undefined);
    }
    assert.equal(runs[0]?.status, "ingested");
    assert.equal(runs[1]?.status, "unchanged_artifact");

    // Verify structured Cloud Trace / Logging spans
    assert.equal(emittedSpans.length, 2);
    for (const span of emittedSpans) {
      const parsedSpan = TelemetrySpanSchema.parse(span);
      assert.equal(parsedSpan.execution_mode, "deterministic");
      assert.equal(parsedSpan.tokensUsed, 0);
      assert.equal(parsedSpan.naiveTokensAvoided, expectedTokensPerRun);
      assert.ok(parsedSpan.durationMs >= 0);
      assert.equal(parsedSpan.interactionId, undefined);
    }
    assert.equal(structuredLogs.length, 2);
    const parsedCloudLog = JSON.parse(structuredLogs[0]!) as Record<string, unknown>;
    assert.equal(parsedCloudLog.execution_mode, "deterministic");
    assert.equal(parsedCloudLog.naiveTokensAvoided, expectedTokensPerRun);
    assert.equal(parsedCloudLog.tokensUsed, 0);
    assert.ok(typeof parsedCloudLog["logging.googleapis.com/trace"] === "string");
    assert.ok(typeof parsedCloudLog["logging.googleapis.com/spanId"] === "string");
  });

  test("Sad Path & Agentic Spans: blocked_by_waf, selector_anomaly, and aborted runs record failure telemetry without inflating naiveTokensAvoided or deterministicRunsCount; agentic runs emit interactionId spans and update token reduction ratios", async () => {
    const repository = createInMemoryGridlockRepository();
    const emittedSpans: TelemetrySpan[] = [];
    const spanSink = (span: TelemetrySpan) => {
      emittedSpans.push(span);
    };

    // 1. WAF block (HTTP 403 Imperva)
    routeMap.set("/robots.txt", {
      status: 200,
      headers: { "content-type": "text/plain" },
      body: "User-agent: *\nAllow: /\n",
    });
    routeMap.set("/TABS/Search/Project/TABS2027003697", {
      status: 403,
      body: "<html><iframe src='/_Incapsula_Resource?SWJIYLWA=1'></iframe></html>",
    });

    const wafResult = await ingestTdlrFiling(
      {
        projectNumber: "TABS2027003697",
        baseUrl,
        now: new Date("2026-10-26T15:00:00.000Z"),
      },
      { repository, spanSink }
    );
    assert.equal(wafResult.status, "blocked_by_waf");

    // 2. Selector anomaly (missing container)
    routeMap.set("/TABS/Search/Project/TABS2027003697", {
      status: 200,
      body: "<html><body><div class='broken-layout'>No details</div></body></html>",
    });
    const anomalyResult = await ingestTdlrFiling(
      {
        projectNumber: "TABS2027003697",
        baseUrl,
        now: new Date("2026-10-26T15:05:00.000Z"),
      },
      { repository, spanSink }
    );
    assert.equal(anomalyResult.status, "selector_anomaly");

    // 3. Aborted run (network failure in pageLoader)
    await assert.rejects(
      () =>
        ingestTdlrFiling(
          {
            projectNumber: "TABS2027003697",
            baseUrl,
            now: new Date("2026-10-26T15:10:00.000Z"),
          },
          {
            repository,
            spanSink,
            pageLoader: async () => {
              throw new Error("Simulated ECONNRESET");
            },
          }
        ),
      /Simulated ECONNRESET/
    );

    const ledgerAfterFailures = await repository.getEfficiencyLedger();
    assert.equal(ledgerAfterFailures.deterministicRunsCount, 0);
    assert.equal(ledgerAfterFailures.naiveTokensAvoided, 0);
    assert.equal(ledgerAfterFailures.estimatedCostSavedUsd, 0);
    assert.equal(ledgerAfterFailures.failedOrBlockedRunsCount, 3);
    assert.equal(ledgerAfterFailures.totalRunsCount, 3);

    // 4. Record an agentic stage run with interactionId
    await recordAgenticStageTelemetry(
      {
        stage: "repair_agent",
        connectorId: "tdlr-tabs",
        status: "agentic_completed",
        tokensUsed: 200,
        interactionId: "inter_repair_01J9XYZ",
        startedAt: new Date("2026-10-26T15:15:00.000Z"),
        endedAt: new Date("2026-10-26T15:15:01.250Z"),
      },
      { repository, spanSink }
    );

    const agenticSpan = emittedSpans.at(-1);
    assert.ok(agenticSpan);
    assert.equal(agenticSpan.execution_mode, "agentic");
    assert.equal(agenticSpan.interactionId, "inter_repair_01J9XYZ");
    assert.equal(agenticSpan.tokensUsed, 200);
    assert.equal(agenticSpan.naiveTokensAvoided, 0);
    assert.equal(agenticSpan.durationMs, 1250);

    const ledgerAfterAgentic = await repository.getEfficiencyLedger();
    assert.equal(ledgerAfterAgentic.agenticRunsCount, 1);
    assert.equal(ledgerAfterAgentic.actualTokensUsed, 200);
    assert.equal(ledgerAfterAgentic.deterministicRunsCount, 0);
    assert.equal(ledgerAfterAgentic.deterministicExecutionPercentage, 0);
  });

  test("GET /api/telemetry/efficiency Happy & Sad Paths: returns validated EfficiencyLedger scorecard, filters/bounds recentRuns, and returns structured 400/500 JSON errors on invalid query params or corrupted telemetry documents without crashing", async () => {
    routeMap.set("/robots.txt", {
      status: 200,
      headers: { "content-type": "text/plain" },
      body: "User-agent: *\nAllow: /\n",
    });
    routeMap.set("/TABS/Search/Project/TABS2027003697", {
      status: 200,
      body: FROZEN_TABS_2027003697_HTML,
    });

    const repository = createInMemoryGridlockRepository();
    const rawByteLength = Buffer.byteLength(FROZEN_TABS_2027003697_HTML, "utf-8");
    const expectedTokensPerRun = Math.ceil(rawByteLength / 4);

    // Seed 2 deterministic runs + 1 agentic run
    await ingestTdlrFiling(
      {
        projectNumber: "TABS2027003697",
        baseUrl,
        now: new Date("2026-10-26T16:00:00.000Z"),
      },
      { repository }
    );
    await ingestTdlrFiling(
      {
        projectNumber: "TABS2027003697",
        baseUrl,
        now: new Date("2026-10-26T16:05:00.000Z"),
      },
      { repository }
    );
    await recordAgenticStageTelemetry(
      {
        stage: "repair_agent",
        connectorId: "tdlr-tabs",
        status: "agentic_completed",
        tokensUsed: 100,
        interactionId: "inter_repair_99",
        startedAt: new Date("2026-10-26T16:10:00.000Z"),
        endedAt: new Date("2026-10-26T16:10:00.800Z"),
      },
      { repository }
    );

    let simulateCorruptedLedger = false;
    const proxiedRepository = {
      ...repository,
      async getEfficiencyLedger(options?: {
        limit?: number;
        executionMode?: "deterministic" | "agentic";
      }) {
        if (simulateCorruptedLedger) {
          return {
            ledgerId: "telemetry_summary",
            deterministicRunsCount: -999,
            naiveTokensAvoided: "corrupted-not-a-number",
          } as unknown as Awaited<
            ReturnType<typeof repository.getEfficiencyLedger>
          >;
        }
        return repository.getEfficiencyLedger(options);
      },
    };

    const apiServer = createGridlockHttpServer({
      repository: proxiedRepository,
    });
    await new Promise<void>((resolve) =>
      apiServer.listen(0, "127.0.0.1", resolve)
    );
    const apiPort = (apiServer.address() as AddressInfo).port;
    const apiBaseUrl = `http://127.0.0.1:${apiPort}`;

    try {
      // 1. Happy Path: GET /api/telemetry/efficiency
      const res = await fetch(`${apiBaseUrl}/api/telemetry/efficiency`);
      assert.equal(res.status, 200);
      const body = await res.json();
      const ledger = EfficiencyLedgerSchema.parse(body);
      assert.equal(ledger.deterministicRunsCount, 2);
      assert.equal(ledger.agenticRunsCount, 1);
      assert.equal(ledger.totalRunsCount, 3);
      assert.equal(ledger.naiveTokensAvoided, expectedTokensPerRun * 2);
      assert.equal(ledger.actualTokensUsed, 100);
      assert.equal(ledger.deterministicExecutionPercentage, 66.67);
      assert.ok(ledger.tokenReductionPercentage > 80);
      assert.equal(ledger.recentRuns.length, 3);

      // 2. Happy Path: query params ?limit=1&execution_mode=deterministic
      const filteredRes = await fetch(
        `${apiBaseUrl}/api/telemetry/efficiency?limit=1&execution_mode=deterministic`
      );
      assert.equal(filteredRes.status, 200);
      const filteredLedger = EfficiencyLedgerSchema.parse(
        await filteredRes.json()
      );
      assert.equal(filteredLedger.recentRuns.length, 1);
      assert.equal(filteredLedger.recentRuns[0]?.execution_mode, "deterministic");

      // 3. Sad Path: invalid query parameter (?limit=0, ?limit=abc, ?execution_mode=invalid, unknown param)
      for (const badQuery of [
        "?limit=0",
        "?limit=abc",
        "?limit=999",
        "?execution_mode=magic",
        "?unexpected=1",
      ]) {
        const badRes = await fetch(
          `${apiBaseUrl}/api/telemetry/efficiency${badQuery}`
        );
        assert.equal(badRes.status, 400, `Expected 400 for ${badQuery}`);
        const errBody = (await badRes.json()) as {
          error: string;
          message: string;
        };
        assert.equal(errBody.error, "invalid_query_parameters");
        assert.ok(errBody.message.length > 0);
      }

      // 4. Sad Path: corrupted telemetry document returns 500 JSON error without crashing server
      simulateCorruptedLedger = true;
      const corruptRes = await fetch(`${apiBaseUrl}/api/telemetry/efficiency`);
      assert.equal(corruptRes.status, 500);
      const corruptErr = (await corruptRes.json()) as {
        error: string;
        message: string;
      };
      assert.equal(corruptErr.error, "telemetry_ledger_error");

      // 5. Server stays alive and serves valid response once corruption is cleared
      simulateCorruptedLedger = false;
      const recoveredRes = await fetch(`${apiBaseUrl}/api/telemetry/efficiency`);
      assert.equal(recoveredRes.status, 200);
      EfficiencyLedgerSchema.parse(await recoveredRes.json());
    } finally {
      await new Promise<void>((resolve, reject) =>
        apiServer.close((err) => (err ? reject(err) : resolve()))
      );
    }
  });

  test("Discovery sweep telemetry: blocked_by_waf during POST /TABS/Search/SearchProjects records failure telemetry with 0 tokens avoided; successful sweep accumulates exact counterfactual math across discovered filings", async () => {
    const repository = createInMemoryGridlockRepository();
    const emittedSpans: TelemetrySpan[] = [];
    const spanSink = (span: TelemetrySpan) => {
      emittedSpans.push(span);
    };

    routeMap.set("/robots.txt", {
      status: 200,
      headers: { "content-type": "text/plain" },
      body: "User-agent: *\nAllow: /\n",
    });
    routeMap.set("/TABS/Search/SearchProjects", {
      status: 429,
      headers: { "retry-after": "30" },
      body: "Too Many Requests",
    });

    const blockedSweep = await runTdlrDiscoverySweep(
      {
        mode: "daily",
        baseUrl,
        now: new Date("2026-10-26T17:00:00.000Z"),
        searchFilters: [{ field: "OwnerName", value: "Compass" }],
      },
      {
        repository,
        spanSink,
        sleep: async () => {},
        jitterMs: () => 0,
      }
    );
    assert.equal(blockedSweep.status, "blocked_by_waf");

    const ledgerAfterBlockedSweep = await repository.getEfficiencyLedger();
    assert.equal(ledgerAfterBlockedSweep.deterministicRunsCount, 0);
    assert.equal(ledgerAfterBlockedSweep.naiveTokensAvoided, 0);
    assert.equal(ledgerAfterBlockedSweep.failedOrBlockedRunsCount, 1);
    assert.equal(emittedSpans.at(-1)?.status, "blocked_by_waf");

    // Now allow discovery and ingest 1 filing
    routeMap.set("/TABS/Search/SearchProjects", {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: [
          {
            ProjectCreatedOn: "2026-10-20T00:00:00Z",
            ProjectNumber: "TABS2027003697",
            ProjectName: "Compass Datacenters - DFWIII-III - Building 10",
            FacilityName: "DFWIII III - Building 10",
            OwnerName: "COMPASS DATACENTERS DFW III-I LLC",
          },
        ],
      }),
    });
    routeMap.set("/TABS/Search/Project/TABS2027003697", {
      status: 200,
      body: FROZEN_TABS_2027003697_HTML,
    });

    const okSweep = await runTdlrDiscoverySweep(
      {
        mode: "daily",
        baseUrl,
        now: new Date("2026-10-26T17:05:00.000Z"),
        searchFilters: [{ field: "OwnerName", value: "Compass" }],
      },
      {
        repository,
        spanSink,
        sleep: async () => {},
        jitterMs: () => 0,
      }
    );
    assert.equal(okSweep.status, "completed");

    const rawByteLength = Buffer.byteLength(FROZEN_TABS_2027003697_HTML, "utf-8");
    const ledgerAfterOkSweep = await repository.getEfficiencyLedger();
    assert.equal(ledgerAfterOkSweep.deterministicRunsCount, 1);
    assert.equal(ledgerAfterOkSweep.failedOrBlockedRunsCount, 1);
    assert.equal(ledgerAfterOkSweep.totalRunsCount, 2);
    assert.equal(
      ledgerAfterOkSweep.naiveTokensAvoided,
      Math.ceil(rawByteLength / 4)
    );
    assert.equal(emittedSpans.at(-1)?.stage, "tdlr_discovery_sweep");
    assert.equal(emittedSpans.at(-1)?.status, "ingested");
    assert.equal(
      emittedSpans.at(-1)?.naiveTokensAvoided,
      Math.ceil(rawByteLength / 4)
    );

    // Aborted discovery sweep records aborted telemetry run without inflating counters
    await assert.rejects(
      () =>
        runTdlrDiscoverySweep(
          {
            mode: "daily",
            baseUrl,
            now: new Date("2026-10-26T17:10:00.000Z"),
            searchFilters: [{ field: "OwnerName", value: "Compass" }],
          },
          {
            repository,
            spanSink,
            searchLoader: async () => {
              throw new Error("Simulated search socket hang up");
            },
            sleep: async () => {},
            jitterMs: () => 0,
          }
        ),
      /Simulated search socket hang up/
    );

    const ledgerAfterAbortedSweep = await repository.getEfficiencyLedger();
    assert.equal(ledgerAfterAbortedSweep.deterministicRunsCount, 1);
    assert.equal(ledgerAfterAbortedSweep.failedOrBlockedRunsCount, 2);
    assert.equal(emittedSpans.at(-1)?.stage, "tdlr_discovery_sweep");
    assert.equal(emittedSpans.at(-1)?.status, "aborted");
  });
});
