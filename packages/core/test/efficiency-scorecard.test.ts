import { Buffer } from "node:buffer";
import type { AddressInfo } from "node:net";
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  calculateNaiveTokensAvoided,
  calculateEstimatedCostSavedUsd,
  createCloudLoggingSpanSink,
  createGridlockHttpServer,
  createInMemoryGridlockRepository,
  EfficiencyScorecardSchema,
  ingestTdlrFiling,
  recordAgenticStageRun,
  runTdlrDiscoverySweep,
  RunRecordSchema,
  RunSpanSchema,
  type RunSpan,
} from "../src/index.ts";
import { FROZEN_TABS_2027003697_HTML } from "./helpers/fixtures.ts";
import {
  startMockPortalServer,
  type MockPortalRoute,
  type MockPortalServerHarness,
} from "./helpers/mock-portal-server.ts";

describe("Efficiency Scorecard & Cloud Trace Spans (Ticket #4)", () => {
  let harness: MockPortalServerHarness;
  let baseUrl: string;
  let routeMap: Map<string, MockPortalRoute>;

  beforeEach(async () => {
    harness = await startMockPortalServer();
    baseUrl = harness.baseUrl;
    routeMap = harness.routeMap;
  });

  afterEach(async () => {
    await harness.close();
  });

  test("Happy Path: fresh deterministic extraction and duplicate SHA-256 short-circuit atomically increment naiveTokensAvoided, deterministicRunsCount, and estimatedCostSavedUsd, write permanent run_records (expiresAt: null), and emit execution_mode: 'deterministic' spans", async () => {
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
    const emittedSpans: RunSpan[] = [];
    const structuredLogs: string[] = [];
    const cloudLogSink = createCloudLoggingSpanSink((line) => {
      structuredLogs.push(line);
    });
    const spanSink = (span: RunSpan) => {
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

    // Verify EfficiencyScorecard summary
    const scorecard = EfficiencyScorecardSchema.parse(
      await repository.getEfficiencyScorecard()
    );
    assert.equal(scorecard.deterministicRunsCount, 2);
    assert.equal(scorecard.agenticRunsCount, 0);
    assert.equal(scorecard.failedOrBlockedRunsCount, 0);
    assert.equal(scorecard.totalRunsCount, 2);
    assert.equal(scorecard.naiveTokensAvoided, expectedTokensPerRun * 2);
    assert.equal(scorecard.actualTokensUsed, 0);
    assert.equal(scorecard.deterministicExecutionRatio, 1);
    assert.equal(scorecard.deterministicExecutionPercentage, 100);
    assert.equal(scorecard.tokenReductionPercentage, 100);
    assert.equal(
      scorecard.estimatedCostSavedUsd,
      Number((expectedCostPerRun * 2).toFixed(8))
    );
    assert.equal(scorecard.expiresAt, null);
    assert.equal(scorecard.recentRuns.length, 2);

    // Verify permanent run_records records (expiresAt: null)
    const runs = await repository.listRunRecords();
    assert.equal(runs.length, 2);
    for (const run of runs) {
      const parsedRun = RunRecordSchema.parse(run);
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
      const parsedSpan = RunSpanSchema.parse(span);
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

  test("Sad Path & Agentic Spans: blocked_by_waf, selector_anomaly, and aborted runs record failure run records without inflating naiveTokensAvoided or deterministicRunsCount; agentic runs emit interactionId spans and update token reduction ratios", async () => {
    const repository = createInMemoryGridlockRepository();
    const emittedSpans: RunSpan[] = [];
    const spanSink = (span: RunSpan) => {
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

    const scorecardAfterFailures = await repository.getEfficiencyScorecard();
    assert.equal(scorecardAfterFailures.deterministicRunsCount, 0);
    assert.equal(scorecardAfterFailures.naiveTokensAvoided, 0);
    assert.equal(scorecardAfterFailures.estimatedCostSavedUsd, 0);
    assert.equal(scorecardAfterFailures.failedOrBlockedRunsCount, 3);
    assert.equal(scorecardAfterFailures.totalRunsCount, 3);

    // 4. Record an agentic stage run with interactionId
    await recordAgenticStageRun(
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

    const scorecardAfterAgentic = await repository.getEfficiencyScorecard();
    assert.equal(scorecardAfterAgentic.agenticRunsCount, 1);
    assert.equal(scorecardAfterAgentic.actualTokensUsed, 200);
    assert.equal(scorecardAfterAgentic.deterministicRunsCount, 0);
    assert.equal(scorecardAfterAgentic.deterministicExecutionPercentage, 0);
  });

  test("GET /api/efficiency/scorecard Happy & Sad Paths: returns validated EfficiencyScorecard, filters/bounds recentRuns, and returns structured 400/500 JSON errors on invalid query params or corrupted scorecard documents without crashing", async () => {
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
    await recordAgenticStageRun(
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

    let simulateCorruptedScorecard = false;
    const proxiedRepository = {
      ...repository,
      async getEfficiencyScorecard(options?: {
        limit?: number;
        executionMode?: "deterministic" | "agentic";
      }) {
        if (simulateCorruptedScorecard) {
          return {
            scorecardId: "efficiency_scorecard",
            deterministicRunsCount: -999,
            naiveTokensAvoided: "corrupted-not-a-number",
          } as unknown as Awaited<
            ReturnType<typeof repository.getEfficiencyScorecard>
          >;
        }
        return repository.getEfficiencyScorecard(options);
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
      // 1. Happy Path: GET /api/efficiency/scorecard
      const res = await fetch(`${apiBaseUrl}/api/efficiency/scorecard`);
      assert.equal(res.status, 200);
      const body = await res.json();
      const scorecard = EfficiencyScorecardSchema.parse(body);
      assert.equal(scorecard.deterministicRunsCount, 2);
      assert.equal(scorecard.agenticRunsCount, 1);
      assert.equal(scorecard.totalRunsCount, 3);
      assert.equal(scorecard.naiveTokensAvoided, expectedTokensPerRun * 2);
      assert.equal(scorecard.actualTokensUsed, 100);
      assert.equal(scorecard.deterministicExecutionPercentage, 66.67);
      assert.ok(scorecard.tokenReductionPercentage > 80);
      assert.equal(scorecard.recentRuns.length, 3);

      // 2. Happy Path: query params ?limit=1&execution_mode=deterministic
      const filteredRes = await fetch(
        `${apiBaseUrl}/api/efficiency/scorecard?limit=1&execution_mode=deterministic`
      );
      assert.equal(filteredRes.status, 200);
      const filteredScorecard = EfficiencyScorecardSchema.parse(
        await filteredRes.json()
      );
      assert.equal(filteredScorecard.recentRuns.length, 1);
      assert.equal(
        filteredScorecard.recentRuns[0]?.execution_mode,
        "deterministic"
      );

      // 3. Sad Path: invalid query parameter (?limit=0, ?limit=abc, ?execution_mode=invalid, unknown param)
      for (const badQuery of [
        "?limit=0",
        "?limit=abc",
        "?limit=999",
        "?limit=5&limit=10",
        "?execution_mode=magic",
        "?unexpected=1",
      ]) {
        const badRes = await fetch(
          `${apiBaseUrl}/api/efficiency/scorecard${badQuery}`
        );
        assert.equal(badRes.status, 400, `Expected 400 for ${badQuery}`);
        const errBody = (await badRes.json()) as {
          error: string;
          message: string;
        };
        assert.equal(errBody.error, "invalid_query_parameters");
        assert.ok(errBody.message.length > 0);
      }

      const postRes = await fetch(`${apiBaseUrl}/api/efficiency/scorecard`, {
        method: "POST",
      });
      assert.equal(postRes.status, 405);
      assert.equal(postRes.headers.get("allow"), "GET");
      assert.equal(((await postRes.json()) as { error: string }).error, "method_not_allowed");

      // 4. Sad Path: corrupted scorecard document returns 500 JSON error without crashing server
      simulateCorruptedScorecard = true;
      const corruptRes = await fetch(`${apiBaseUrl}/api/efficiency/scorecard`);
      assert.equal(corruptRes.status, 500);
      const corruptErr = (await corruptRes.json()) as {
        error: string;
        message: string;
      };
      assert.equal(corruptErr.error, "efficiency_scorecard_error");

      // 5. Server stays alive and serves valid response once corruption is cleared
      simulateCorruptedScorecard = false;
      const recoveredRes = await fetch(`${apiBaseUrl}/api/efficiency/scorecard`);
      assert.equal(recoveredRes.status, 200);
      EfficiencyScorecardSchema.parse(await recoveredRes.json());
    } finally {
      await new Promise<void>((resolve, reject) =>
        apiServer.close((err) => (err ? reject(err) : resolve()))
      );
    }
  });

  test("Discovery sweep scorecard: blocked_by_waf during POST /TABS/Search/SearchProjects records failure run record with 0 tokens avoided; successful sweep accumulates exact counterfactual math across discovered filings", async () => {
    const repository = createInMemoryGridlockRepository();
    const emittedSpans: RunSpan[] = [];
    const spanSink = (span: RunSpan) => {
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

    const scorecardAfterBlockedSweep = await repository.getEfficiencyScorecard();
    assert.equal(scorecardAfterBlockedSweep.deterministicRunsCount, 0);
    assert.equal(scorecardAfterBlockedSweep.naiveTokensAvoided, 0);
    assert.equal(scorecardAfterBlockedSweep.failedOrBlockedRunsCount, 1);
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
    const scorecardAfterOkSweep = await repository.getEfficiencyScorecard();
    assert.equal(scorecardAfterOkSweep.deterministicRunsCount, 1);
    assert.equal(scorecardAfterOkSweep.failedOrBlockedRunsCount, 1);
    assert.equal(scorecardAfterOkSweep.totalRunsCount, 2);
    assert.equal(
      scorecardAfterOkSweep.naiveTokensAvoided,
      Math.ceil(rawByteLength / 4)
    );
    assert.equal(emittedSpans.at(-1)?.stage, "tdlr_discovery_sweep");
    assert.equal(emittedSpans.at(-1)?.status, "ingested");
    assert.equal(
      emittedSpans.at(-1)?.naiveTokensAvoided,
      Math.ceil(rawByteLength / 4)
    );

    // Aborted discovery sweep records aborted run record without inflating counters
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

    const scorecardAfterAbortedSweep = await repository.getEfficiencyScorecard();
    assert.equal(scorecardAfterAbortedSweep.deterministicRunsCount, 1);
    assert.equal(scorecardAfterAbortedSweep.failedOrBlockedRunsCount, 2);
    assert.equal(emittedSpans.at(-1)?.stage, "tdlr_discovery_sweep");
    assert.equal(emittedSpans.at(-1)?.status, "aborted");
  });
});
