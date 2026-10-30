import { Buffer } from "node:buffer";
import { crc32, deflateSync } from "node:zlib";
import { createCorridorBaseCanvasWebp, isWebpBuffer, ObservationSchema, type Observation } from "../../src/index.ts";

export { isWebpBuffer };

export const FROZEN_TABS_2027003697_HTML = `<!DOCTYPE html>
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

export const HISTORICAL_FIXTURE_V1_HTML = FROZEN_TABS_2027003697_HTML;

export const MUTATED_PORTAL_V2_HTML = HISTORICAL_FIXTURE_V1_HTML
  .replace('<div class="project-details">', '<div class="tabs-project-details-v2">')
  .replace("<dt>Estimated Cost:</dt>", "<dt>Total Estimated Cost:</dt>")
  .replace("<dd>TABS2027003697</dd>", "<dd>TABS2027009888</dd>");

export function createFixtureWebpBuffer(payloadTag = "gridlock-corridor-v1"): Buffer {
  return createCorridorBaseCanvasWebp(payloadTag);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const [body, len, crc] = [Buffer.concat([Buffer.from(type, "ascii"), data]), Buffer.alloc(4), Buffer.alloc(4)];
  len.writeUInt32BE(data.byteLength, 0);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}

export function createSamplePngBuffer(width = 16, height = 9): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const scanlines = Buffer.concat(
    Array.from({ length: height }, (_, y) => {
      const row = Buffer.alloc(1 + width * 4);
      Array.from({ length: width }, (__, x) => row.set([245, (242 - y * 4) & 0xff, (235 - x * 3) & 0xff, 255], 1 + x * 4));
      return row;
    })
  );
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(scanlines)), pngChunk("IEND", Buffer.alloc(0))]);
}

export function createPainterTestObservations(): { routineObs: Observation; milestoneObs: Observation } {
  return {
    routineObs: ObservationSchema.parse({ id: "obs_TABS2027001111_routine", projectNumber: "TABS2027001111", sourceArtifactHash: "1".repeat(64), observedAt: "2026-10-27T14:00:00.000Z", status: "Project Registered", estimatedCostUsd: 2_500_000, squareFootage: 12_000, scopeOfWork: "Minor interior office remodel", isMilestone: false }),
    milestoneObs: ObservationSchema.parse({ id: "obs_TABS2027003697_m1", projectNumber: "TABS2027003697", sourceArtifactHash: "a".repeat(64), observedAt: "2026-10-27T14:05:00.000Z", status: "Project Registered", estimatedCostUsd: 125_000_000, squareFootage: 250_000, scopeOfWork: "New 250,000 sq ft hyperscale data center shell", isMilestone: true }),
  };
}
