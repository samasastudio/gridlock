import {
  CitedObservationSchema,
  CitedProjectSchema,
  type CitedObservation,
  type CitedProject,
  type MetricComparisonTableNode,
  type ObservationTimelineNode,
  type Project,
  type ProjectDossierCardNode,
} from "@samasastudio/gridlock-core/schemas";

export type AstPreviewNode =
  | ProjectDossierCardNode
  | ObservationTimelineNode
  | MetricComparisonTableNode;

const HASH_COMPUTE_T1 = "1".repeat(64);
const HASH_SUBSTATION_T1 = "2".repeat(64);
const HASH_COMPUTE_LATEST = "a".repeat(64);
const HASH_SUBSTATION_LATEST = "b".repeat(64);
const HASH_LOGISTICS_LATEST = "c".repeat(64);

function makeStoryCitation(
  projectNumber: string,
  sha256: string,
  capturedAt: string,
  referencedByMilestone: boolean
): CitedProject["citation"] {
  return {
    sha256,
    connectorId: "tdlr-tabs",
    sourceUrl: `https://www.tdlr.texas.gov/TABS/Search/Project/${projectNumber}`,
    capturedAt,
    referencedByMilestone,
  };
}

function makeStoryProject(
  project: Project,
  capturedAt: string,
  referencedByMilestone: boolean
): CitedProject {
  return CitedProjectSchema.parse({
    project,
    citation: makeStoryCitation(
      project.projectNumber,
      project.latestRawCaptureHash,
      capturedAt,
      referencedByMilestone
    ),
  });
}

function makeStoryObservation(
  observation: CitedObservation["observation"]
): CitedObservation {
  return CitedObservationSchema.parse({
    observation,
    citation: makeStoryCitation(
      observation.projectNumber,
      observation.rawCaptureHash,
      observation.observedAt,
      observation.isMilestone
    ),
  });
}

export const STORY_COMPUTE_CAMPUS_PROJECT = makeStoryProject(
  {
    projectNumber: "TABS2027003697",
    projectName: "Hutto Mega-Corridor Compute Campus Building A",
    facilityName: "Hutto Switchyard Compute Campus",
    ownerName: "Brazos Valley Compute Infrastructure LLC",
    designFirmName: "Corgan Associates, Inc.",
    locationAddress: "CR 137 & US-79 Industrial Corridor, Hutto, TX 78634",
    county: "Williamson",
    estimatedCostUsd: 148_000_000,
    squareFootage: 240_000,
    typeOfWork: "New Construction",
    scopeOfWork:
      "Construct a 240,000 sq ft liquid-cooled AI compute hall with dual 345kV substation interconnect bays and closed-loop chiller yard.",
    currentStatus: "Under Construction",
    startDate: "2027-02-01",
    completionDate: "2028-08-01",
    latestRawCaptureHash: HASH_COMPUTE_LATEST,
    updatedAt: "2026-11-18T15:30:00.000Z",
  },
  "2026-11-18T15:28:12.000Z",
  true
);

export const STORY_SUBSTATION_YARD_PROJECT = makeStoryProject(
  {
    projectNumber: "TABS2027004112",
    projectName: "Taylor Switchgear \\[Substation Yard\\] \\*Phase 1\\*",
    facilityName: "Samsung Highway 345kV Interconnect Station",
    ownerName: "Oncor Corridor Transmission Holdings LLC",
    designFirmName: "Burns & McDonnell Engineering Co.",
    locationAddress: "FM 973 & CR 404 Utility Easement, Taylor, TX 76574",
    county: "Williamson",
    estimatedCostUsd: 52_000_000,
    squareFootage: 85_000,
    typeOfWork: "New Construction",
    scopeOfWork:
      "Construct \\[Substation Yard\\] \\*Phase 1\\* 85,000 sq ft gas-insulated switchgear hall, relay control house, and synchronous condenser pad.",
    currentStatus: "Under Construction",
    startDate: "2027-01-15",
    completionDate: "2028-01-15",
    latestRawCaptureHash: HASH_SUBSTATION_LATEST,
    updatedAt: "2026-11-12T09:30:00.000Z",
  },
  "2026-11-12T09:25:00.000Z",
  true
);

