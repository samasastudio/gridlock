import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  CandidateSelectorPatchSchema,
  createGridlockHttpServer,
  createInMemoryGridlockRepository,
  ingestTdlrFiling,
  RepairChangelogResponseSchema,
  runOutOfBandRepairAgent,
  type CandidateSelectorPatch,
  type GridlockRepository,
} from "../src/index.ts";
import { HISTORICAL_FIXTURE_V1_HTML, MUTATED_PORTAL_V2_HTML } from "./helpers/fixtures.ts";
import {
  startMockPortalServer,
  type MockPortalRoute,
  type MockPortalServerHarness,
} from "./helpers/mock-portal-server.ts";

async function withApiServer(
  repository: GridlockRepository,
  run: (apiBaseUrl: string) => Promise<void>
): Promise<void> {
  const apiServer = createGridlockHttpServer({ repository });
  await new Promise<void>((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
  const { port } = apiServer.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      apiServer.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

async function triggerAndPromoteHeal(options: {
  repository: GridlockRepository;
  portalBaseUrl: string;
  interactionId: string;
  tokensUsed: number;
  detectedIso: string;
  promotedIso: string;
  historicalFixtures: string[];
  patch: CandidateSelectorPatch;
}): Promise<void> {
  const anomaly = await ingestTdlrFiling(
    { projectNumber: "TABS2027009888", baseUrl: options.portalBaseUrl, now: new Date(options.detectedIso) },
    { repository: options.repository }
  );
  assert.equal(anomaly.status, "selector_anomaly");

  const repairResult = await runOutOfBandRepairAgent(
    {
      connectorId: "tdlr-tabs",
      quarantinedArtifact: anomaly.sourceArtifact,
      brokenInvariants: anomaly.invariantErrors,
      historicalFixtures: options.historicalFixtures,
      anomalyDetectedAt: new Date(options.detectedIso),
      now: new Date(options.promotedIso),
    },
    {
      repository: options.repository,
      geminiClient: {
        interactions: {
          async create() {
            return {
              id: options.interactionId,
              status: "completed",
              output_text: JSON.stringify(CandidateSelectorPatchSchema.parse(options.patch)),
              usage: { total_tokens: options.tokensUsed },
            };
          },
        },
      },
    }
  );
  assert.equal(repairResult.status, "repair_promoted");
}

describe("GET /api/repairs/changelog HTTP Seam (Seam 2 API, Ticket #6)", () => {
  let portalHarness: MockPortalServerHarness;
  let portalBaseUrl: string;
  let routeMap: Map<string, MockPortalRoute>;

  beforeEach(async () => {
    portalHarness = await startMockPortalServer({ defaultRobotsAllowAll: true });
    portalBaseUrl = portalHarness.baseUrl;
    routeMap = portalHarness.routeMap;
  });

  afterEach(async () => {
    await portalHarness.close();
  });

  test("Happy Path (JSON): returns empty RepairChangelogResponse on zero anomalies and returns validated heal entries with live subsequentDeterministicRunsServed amortization", async () => {
    const repository = createInMemoryGridlockRepository();
    await withApiServer(repository, async (apiBaseUrl) => {
      const emptyRes = await fetch(`${apiBaseUrl}/api/repairs/changelog`);
      assert.equal(emptyRes.status, 200);
      assert.match(emptyRes.headers.get("content-type") ?? "", /application\/json/);
      const emptyPayload = RepairChangelogResponseSchema.parse(await emptyRes.json());
      assert.deepEqual(emptyPayload, {
        connectorId: "tdlr-tabs",
        connectorStatus: "healthy",
        activeVersion: 1,
        entries: [],
      });

      routeMap.set("/TABS/Search/Project/TABS2027009888", { status: 200, body: MUTATED_PORTAL_V2_HTML });
      await triggerAndPromoteHeal({
        repository,
        portalBaseUrl,
        interactionId: "inter_changelog_api_v2",
        tokensUsed: 380,
        detectedIso: "2026-10-27T14:00:00.000Z",
        promotedIso: "2026-10-27T14:00:01.850Z",
        historicalFixtures: [HISTORICAL_FIXTURE_V1_HTML],
        patch: {
          detailContainerSelector: ".project-details, .tabs-project-details-v2",
          fieldLabels: { estimatedCost: "Estimated Cost: | Total Estimated Cost:" },
          rootCauseSummary: "TDLR updated detail wrapper to .tabs-project-details-v2 and label to Total Estimated Cost:.",
        },
      });

      const healedSweep = await ingestTdlrFiling(
        { projectNumber: "TABS2027009888", baseUrl: portalBaseUrl, now: new Date("2026-10-27T14:05:00.000Z") },
        { repository }
      );
      assert.equal(healedSweep.status, "ingested");

      const healedRes = await fetch(`${apiBaseUrl}/api/repairs/changelog?connector_id=tdlr-tabs`);
      assert.equal(healedRes.status, 200);
      const healedPayload = RepairChangelogResponseSchema.parse(await healedRes.json());
      assert.equal(healedPayload.activeVersion, 2);
      assert.equal(healedPayload.connectorStatus, "healthy");
      assert.equal(healedPayload.entries.length, 1);

      const entry = healedPayload.entries[0]!;
      assert.equal(entry.previousVersion, 1);
      assert.equal(entry.promotedVersion, 2);
      assert.equal(entry.mttrMs, 1850);
      assert.equal(entry.repairTokensUsed, 380);
      assert.equal(entry.totalFixturesVerified, 2);
      assert.equal(entry.subsequentDeterministicRunsServed, 1);
      assert.equal(entry.selectorDiffs.length, 2);
      assert.equal(
        RepairChangelogResponseSchema.safeParse({
          ...healedPayload,
          activeVersion: 1,
          entries: [{ ...entry, promotedVersion: 5 }],
        }).success,
        false
      );
    });
  });

  test("Happy Path (?format=md): exports Field Notes Markdown for zero-anomaly uptime, mixed-precision timestamp sort, escaped diff tables, and ?limit=1 bounding", async () => {
    const repository = createInMemoryGridlockRepository();
    const sortedPrecisionRepo: GridlockRepository = {
      ...repository,
      async listRepairChangelog(connectorId?: string) {
        const entries = await repository.listRepairChangelog(connectorId);
        return entries
          .map((e) => (e.promotedVersion === 2 ? { ...e, patchPromotedAt: "2026-10-27T15:00:02Z" } : e))
          .reverse();
      },
    };
    await withApiServer(sortedPrecisionRepo, async (apiBaseUrl) => {
      const emptyMdRes = await fetch(`${apiBaseUrl}/api/repairs/changelog?format=md`);
      assert.equal(emptyMdRes.status, 200);
      assert.equal(emptyMdRes.headers.get("content-type"), "text/markdown; charset=utf-8");
      assert.equal(emptyMdRes.headers.get("access-control-allow-origin"), "*");
      const emptyMd = await emptyMdRes.text();
      assert.match(emptyMd, /# Gridlock Repair Changelog — tdlr-tabs/);
      assert.match(emptyMd, /100% deterministic uptime/);

      routeMap.set("/TABS/Search/Project/TABS2027009888", { status: 200, body: MUTATED_PORTAL_V2_HTML });
      await triggerAndPromoteHeal({
        repository,
        portalBaseUrl,
        interactionId: "inter_md_v2",
        tokensUsed: 410,
        detectedIso: "2026-10-27T15:00:00.000Z",
        promotedIso: "2026-10-27T15:00:02.000Z",
        historicalFixtures: [HISTORICAL_FIXTURE_V1_HTML],
        patch: {
          detailContainerSelector: '.project-details, .tabs-project-details-v2, div.col\\:span-2[data-tag="`v2`"]',
          fieldLabels: { estimatedCost: "Estimated Cost: | Total Estimated Cost:" },
          rootCauseSummary:
            "Portal replaced <dl> wrapper with .tabs_project_v2\n# InjectedHeading and [note](https://example.com).",
        },
      });
      await ingestTdlrFiling({ projectNumber: "TABS2027009888", baseUrl: portalBaseUrl, now: new Date("2026-10-27T15:05:00.000Z") }, { repository });
      await ingestTdlrFiling({ projectNumber: "TABS2027009888", baseUrl: portalBaseUrl, now: new Date("2026-10-27T15:10:00.000Z") }, { repository });

      routeMap.set("/TABS/Search/Project/TABS2027009888", {
        status: 200,
        body: MUTATED_PORTAL_V2_HTML.replace("<dt>Facility Name:</dt>", "<dt>Campus Facility Name:</dt>"),
      });
      await triggerAndPromoteHeal({
        repository,
        portalBaseUrl,
        interactionId: "inter_md_v3",
        tokensUsed: 290,
        detectedIso: "2026-10-27T15:00:02.100Z",
        promotedIso: "2026-10-27T15:00:02.500Z",
        historicalFixtures: [HISTORICAL_FIXTURE_V1_HTML, MUTATED_PORTAL_V2_HTML],
        patch: {
          fieldLabels: { facilityName: "Facility Name: | Campus Facility Name:" },
          rootCauseSummary: "Portal renamed Facility Name: label to Campus Facility Name:.",
        },
      });

      const fullJson = RepairChangelogResponseSchema.parse(
        await (await fetch(`${apiBaseUrl}/api/repairs/changelog`)).json()
      );
      assert.deepEqual(fullJson.entries.map((e) => e.promotedVersion), [2, 3]);

      const fullMd = await (await fetch(`${apiBaseUrl}/api/repairs/changelog?format=md`)).text();
      assert.ok(fullMd.indexOf("## v1 -> v2") < fullMd.indexOf("## v2 -> v3"));
      assert.match(fullMd, /2000 ms/);
      assert.match(fullMd, /2 subsequent deterministic runs served/);
      assert.match(fullMd, /2\/2 historical fixtures passed \(3 total verified\)/);
      assert.ok(fullMd.includes("Estimated Cost: \\| Total Estimated Cost:"));
      assert.ok(fullMd.includes('div.col\\:span-2[data-tag="`v2`"]'));
      assert.ok(!fullMd.includes("div.col\\\\:span-2"));
      assert.ok(
        fullMd.includes(
          "- **Root Cause**: Portal replaced \\<dl\\> wrapper with .tabs\\_project\\_v2 # InjectedHeading and \\[note\\](https://example.com)."
        )
      );
      assert.doesNotMatch(fullMd, /^# InjectedHeading/m);

      const boundedJson = RepairChangelogResponseSchema.parse(
        await (await fetch(`${apiBaseUrl}/api/repairs/changelog?limit=1`)).json()
      );
      assert.equal(boundedJson.entries.length, 1);
      assert.equal(boundedJson.entries[0]?.promotedVersion, 3);

      const boundedMd = await (await fetch(`${apiBaseUrl}/api/repairs/changelog?format=md&limit=1`)).text();
      assert.doesNotMatch(boundedMd, /## v1 -> v2/);
      assert.match(boundedMd, /## v2 -> v3/);
      assert.match(boundedMd, /\*\*Verified Autonomous Heals\*\*: 2 \(showing latest 1\)/);
      assert.match(boundedMd, /\*\*Total Subsequent Deterministic Runs Served\*\*: 2/);
    });
  });

  test("Sad Paths: reports degraded selector_anomaly and blocked_by_waf statuses, rejects non-GET (405), invalid/duplicate query params (400), unknown connector_id (404), and corrupted records (500) without crashing", async () => {
    const repository = createInMemoryGridlockRepository();
    let corruptMode: "none" | "entries" | "config" | "mismatch" = "none";
    const proxiedRepository: GridlockRepository = {
      ...repository,
      async getActiveConnectorConfig(connectorId: string) {
        if (corruptMode === "config") return { connectorId, version: -1, status: "bad" } as never;
        if (corruptMode === "mismatch") return repository.getActiveConnectorConfig("tdlr-tabs");
        return repository.getActiveConnectorConfig(connectorId);
      },
      async listRepairChangelog(connectorId?: string) {
        if (corruptMode === "entries") return [{ id: "bad_1", connectorId: "tdlr-tabs", patchPromotedAt: null }] as never;
        if (corruptMode === "mismatch") return [];
        return repository.listRepairChangelog(connectorId);
      },
    };

    await withApiServer(proxiedRepository, async (apiBaseUrl) => {
      routeMap.set("/TABS/Search/Project/TABS2027009888", {
        status: 200,
        body: "<html><body><div class='broken'>Missing dl</div></body></html>",
      });
      const anomaly = await ingestTdlrFiling(
        { projectNumber: "TABS2027009888", baseUrl: portalBaseUrl, now: new Date("2026-10-29T14:00:00.000Z") },
        { repository }
      );
      assert.equal(anomaly.status, "selector_anomaly");

      const anomalyJson = RepairChangelogResponseSchema.parse(
        await (await fetch(`${apiBaseUrl}/api/repairs/changelog`)).json()
      );
      assert.equal(anomalyJson.connectorStatus, "selector_anomaly");
      const anomalyMd = await (await fetch(`${apiBaseUrl}/api/repairs/changelog?format=md`)).text();
      assert.match(anomalyMd, /`selector_anomaly`/);
      assert.doesNotMatch(anomalyMd, /100% deterministic uptime/);

      routeMap.set("/TABS/Search/Project/TABS2027009888", {
        status: 403,
        body: "<html><iframe src='/_Incapsula_Resource?SWJIYLWA=1'></iframe></html>",
      });
      const waf = await ingestTdlrFiling(
        { projectNumber: "TABS2027009888", baseUrl: portalBaseUrl, now: new Date("2026-10-29T14:05:00.000Z") },
        { repository }
      );
      assert.equal(waf.status, "blocked_by_waf");
      const wafJson = RepairChangelogResponseSchema.parse(
        await (await fetch(`${apiBaseUrl}/api/repairs/changelog`)).json()
      );
      assert.equal(wafJson.connectorStatus, "blocked_by_waf");

      const postRes = await fetch(`${apiBaseUrl}/api/repairs/changelog`, { method: "POST" });
      assert.equal(postRes.status, 405);
      assert.equal(((await postRes.json()) as { error: string }).error, "method_not_allowed");

      for (const badQuery of ["?limit=0", "?limit=abc", "?limit=999", "?format=xml", "?connector_id=%20%20", "?unexpected=1", "?format=xml&format=md"]) {
        const badRes = await fetch(`${apiBaseUrl}/api/repairs/changelog${badQuery}`);
        assert.equal(badRes.status, 400, `Expected 400 for ${badQuery}`);
        assert.equal(((await badRes.json()) as { error: string }).error, "invalid_query_parameters");
      }

      const missingRes = await fetch(`${apiBaseUrl}/api/repairs/changelog?connector_id=ercot-missing`);
      assert.equal(missingRes.status, 404);
      assert.equal(((await missingRes.json()) as { error: string }).error, "connector_not_found");

      for (const mode of ["entries", "config", "mismatch"] as const) {
        corruptMode = mode;
        const targetUrl =
          mode === "mismatch"
            ? `${apiBaseUrl}/api/repairs/changelog?connector_id=ercot-mismatch`
            : `${apiBaseUrl}/api/repairs/changelog`;
        const corruptRes = await fetch(targetUrl);
        assert.equal(corruptRes.status, 500, `Expected 500 for corruptMode=${mode}`);
        assert.match(((await corruptRes.json()) as { message: string }).message, /schema validation|connectorId/);
      }
      corruptMode = "none";

      const recoveredRes = await fetch(`${apiBaseUrl}/api/repairs/changelog`);
      assert.equal(recoveredRes.status, 200);
      RepairChangelogResponseSchema.parse(await recoveredRes.json());
    });
  });
});
