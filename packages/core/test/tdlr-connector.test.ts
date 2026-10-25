import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  createInMemoryGridlockRepository,
  ingestTdlrFiling,
  runTdlrDiscoverySweep,
  parseTdlrCliArgs,
  verifySiteAccess,
  GRIDLOCK_USER_AGENT,
  ProjectSchema,
  ObservationSchema,
  SourceArtifactSchema,
  ConnectorConfigSchema,
} from "../src/index.ts";

const FROZEN_TABS_2027003697_HTML = `<!DOCTYPE html>
<html lang="en">
<head><title>TDLR TABS - Project Details</title></head>
<body>
<div class="project-details">
  <div class="project-details-header">
    <h3>Architectural Barriers Project Details Page</h3>
    <p><b>Project #:</b> TABS2027003697 <span class="pull-right"><b>Registration Date:</b> 10/15/2026</span></p>
  </div>
  <div class="project-details-body">
    <div class="project-details-project">
      <h4>PROJECT</h4>
      <dl class="dl-horizontal">
        <dt>Project Name:</dt>
        <dd>Compass Datacenters - DFWIII-III - Building 10 - Interior / Tenant Fit Out</dd>
        <dt>Project Number:</dt>
        <dd>TABS2027003697</dd>
        <dt>Facility Name:</dt>
        <dd>DFWIII III - Building 10</dd>
        <dt>Location Address:</dt>
        <dd>590 Austin Blvd</dd>
        <dd>Red Oak, TX 75154</dd>
        <dt>Location County:</dt>
        <dd>Ellis</dd>
      </dl>
      <dl class="dl-horizontal">
        <dt>Start Date:</dt>
        <dd>12/1/2024</dd>
        <dt>Completion Date:</dt>
        <dd>8/22/2028</dd>
        <dt>Estimated Cost:</dt>
        <dd>$100,000,000</dd>
        <dt>Type of Work:</dt>
        <dd>Renovation/Alteration</dd>
        <dt>Scope of Work:</dt>
        <dd>251,815 sq. ft of Interior / Tenant Fit-Out for construction of a new Data Center on a Data Center Campus.</dd>
        <dt>Square Footage:</dt>
        <dd>251,815 ft <sup>2</sup></dd>
      </dl>
      <dl class="dl-horizontal">
        <dt>Current Status:</dt>
        <dd>Project Registered</dd>
      </dl>
    </div>
    <div class="project-details-owner">
      <h4>OWNER</h4>
      <dl class="dl-horizontal">
        <dt>Owner Name:</dt>
        <dd>COMPASS DATACENTERS DFW III-I LLC</dd>
      </dl>
    </div>
  </div>
</div>
</body>
</html>`;

