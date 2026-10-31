import { Buffer } from "node:buffer";

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

export function createFixtureWebpBuffer(
  payloadTag = "gridlock-corridor-v1"
): Buffer {
  const payload = Buffer.from(`WEBP_VP8L_${payloadTag}`, "utf-8");
  const pad =
    payload.byteLength % 2 === 1 ? Buffer.from([0x00]) : Buffer.alloc(0);
  const sizeBuf = Buffer.alloc(4);
  sizeBuf.writeUInt32LE(payload.byteLength, 0);
  const vp8lChunk = Buffer.concat([
    Buffer.from("VP8L", "ascii"),
    sizeBuf,
    payload,
    pad,
  ]);
  const body = Buffer.concat([Buffer.from("WEBP", "ascii"), vp8lChunk]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(body.byteLength, 4);
  return Buffer.concat([header, body]);
}

export function isWebpBuffer(buf: Buffer): boolean {
  if (buf.byteLength < 16) return false;
  return (
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP" &&
    buf.readUInt32LE(4) === buf.byteLength - 8
  );
}
