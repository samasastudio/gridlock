import type {
  CitedObservation,
  CitedProject,
  Observation,
  Project,
} from "@samasastudio/gridlock-core";

export function makeArtifactHash(hexChar: string): string {
  return hexChar.slice(0, 1).toLowerCase().repeat(64);
}

export interface CitedProjectOverrides {
  project?: Partial<Project>;
  citation?: Partial<CitedProject["citation"]>;
}

export function makeCitedProject(overrides: CitedProjectOverrides = {}): CitedProject {
  const defaultHash = makeArtifactHash("a");
  const project: Project = {
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
    latestRawCaptureHash: defaultHash,
    updatedAt: "2026-11-18T15:30:00.000Z",
    ...overrides.project,
  };

  return {
    project,
    citation: {
      sha256: project.latestRawCaptureHash,
      sourceUrl: `https://www.tdlr.texas.gov/TABS/Search/Project/${project.projectNumber}`,
      connectorId: "tdlr-tabs",
      capturedAt: "2026-11-18T15:28:12.000Z",
      referencedByMilestone: true,
      ...overrides.citation,
    },
  };
}

export function makeEscapedShellCitedProject(): CitedProject {
  const shellHash = makeArtifactHash("b");

  return makeCitedProject({
    project: {
      projectNumber: "TABS2027004890",
      projectName: "San Marcos Logistics \\[Phase 2\\]",
      facilityName: "I-35 South Distribution Park",
      ownerName: "Hill Country Industrial Partners LP",
      designFirmName: undefined,
      locationAddress: "[REDACTED_ADDRESS], San Marcos, TX 78666",
      county: "Hays",
      estimatedCostUsd: 18_500_000,
      squareFootage: 310_000,
      typeOfWork: "\\*Core & Shell\\*",
      scopeOfWork:
        "Construct \\[Phase 2\\] \\*Core & Shell\\* Tilt-Wall distribution building adjacent to [REDACTED_ADDRESS] buffer zone.",
      currentStatus: "Registered",
      startDate: "2027-03-01",
      completionDate: "2027-03-29",
      latestRawCaptureHash: shellHash,
      updatedAt: "2026-11-19T09:15:00.000Z",
    },
    citation: {
      sha256: shellHash,
      capturedAt: "2026-11-19T09:12:00.000Z",
      referencedByMilestone: false,
    },
  });
}

export interface CitedObservationOverrides {
  observation?: Partial<Observation>;
  citation?: Partial<CitedObservation["citation"]>;
}

export function makeCitedObservation(
  overrides: CitedObservationOverrides = {}
): CitedObservation {
  const defaultHash = makeArtifactHash("1");
  const observation: Observation = {
    id: "obs-3697-1",
    projectNumber: "TABS2027003697",
    rawCaptureHash: defaultHash,
    observedAt: "2026-09-10T14:00:00.000Z",
    status: "Registered",
    estimatedCostUsd: 95_000_000,
    squareFootage: 180_000,
    scopeOfWork:
      "Initial registration for \\[Building A\\] 180,000 sq ft liquid-cooled compute hall.",
    isMilestone: true,
    ...overrides.observation,
  };

  return {
    observation,
    citation: {
      sha256: observation.rawCaptureHash,
      sourceUrl: `https://www.tdlr.texas.gov/TABS/Search/Project/${observation.projectNumber}`,
      connectorId: "tdlr-tabs",
      capturedAt: observation.observedAt,
      referencedByMilestone: observation.isMilestone,
      ...overrides.citation,
    },
  };
}

export function makeInterleavedObservations(): readonly CitedObservation[] {
  return [
    makeCitedObservation(),
    makeCitedObservation({
      observation: {
        id: "obs-4112-1",
        projectNumber: "TABS2027004112",
        rawCaptureHash: makeArtifactHash("2"),
        observedAt: "2026-10-04T11:20:00.000Z",
        estimatedCostUsd: 18_500_000,
        squareFootage: 85_000,
        scopeOfWork:
          "Construct \\[Auxiliary Yard\\] adjacent to [REDACTED_ADDRESS] logistics spur.",
        isMilestone: false,
      },
    }),
    makeCitedObservation({
      observation: {
        id: "obs-3697-2",
        rawCaptureHash: makeArtifactHash("3"),
        observedAt: "2026-11-18T15:30:00.000Z",
        status: "Under Construction",
        estimatedCostUsd: 148_000_000,
        squareFootage: 240_000,
        scopeOfWork:
          "Expand Building A compute hall to 240,000 sq ft with dual 345kV interconnect bays.",
      },
    }),
  ];
}