describe("TDLR TABS Connector Tracer Bullet (Seam 1)", () => {
  let server: Server;
  let baseUrl: string;
  let routeMap: Map<
    string,
    { status?: number; headers?: Record<string, string>; body: string }
  >;
  let recordedRequests: Array<{
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    body: string;
  }>;
  let currentInFlight: number;
  let maxInFlightSeen: number;

  beforeEach(async () => {
    routeMap = new Map();
    recordedRequests = [];
    currentInFlight = 0;
    maxInFlightSeen = 0;
    server = createServer((req, res) => {
      currentInFlight += 1;
      if (currentInFlight > maxInFlightSeen) {
        maxInFlightSeen = currentInFlight;
      }
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const rawBody = Buffer.concat(chunks).toString("utf-8");
        recordedRequests.push({
          method: req.method ?? "GET",
          url: req.url ?? "",
          headers: req.headers,
          body: rawBody,
        });
        const route = routeMap.get(req.url ?? "");
        if (!route) {
          currentInFlight -= 1;
          res.writeHead(404, { "content-type": "text/plain" });
          res.end("Not Found");
          return;
        }
        res.writeHead(route.status ?? 200, {
          "content-type": "text/html; charset=utf-8",
          ...route.headers,
        });
        res.end(route.body, () => {
          currentInFlight -= 1;
        });
      });
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

  test("extracts valid Project and append-only Observation from frozen TDLR HTML and stores a gzipped SHA-256 SourceArtifact", async () => {
    routeMap.set("/TABS/Search/Project/TABS2027003697", {
      body: FROZEN_TABS_2027003697_HTML,
    });

    const repository = createInMemoryGridlockRepository();
    const now = new Date("2026-10-25T14:00:00.000Z");

    const result = await ingestTdlrFiling(
      {
        projectNumber: "TABS2027003697",
        baseUrl,
        now,
      },
      { repository }
    );

    assert.equal(result.status, "ingested");

    const expectedSha256 = createHash("sha256")
      .update(Buffer.from(FROZEN_TABS_2027003697_HTML, "utf-8"))
      .digest("hex");

    // Validate runtime Zod schemas on returned records
    const parsedArtifact = SourceArtifactSchema.parse(result.sourceArtifact);
    const parsedProject = ProjectSchema.parse(result.project);
    const parsedObservation = ObservationSchema.parse(result.observation);
    const activeConfig = await repository.getActiveConnectorConfig("tdlr-tabs");
    ConnectorConfigSchema.parse(activeConfig);

    assert.equal(parsedArtifact.sha256, expectedSha256);
    assert.equal(parsedArtifact.storageUri, `gs://gridlock-artifacts/artifacts/${expectedSha256}.gz`);
    assert.equal(parsedArtifact.expiresAt, null);
    assert.equal(parsedArtifact.rawByteLength, Buffer.byteLength(FROZEN_TABS_2027003697_HTML, "utf-8"));

    // Verify stored gzipped Source Artifact decompresses back to exact frozen HTML
    const storedGzipBuffer = await repository.readArtifactGzip(parsedArtifact.sha256);
    assert.ok(storedGzipBuffer, "Expected gzipped Source Artifact buffer in storage");
    assert.equal(gunzipSync(storedGzipBuffer).toString("utf-8"), FROZEN_TABS_2027003697_HTML);

    assert.equal(parsedProject.projectNumber, "TABS2027003697");
    assert.equal(
      parsedProject.projectName,
      "Compass Datacenters - DFWIII-III - Building 10 - Interior / Tenant Fit Out"
    );
    assert.equal(parsedProject.facilityName, "DFWIII III - Building 10");
    assert.equal(parsedProject.ownerName, "COMPASS DATACENTERS DFW III-I LLC");
    assert.equal(parsedProject.locationAddress, "590 Austin Blvd, Red Oak, TX 75154");
    assert.equal(parsedProject.county, "Ellis");
    assert.equal(parsedProject.estimatedCostUsd, 100_000_000);
    assert.equal(parsedProject.squareFootage, 251_815);
    assert.equal(parsedProject.typeOfWork, "Renovation/Alteration");
    assert.equal(
      parsedProject.scopeOfWork,
      "251,815 sq. ft of Interior / Tenant Fit-Out for construction of a new Data Center on a Data Center Campus."
    );
    assert.equal(parsedProject.currentStatus, "Project Registered");
    assert.equal(parsedProject.startDate, "2024-12-01");
    assert.equal(parsedProject.completionDate, "2028-08-22");
    assert.equal(parsedProject.latestSourceArtifactHash, expectedSha256);

    assert.equal(parsedObservation.projectNumber, "TABS2027003697");
    assert.equal(parsedObservation.sourceArtifactHash, expectedSha256);
    assert.equal(parsedObservation.observedAt, "2026-10-25T14:00:00.000Z");
    assert.equal(parsedObservation.status, "Project Registered");
    assert.equal(parsedObservation.estimatedCostUsd, 100_000_000);
    assert.equal(parsedObservation.squareFootage, 251_815);
    assert.equal(parsedObservation.isMilestone, true);
  });

  test("short-circuits with unchanged_artifact and zero duplicate writes on an identical SHA-256 Source Artifact, and sets +90d TTL on non-milestone artifacts", async () => {
    routeMap.set("/TABS/Search/Project/TABS2027003697", {
      body: FROZEN_TABS_2027003697_HTML,
    });

    const repository = createInMemoryGridlockRepository();
    const firstRunTime = new Date("2026-10-25T14:00:00.000Z");
    const secondRunTime = new Date("2026-10-26T14:00:00.000Z");

    const firstResult = await ingestTdlrFiling(
      { projectNumber: "TABS2027003697", baseUrl, now: firstRunTime },
      { repository }
    );
    assert.equal(firstResult.status, "ingested");

    const secondResult = await ingestTdlrFiling(
      { projectNumber: "TABS2027003697", baseUrl, now: secondRunTime },
      { repository }
    );
    assert.equal(secondResult.status, "unchanged_artifact");
    assert.equal(secondResult.sourceArtifact.sha256, firstResult.sourceArtifact.sha256);

    const observations = await repository.listObservationsByProject("TABS2027003697");
    const projects = await repository.listProjects();
    assert.equal(observations.length, 1);
    assert.equal(projects.length, 1);

    // Non-milestone minor filing (< $25M cost threshold) receives +90d expiresAt TTL
    const minorFilingHtml = FROZEN_TABS_2027003697_HTML
      .replaceAll("TABS2027003697", "TABS2027004100")
      .replace("$100,000,000", "$2,000,000");
    routeMap.set("/TABS/Search/Project/TABS2027004100", {
      body: minorFilingHtml,
    });

    const minorResult = await ingestTdlrFiling(
      { projectNumber: "TABS2027004100", baseUrl, now: firstRunTime },
      { repository }
    );
    assert.equal(minorResult.status, "ingested");
    assert.equal(minorResult.observation.isMilestone, false);
    assert.equal(minorResult.sourceArtifact.expiresAt, "2027-01-23T14:00:00.000Z");
  });

  test("quarantines artifact with selector_anomaly and zero entity writes when required <dt>/<dd> fields are missing or malformed", async () => {
    const malformedCostHtml = FROZEN_TABS_2027003697_HTML.replace(
      "<dd>$100,000,000</dd>",
      "<dd>TBD upon engineering review</dd>"
    );
    const missingProjectNumberHtml = FROZEN_TABS_2027003697_HTML.replace(
      "<dt>Project Number:</dt>\n        <dd>TABS2027003697</dd>",
      ""
    );

    routeMap.set("/TABS/Search/Project/TABS2027003697", {
      body: malformedCostHtml,
    });
    routeMap.set("/TABS/Search/Project/TABS2027003698", {
      body: missingProjectNumberHtml,
    });

    const repository = createInMemoryGridlockRepository();
    const now = new Date("2026-10-25T14:00:00.000Z");

    const costAnomaly = await ingestTdlrFiling(
      { projectNumber: "TABS2027003697", baseUrl, now },
      { repository }
    );
    assert.equal(costAnomaly.status, "selector_anomaly");
    assert.ok(costAnomaly.invariantErrors.some((err) => err.includes("estimatedCostUsd")));
    assert.equal(costAnomaly.sourceArtifact.expiresAt, "2027-01-23T14:00:00.000Z");
    assert.ok(costAnomaly.sourceArtifact.storageUri.includes("/quarantine/"));

    // Re-running on a quarantined Source Artifact does not falsely short-circuit as unchanged_artifact
    const repeatAnomaly = await ingestTdlrFiling(
      { projectNumber: "TABS2027003697", baseUrl, now },
      { repository }
    );
    assert.equal(repeatAnomaly.status, "selector_anomaly");

    const missingNumberAnomaly = await ingestTdlrFiling(
      { projectNumber: "TABS2027003698", baseUrl, now },
      { repository }
    );
    assert.equal(missingNumberAnomaly.status, "selector_anomaly");
    assert.ok(
      missingNumberAnomaly.invariantErrors.some((err) => err.includes("projectNumber"))
    );

    const activeConfig = await repository.getActiveConnectorConfig("tdlr-tabs");
    assert.equal(activeConfig.status, "selector_anomaly");
    assert.equal((await repository.listProjects()).length, 0);
    assert.equal((await repository.listObservationsByProject("TABS2027003697")).length, 0);
  });

  test("aborts cleanly with selector_anomaly and zero partial writes on empty or corrupted HTML documents", async () => {
    routeMap.set("/TABS/Search/Project/TABS2027009991", {
      body: "   ",
    });
    routeMap.set("/TABS/Search/Project/TABS2027009992", {
      body: "<html><body><div class=\"unexpected-wrapper\">Truncated markup",
    });

    const repository = createInMemoryGridlockRepository();
    const now = new Date("2026-10-25T14:00:00.000Z");

    const emptyResult = await ingestTdlrFiling(
      { projectNumber: "TABS2027009991", baseUrl, now },
      { repository }
    );
    assert.equal(emptyResult.status, "selector_anomaly");
    assert.ok(
      emptyResult.invariantErrors.some((err) => err.includes("Empty HTML document"))
    );

    const corruptedResult = await ingestTdlrFiling(
      { projectNumber: "TABS2027009992", baseUrl, now },
      { repository }
    );
    assert.equal(corruptedResult.status, "selector_anomaly");
    assert.ok(
      corruptedResult.invariantErrors.some((err) =>
        err.includes("detailContainerSelector")
      )
    );

    assert.equal((await repository.listProjects()).length, 0);
    assert.equal((await repository.listObservationsByProject("TABS2027009991")).length, 0);
    assert.equal((await repository.listObservationsByProject("TABS2027009992")).length, 0);
  });

  test("verifySiteAccess and ingestTdlrFiling immediately halt with blocked_by_waf and 0 Gemini tokens on HTTP 403/429/503, Retry-After, robots.txt disallow, Imperva, or Cloudflare Turnstile", async () => {
    const repository = createInMemoryGridlockRepository();
    const now = new Date("2026-10-25T14:00:00.000Z");

    // 1. HTTP 429 with Retry-After header
    routeMap.set("/TABS/Search/Project/TABS2027005001", {
      status: 429,
      headers: { "Retry-After": "120" },
      body: "Too Many Requests",
    });

    const rateLimited = await ingestTdlrFiling(
      { projectNumber: "TABS2027005001", baseUrl, now },
      { repository }
    );
    assert.equal(rateLimited.status, "blocked_by_waf");
    assert.equal(rateLimited.tokensUsed, 0);
    assert.equal(rateLimited.retryAfterSeconds, 120);
    assert.equal(
      (await repository.getActiveConnectorConfig("tdlr-tabs")).status,
      "blocked_by_waf"
    );

    // 2. HTTP 200 OK serving an Imperva Incapsula challenge page (/_Incapsula_Resource)
    await repository.setConnectorStatus("tdlr-tabs", "healthy", now.toISOString());
    routeMap.set("/TABS/Search/Project/TABS2027005002", {
      status: 200,
      body: `<html><body><iframe id="main-iframe" src="/_Incapsula_Resource?SWJIYLWA=719d34d31c8e3a6e6fffd425f7e032f3"></iframe></body></html>`,
    });

    const impervaBlocked = await ingestTdlrFiling(
      { projectNumber: "TABS2027005002", baseUrl, now },
      { repository }
    );
    assert.equal(impervaBlocked.status, "blocked_by_waf");
    assert.equal(impervaBlocked.tokensUsed, 0);
    assert.match(impervaBlocked.reason, /_Incapsula_Resource|Imperva/i);
    assert.equal(
      (await repository.getActiveConnectorConfig("tdlr-tabs")).status,
      "blocked_by_waf"
    );

    // 3. Cloudflare Turnstile / challenge-platform & HTTP 403 / 503
    const turnstileCheck = verifySiteAccess({
      status: 200,
      body: `<html><body><div class="cf-turnstile" data-sitekey="1x00000000000000000000AA"></div><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></body></html>`,
    });
    assert.equal(turnstileCheck.allowed, false);
    assert.equal(turnstileCheck.status, "blocked_by_waf");
    assert.equal(turnstileCheck.tokensUsed, 0);

    const status503Check = verifySiteAccess({
      status: 503,
      headers: { "retry-after": "60" },
      body: "Service Unavailable",
    });
    assert.equal(status503Check.allowed, false);
    assert.equal(status503Check.status, "blocked_by_waf");
    assert.equal(status503Check.retryAfterSeconds, 60);

    // 4. robots.txt Disallow for GridlockCivicResearchBot or *
    routeMap.set("/robots.txt", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: `User-agent: GridlockCivicResearchBot\nDisallow: /TABS/\n`,
    });
    routeMap.set("/TABS/Search/Project/TABS2027003697", {
      status: 200,
      body: FROZEN_TABS_2027003697_HTML,
    });

    const robotsBlocked = await ingestTdlrFiling(
      { projectNumber: "TABS2027003697", baseUrl, now },
      { repository }
    );
    assert.equal(robotsBlocked.status, "blocked_by_waf");
    assert.equal(robotsBlocked.tokensUsed, 0);
    assert.match(robotsBlocked.reason, /robots\.txt/i);
    assert.equal((await repository.listProjects()).length, 0);
  });

  test("deterministically redacts personal phone numbers, personal emails, and residential addresses while retaining corporate OwnerName, FacilityName, DesignFirmName, and city/county metadata", async () => {
    const filingWithPiiHtml = FROZEN_TABS_2027003697_HTML.replace(
      "<dd>590 Austin Blvd</dd>\n        <dd>Red Oak, TX 75154</dd>",
      "<dd>1402 Whispering Oaks Ln, Apt 4B</dd>\n        <dd>Red Oak, TX 75154</dd>"
    )
      .replace(
        "<dd>251,815 sq. ft of Interior / Tenant Fit-Out for construction of a new Data Center on a Data Center Campus.</dd>",
        "<dd>251,815 sq. ft Data Center fit-out. Contact: +1 (512) 555-0199 ext 42, jane.doe@outlook.com, Residential Address: 742 Evergreen Terrace, Apt 2A, Austin, TX 78704.</dd>"
      )
      .replace(
        "<dd>COMPASS DATACENTERS DFW III-I LLC</dd>",
        "<dd>COMPASS DATACENTERS DFW III-I LLC (Contact: 512-555-0199 / j.smith@gmail.com)</dd>\n        <dt>Design Firm Name:</dt>\n        <dd>Corgan Associates, Inc. (Phone: (214) 555-0144, arch@personal-mail.org)</dd>"
      );

    routeMap.set("/TABS/Search/Project/TABS2027003697", {
      status: 200,
      body: filingWithPiiHtml,
    });

    const repository = createInMemoryGridlockRepository();
    const now = new Date("2026-10-25T14:00:00.000Z");

    const result = await ingestTdlrFiling(
      { projectNumber: "TABS2027003697", baseUrl, now },
      { repository }
    );

    assert.equal(result.status, "ingested");
    const savedProject = await repository.getProjectByNumber("TABS2027003697");
    assert.ok(savedProject);

    // Corporate entities and county/city retained
    assert.ok(savedProject.ownerName.includes("COMPASS DATACENTERS DFW III-I LLC"));
    assert.equal(savedProject.facilityName, "DFWIII III - Building 10");
    assert.ok(savedProject.designFirmName?.includes("Corgan Associates, Inc."));
    assert.equal(savedProject.county, "Ellis");
    assert.equal(savedProject.locationAddress, "[REDACTED_ADDRESS], Red Oak, TX 75154");

    // Personal phones, emails, and residential street addresses stripped
    const serialized = JSON.stringify({
      project: savedProject,
      observation: result.observation,
    });
    assert.ok(!serialized.includes("512-555-0199"));
    assert.ok(!serialized.includes("555-0144"));
    assert.ok(!serialized.includes("jane.doe@outlook.com"));
    assert.ok(!serialized.includes("j.smith@gmail.com"));
    assert.ok(!serialized.includes("arch@personal-mail.org"));
    assert.ok(!serialized.includes("1402 Whispering Oaks Ln"));
    assert.ok(!serialized.includes("742 Evergreen Terrace"));
    assert.ok(savedProject.scopeOfWork.includes("[REDACTED_PHONE]"));
    assert.ok(savedProject.scopeOfWork.includes("[REDACTED_EMAIL]"));
    assert.ok(savedProject.scopeOfWork.includes("[REDACTED_ADDRESS]"));
  });

  test("discovers and ingests filings chronologically via POST /TABS/Search/SearchProjects in --backfill and daily modes with GridlockCivicResearchBot/1.0 User-Agent and single-flight >= 1,500ms pacing", async () => {
    assert.deepEqual(parseTdlrCliArgs(["--backfill"]), { mode: "backfill" });
    assert.deepEqual(parseTdlrCliArgs([]), { mode: "daily" });

    // Return unsorted discovery rows spanning 2023 (outside backfill window), 2024, 2025, 2026, plus a non-compute Shopping Center noise row
    const searchPayload = {
      data: [
        {
          ProjectCreatedOn: "2026-10-15T14:37:16.93",
          ProjectNumber: "TABS2027003697",
          ProjectName:
            "Compass Datacenters - DFWIII-III - Building 10 - Interior / Tenant Fit Out",
          FacilityName: "DFWIII III - Building 10",
          ProjectStatus: 3008,
          EstimatedCost: 100000000.0,
        },
        {
          ProjectCreatedOn: "2024-03-10T09:15:00.00",
          ProjectNumber: "TABS2024001100",
          ProjectName: "QTS DFW1 - Data Center Hall 1",
          FacilityName: "QTS Data Center",
          ProjectStatus: 3008,
          EstimatedCost: 65000000.0,
        },
        {
          ProjectCreatedOn: "2025-07-22T11:00:00.00",
          ProjectNumber: "TABS2025002200",
          ProjectName: "CyrusOne DFW8 Data Center Expansion",
          FacilityName: "CyrusOne Data Center",
          ProjectStatus: 3008,
          EstimatedCost: 85000000.0,
        },
        {
          ProjectCreatedOn: "2023-05-01T08:00:00.00",
          ProjectNumber: "TABS2023000500",
          ProjectName: "Legacy 2023 Data Center Phase 0",
          FacilityName: "Legacy Data Center",
          ProjectStatus: 3008,
          EstimatedCost: 40000000.0,
        },
        {
          ProjectCreatedOn: "2025-09-01T10:00:00.00",
          ProjectNumber: "TABS2025009999",
          ProjectName: "Sunset Strip Shopping Center Remodel",
          FacilityName: "Sunset Shopping Center",
          ProjectStatus: 3008,
          EstimatedCost: 1500000.0,
        },
      ],
    };

    routeMap.set("/TABS/Search/SearchProjects", {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(searchPayload),
    });

    const makeDetailHtml = (projectNumber: string, projectName: string, regDate: string) =>
      FROZEN_TABS_2027003697_HTML.replaceAll("TABS2027003697", projectNumber)
        .replace(
          "Compass Datacenters - DFWIII-III - Building 10 - Interior / Tenant Fit Out",
          projectName
        )
        .replace("10/15/2026", regDate);

    routeMap.set("/TABS/Search/Project/TABS2024001100", {
      body: makeDetailHtml("TABS2024001100", "QTS DFW1 - Data Center Hall 1", "03/10/2024"),
    });
    routeMap.set("/TABS/Search/Project/TABS2025002200", {
      body: makeDetailHtml("TABS2025002200", "CyrusOne DFW8 Data Center Expansion", "07/22/2025"),
    });
    routeMap.set("/TABS/Search/Project/TABS2027003697", {
      body: FROZEN_TABS_2027003697_HTML,
    });

    const repository = createInMemoryGridlockRepository();
    const recordedSleeps: number[] = [];

    const sweepResult = await runTdlrDiscoverySweep(
      {
        mode: "backfill",
        baseUrl,
        now: new Date("2026-10-25T14:00:00.000Z"),
        searchFilters: [
          { field: "ProjectName", value: "Data Center" },
          { field: "OwnerName", value: "QTS" },
          // Multi-word OwnerName must be ignored by the OwnerName tokenization guardrail
          { field: "OwnerName", value: "Data Center" },
        ],
      },
      {
        repository,
        sleep: async (ms: number) => {
          recordedSleeps.push(ms);
        },
        jitterMs: () => 125,
      }
    );

    assert.equal(sweepResult.status, "completed");
    assert.equal(sweepResult.mode, "backfill");
    assert.equal(sweepResult.circuitBreakerTripped, false);
    assert.equal(sweepResult.tokensUsed, 0);

    // Chronological order (2024 -> 2025 -> 2026); 2023 and Shopping Center excluded
    assert.deepEqual(sweepResult.ingestedProjectNumbers, [
      "TABS2024001100",
      "TABS2025002200",
      "TABS2027003697",
    ]);

    // Single-flight concurrency and >= 1,500ms delay between requests
    assert.equal(maxInFlightSeen, 1);
    assert.ok(recordedSleeps.length >= 3);
    for (const delayMs of recordedSleeps) {
      assert.ok(
        delayMs >= 1_500,
        `Expected polite pacing delay >= 1500ms, got ${delayMs}ms`
      );
    }

    // Verify POST /TABS/Search/SearchProjects headers and OwnerName single-token guardrail
    const postRequests = recordedRequests.filter(
      (req) => req.method === "POST" && req.url === "/TABS/Search/SearchProjects"
    );
    assert.equal(postRequests.length, 2);
    for (const req of postRequests) {
      assert.equal(req.headers["user-agent"], GRIDLOCK_USER_AGENT);
      assert.equal(req.headers["x-requested-with"], "XMLHttpRequest");
      assert.ok(
        !req.body.includes("OwnerName=Data+Center") &&
          !req.body.includes("OwnerName=Data%20Center"),
        "Multi-word OwnerName filter must be blocked by tokenization guardrail"
      );
    }
  });

  test("enforces <= 100 records/run circuit breaker on oversized discovery sets, halts search on WAF/Retry-After HTTP-date, and supports daily incremental sinceDate", async () => {
    const oversizedRows = Array.from({ length: 135 }, (_, idx) => {
      const num = String(1000 + idx).padStart(4, "0");
      const day = String((idx % 28) + 1).padStart(2, "0");
      const month = String((Math.floor(idx / 28) % 12) + 1).padStart(2, "0");
      const projectNumber = `TABS202600${num}`;
      routeMap.set(`/TABS/Search/Project/${projectNumber}`, {
        status: 200,
        body: FROZEN_TABS_2027003697_HTML.replaceAll("TABS2027003697", projectNumber),
      });
      return {
        ProjectCreatedOn: `2026-${month}-${day}T12:00:00.000Z`,
        ProjectNumber: projectNumber,
        ProjectName: `Texas Hyperscale Data Center Hall ${idx + 1}`,
        FacilityName: `Data Center Campus ${idx + 1}`,
        ProjectStatus: 3008,
        EstimatedCost: 50_000_000,
      };
    });

    routeMap.set("/TABS/Search/SearchProjects", {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ data: oversizedRows }),
    });

    const repository = createInMemoryGridlockRepository();
    const now = new Date("2026-10-25T14:00:00.000Z");

    const cappedSweep = await runTdlrDiscoverySweep(
      {
        mode: "backfill",
        baseUrl,
        now,
        // Try requesting 250; circuit breaker must still clamp at MAX_RECORDS_PER_RUN (100)
        maxRecordsPerRun: 250,
        searchFilters: [{ field: "ProjectName", value: "Data Center" }],
      },
      {
        repository,
        sleep: async () => {},
        jitterMs: () => 0,
      }
    );

    assert.equal(cappedSweep.status, "completed");
    assert.equal(cappedSweep.discoveredCount, 135);
    assert.equal(cappedSweep.circuitBreakerTripped, true);
    assert.equal(cappedSweep.ingestedProjectNumbers.length, 100);
    assert.equal(cappedSweep.skippedByCircuitBreakerCount, 35);
    assert.equal((await repository.listProjects()).length, 100);

    // Daily weekday mode with incremental sinceDate filter
    const dailySweep = await runTdlrDiscoverySweep(
      {
        mode: "daily",
        baseUrl,
        now,
        sinceDate: new Date("2026-05-15T00:00:00.000Z"),
        searchFilters: [{ field: "ProjectName", value: "Data Center" }],
      },
      {
        repository,
        sleep: async () => {},
        jitterMs: () => 0,
      }
    );
    assert.equal(dailySweep.status, "completed");
    assert.ok(dailySweep.discoveredCount < 135 && dailySweep.discoveredCount > 0);

    // Search endpoint blocked by HTTP 429 with RFC 7231 HTTP-date Retry-After header
    routeMap.set("/TABS/Search/SearchProjects", {
      status: 429,
      headers: { "Retry-After": "Sun, 25 Oct 2026 14:03:00 GMT" },
      body: "Rate limit exceeded",
    });

    const blockedSweep = await runTdlrDiscoverySweep(
      {
        mode: "daily",
        baseUrl,
        now,
        searchFilters: [{ field: "ProjectName", value: "Data Center" }],
      },
      {
        repository,
        sleep: async () => {},
        jitterMs: () => 0,
      }
    );
    assert.equal(blockedSweep.status, "blocked_by_waf");
    assert.equal(blockedSweep.tokensUsed, 0);
    assert.equal(blockedSweep.retryAfterSeconds, 180);
  });

  test(
    "live TDLR TABS reachability smoke check (opt-in via LIVE_ACCESS_TEST=1)",
    { skip: process.env.LIVE_ACCESS_TEST !== "1" },
    async () => {
      const response = await fetch(
        "https://www.tdlr.texas.gov/TABS/Search/Project/TABS2027003697",
        {
          headers: {
            "user-agent": GRIDLOCK_USER_AGENT,
            accept: "text/html,application/xhtml+xml",
          },
        }
      );
      const body = await response.text();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
      const access = verifySiteAccess({
        status: response.status,
        headers,
        body,
      });
      if (response.status === 503) {
        // Sunday maintenance window on TDLR TABS: verifySiteAccess must halt at 0 tokens
        assert.equal(access.allowed, false);
        assert.equal(access.status, "blocked_by_waf");
        assert.equal(access.tokensUsed, 0);
      } else {
        assert.equal(response.status, 200);
        assert.equal(access.allowed, true);
        assert.equal(access.status, "ok");
        assert.ok(body.includes("TABS2027003697"));
      }
    }
  );
});
