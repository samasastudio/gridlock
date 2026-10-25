import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  createInMemoryGridlockRepository,
  ingestTdlrFiling,
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
  let routeMap: Map<string, { status?: number; body: string }>;

  beforeEach(async () => {
    routeMap = new Map();
    server = createServer((req, res) => {
      const route = routeMap.get(req.url ?? "");
      if (!route) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("Not Found");
        return;
      }
      res.writeHead(route.status ?? 200, { "content-type": "text/html; charset=utf-8" });
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
});