export const STORY_LOGISTICS_SHELL_PROJECT = makeStoryProject(
  {
    projectNumber: "TABS2027004890",
    projectName: "San Marcos Regional Logistics Shell Building 4",
    facilityName: "I-35 South Distribution Park",
    ownerName: "Hill Country Industrial Partners LP",
    locationAddress: "[REDACTED_ADDRESS], San Marcos, TX 78666",
    county: "Hays",
    estimatedCostUsd: 18_500_000,
    squareFootage: 310_000,
    typeOfWork: "Core & Shell",
    scopeOfWork:
      "Construct a 310,000 sq ft tilt-wall distribution warehouse shell and loading court adjacent to [REDACTED_ADDRESS] municipal buffer.",
    currentStatus: "Project Registered",
    startDate: "2027-03-01",
    completionDate: "2027-11-01",
    latestRawCaptureHash: HASH_LOGISTICS_LATEST,
    updatedAt: "2026-11-19T09:15:00.000Z",
  },
  "2026-11-19T09:12:00.000Z",
  false
);

export const STORY_INTERLEAVED_OBSERVATIONS: CitedObservation[] = [
  makeStoryObservation({
    id: "obs_tabs_3697_t1",
    projectNumber: "TABS2027003697",
    rawCaptureHash: HASH_COMPUTE_T1,
    observedAt: "2026-08-14T14:10:00.000Z",
    status: "Project Registered",
    estimatedCostUsd: 95_000_000,
    squareFootage: 180_000,
    scopeOfWork:
      "Initial registration for Building A 180,000 sq ft liquid-cooled compute hall and primary utility yard.",
    isMilestone: true,
  }),
  makeStoryObservation({
    id: "obs_tabs_4112_t1",
    projectNumber: "TABS2027004112",
    rawCaptureHash: HASH_SUBSTATION_T1,
    observedAt: "2026-09-22T11:05:00.000Z",
    status: "Project Registered",
    estimatedCostUsd: 22_000_000,
    squareFootage: 65_000,
    scopeOfWork:
      "Initial \\[Substation Yard\\] \\*Phase 1\\* grading and 65,000 sq ft relay control enclosure filing.",
    isMilestone: false,
  }),
  makeStoryObservation({
    id: "obs_tabs_3697_t2",
    projectNumber: "TABS2027003697",
    rawCaptureHash: HASH_COMPUTE_LATEST,
    observedAt: "2026-10-19T16:40:00.000Z",
    status: "Under Construction",
    estimatedCostUsd: 148_000_000,
    squareFootage: 240_000,
    scopeOfWork:
      "Expand Building A compute hall to 240,000 sq ft with dual 345kV substation interconnect bays and closed-loop chiller yard.",
    isMilestone: true,
  }),
  makeStoryObservation({
    id: "obs_tabs_4112_t2",
    projectNumber: "TABS2027004112",
    rawCaptureHash: HASH_SUBSTATION_LATEST,
    observedAt: "2026-11-12T09:25:00.000Z",
    status: "Under Construction",
    estimatedCostUsd: 52_000_000,
    squareFootage: 85_000,
    scopeOfWork:
      "Upsize \\[Substation Yard\\] \\*Phase 1\\* to 85,000 sq ft gas-insulated switchgear hall and synchronous condenser pad.",
    isMilestone: true,
  }),
];

export const DEFAULT_BRIEF_NODES: readonly AstPreviewNode[] = [
  {
    nodeId: "brief-lead-dossier",
    component: "ProjectDossierCard",
    citedProject: STORY_COMPUTE_CAMPUS_PROJECT,
  },
  {
    nodeId: "brief-corridor-timeline",
    component: "ObservationTimeline",
    projectNumbers: ["TABS2027003697", "TABS2027004112"],
    observations: STORY_INTERLEAVED_OBSERVATIONS,
  },
  {
    nodeId: "brief-cohort-comparison",
    component: "MetricComparisonTable",
    rows: [
      STORY_COMPUTE_CAMPUS_PROJECT,
      STORY_SUBSTATION_YARD_PROJECT,
      STORY_LOGISTICS_SHELL_PROJECT,
    ],
  },
];
