import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  GRIDLOCK_WIDGET_MANIFEST,
  formatProjectCitationBadge,
} from "../src/index.ts";

describe("@samasastudio/gridlock-widgets shell", () => {
  test("exports widget manifest and formats SHA-256 provenance citation badge from core Project schema", () => {
    assert.deepEqual(GRIDLOCK_WIDGET_MANIFEST.widgets, [
      "GridlockPlateWidget",
      "GridlockConsoleWidget",
      "GridlockRepairLogWidget",
    ]);

    const sha256 = "a".repeat(64);
    const badge = formatProjectCitationBadge({
      projectNumber: "TABS2027003697",
      projectName: "Compass Datacenters - DFWIII-III - Building 10 - Interior / Tenant Fit Out",
      facilityName: "DFWIII III - Building 10",
      ownerName: "COMPASS DATACENTERS DFW III-I LLC",
      locationAddress: "590 Austin Blvd, Red Oak, TX 75154",
      county: "Ellis",
      estimatedCostUsd: 100_000_000,
      squareFootage: 251_815,
      typeOfWork: "Renovation/Alteration",
      scopeOfWork: "251,815 sq. ft of Interior / Tenant Fit-Out for construction of a new Data Center on a Data Center Campus.",
      currentStatus: "Project Registered",
      startDate: "2024-12-01",
      completionDate: "2028-08-22",
      latestSourceArtifactHash: sha256,
      updatedAt: "2026-10-25T14:00:00.000Z",
    });

    assert.equal(badge, "TABS2027003697 · Ellis County · sha256:aaaaaaaaaaaa");
  });
});
