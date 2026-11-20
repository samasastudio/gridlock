import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import {
  ARTIFACT_BUCKET_URI,
  bootstrapCanvas,
  branchLineage,
  CANONICAL_MILESTONE_LABEL,
  CandidateSelectorPatchSchema,
  createGridlockHttpServer,
  createInMemoryGridlockRepository,
  DEFAULT_LINEAGE_ID,
  ingestTdlrFiling,
  ObservationSchema,
  PAINTER_AGENT_MODEL,
  runOutOfBandRepairAgent,
  SCENARIO_BRANCH_WATERMARK,
  VisualPlateSchema,
  type GeminiInteractionCreateRequest,
  type GeminiInteractionResponse,
  type GeminiInteractionsClient,
  type GridlockHttpDeps,
  type GridlockRepository,
  type Observation,
  type PlannerLayoutSpec,
  type VisualPlate,
} from "../../src/index.ts";
import {
  createFixtureWebpBuffer,
  createTestProject,
  createTestSourceArtifact,
  GZIP_HTML_STUB,
  HISTORICAL_FIXTURE_V1_HTML,
  MUTATED_PORTAL_V2_HTML,
} from "./fixtures.ts";

export const PLANNER_TEST_NOW = new Date("2026-10-28T15:00:00.000Z");
export const HASH_ACTIVE_A = "a".repeat(64);
export const HASH_ACTIVE_B = "b".repeat(64);
export const HASH_QUARANTINED = "c".repeat(64);
export const HASH_EXPIRED = "d".repeat(64);

const ROBOTS_ALLOW_ALL = "User-agent: *\nAllow: /\n";

export function singleNodeLayout(
  node: Record<string, unknown>
): Record<string, unknown> {
  return { nodes: [node] };
}

export function createPlannerObservation(
  id: string,
  projectNumber: string,
  sourceArtifactHash: string,
  overrides: Partial<Observation> = {}
): Observation {
  return ObservationSchema.parse({
    id,
    projectNumber,
    sourceArtifactHash,
    observedAt: "2026-10-28T10:00:00.000Z",
    status: "Project Registered",
    estimatedCostUsd: 120_000_000,
    squareFootage: 260_000,
    scopeOfWork: "Construct hyperscale data hall A",
    isMilestone: true,
    ...overrides,
  });
}

export function createPlannerClientStub(
  responder: (
    req: GeminiInteractionCreateRequest
  ) => Promise<GeminiInteractionResponse>
): {
  geminiClient: GeminiInteractionsClient;
  recordedRequests: GeminiInteractionCreateRequest[];
} {
  const recordedRequests: GeminiInteractionCreateRequest[] = [];
  return {
    recordedRequests,
    geminiClient: {
      interactions: {
        create: async (req) => {
          recordedRequests.push(req);
          return responder(req);
        },
      },
    },
  };
}

export function createQueuedLayoutClientStub(
  layouts: ReadonlyArray<Record<string, unknown>>,
  options: {
    idPrefix?: string;
    baseTokens?: number;
    tokenStep?: number;
  } = {}
): {
  geminiClient: GeminiInteractionsClient;
  recordedRequests: GeminiInteractionCreateRequest[];
} {
  const idPrefix = options.idPrefix ?? "ix_queued";
  const baseTokens = options.baseTokens ?? 240;
  const tokenStep = options.tokenStep ?? 20;
  let turnIndex = 0;
  return createPlannerClientStub(async () => {
    const layout = layouts[turnIndex];
    assert.notEqual(layout, undefined);
    turnIndex += 1;
    return {
      id: `${idPrefix}_${turnIndex}`,
      status: "completed",
      output_text: JSON.stringify(layout),
      usage: { total_tokens: baseTokens + turnIndex * tokenStep },
    };
  });
}

export async function seedFilingPlannerRepository(): Promise<GridlockRepository> {
  const repository = createInMemoryGridlockRepository();

  await repository.saveSourceArtifact(
    createTestSourceArtifact(HASH_ACTIVE_A, "TABS2027001001"),
    GZIP_HTML_STUB
  );
  await repository.saveSourceArtifact(
    createTestSourceArtifact(HASH_ACTIVE_B, "TABS2027001002"),
    GZIP_HTML_STUB
  );
  await repository.saveSourceArtifact(
    createTestSourceArtifact(HASH_QUARANTINED, "TABS2027001003", {
      storageUri: `${ARTIFACT_BUCKET_URI}/quarantine/${HASH_QUARANTINED}.gz`,
      referencedByMilestone: false,
    }),
    GZIP_HTML_STUB
  );
  await repository.saveSourceArtifact(
    createTestSourceArtifact(HASH_EXPIRED, "TABS2027001004", {
      expiresAt: "2026-10-15T00:00:00.000Z",
      referencedByMilestone: false,
    }),
    GZIP_HTML_STUB
  );

  await repository.upsertProject(
    createTestProject("TABS2027001001", HASH_ACTIVE_A, {
      projectName: "Ellis Campus Hall A - contact ops@example.com",
      ownerName: "Corridor Holdings LLC (512) 555-0199",
      estimatedCostUsd: 120_000_000,
      squareFootage: 260_000,
      updatedAt: "2026-10-28T10:00:00.000Z",
    })
  );
  await repository.upsertProject(
    createTestProject("TABS2027001002", HASH_ACTIVE_B, {
      projectName: "Ellis Campus Hall B",
      estimatedCostUsd: 95_000_000,
      squareFootage: 210_000,
      updatedAt: "2026-10-27T10:00:00.000Z",
    })
  );
  await repository.upsertProject(
    createTestProject("TABS2027001003", HASH_QUARANTINED, {
      projectName: "Quarantined Filing Project",
    })
  );
  await repository.upsertProject(
    createTestProject("TABS2027001004", HASH_EXPIRED, {
      projectName: "Expired Filing Project",
    })
  );

  await repository.appendObservation(
    createPlannerObservation("obs_1001_m1", "TABS2027001001", HASH_ACTIVE_A)
  );
  await repository.appendObservation(
    createPlannerObservation("obs_1002_r1", "TABS2027001002", HASH_ACTIVE_B, {
      observedAt: "2026-10-27T10:00:00.000Z",
      estimatedCostUsd: 95_000_000,
      squareFootage: 210_000,
      scopeOfWork: "Interior fit-out for data hall B",
      isMilestone: false,
    })
  );

  return repository;
}

async function saveTestVisualPlate(
  repository: GridlockRepository,
  overrides: Partial<VisualPlate> &
    Pick<
      VisualPlate,
      | "plateId"
      | "lineageId"
      | "projectNumbers"
      | "triggeringObservationIds"
      | "sourceArtifactHashes"
      | "sha256"
    >
): Promise<void> {
  const webpBuf = createFixtureWebpBuffer(overrides.plateId);
  const isBranch = overrides.isBranch ?? false;
  await repository.saveVisualPlate(
    VisualPlateSchema.parse({
      turnNumber: 1,
      model: PAINTER_AGENT_MODEL,
      interactionId: `ix_${overrides.plateId}`,
      parentInteractionId: null,
      parentPlateId: null,
      prompt: `Fixture prompt ${overrides.plateId}`,
      storageUri: `${ARTIFACT_BUCKET_URI}/plates/${overrides.plateId}.webp`,
      mimeType: "image/webp",
      byteLength: webpBuf.byteLength,
      isBranch,
      epistemicLabel: isBranch
        ? SCENARIO_BRANCH_WATERMARK
        : CANONICAL_MILESTONE_LABEL,
      watermarkText: isBranch ? SCENARIO_BRANCH_WATERMARK : null,
      createdAt: "2026-10-20T15:00:00.000Z",
      expiresAt: null,
      ...overrides,
    }),
    webpBuf
  );
}

export async function seedFiveCardPlannerRepository(): Promise<{
  repository: GridlockRepository;
  canonicalArtifactHash: string;
  branchPlateId: string;
}> {
  const repository = await seedFilingPlannerRepository();

  const anomaly = await ingestTdlrFiling(
    {
      projectNumber: "TABS2027009888",
      baseUrl: "https://www.tdlr.texas.gov",
      now: new Date("2026-10-27T14:00:00.000Z"),
      robotsTxt: ROBOTS_ALLOW_ALL,
    },
    {
      repository,
      pageLoader: async () => ({
        status: 200,
        contentType: "text/html",
        body: MUTATED_PORTAL_V2_HTML,
      }),
    }
  );
  assert.equal(anomaly.status, "selector_anomaly");
  if (anomaly.status !== "selector_anomaly") {
    throw new Error("Expected selector_anomaly for TABS2027009888");
  }

  const repairResult = await runOutOfBandRepairAgent(
    {
      connectorId: "tdlr-tabs",
      quarantinedArtifact: anomaly.sourceArtifact,
      brokenInvariants: anomaly.invariantErrors,
      historicalFixtures: [HISTORICAL_FIXTURE_V1_HTML],
      anomalyDetectedAt: new Date("2026-10-27T14:00:00.000Z"),
      now: new Date("2026-10-27T14:00:02.000Z"),
    },
    {
      repository,
      geminiClient: {
        interactions: {
          create: async () => ({
            id: "ix_repair_seam3",
            status: "completed",
            output_text: JSON.stringify(
              CandidateSelectorPatchSchema.parse({
                detailContainerSelector:
                  ".project-details, .tabs-project-details-v2",
                fieldLabels: {
                  estimatedCost: "Estimated Cost: | Total Estimated Cost:",
                },
                rootCauseSummary: "Portal wrapper updated to v2 container",
              })
            ),
            usage: { total_tokens: 210 },
          }),
        },
      },
    }
  );
  assert.equal(repairResult.status, "repair_promoted");

  let painterSeq = 0;
  const painterClient: GeminiInteractionsClient = {
    interactions: {
      create: async () => {
        painterSeq += 1;
        return {
          id: `ix_painter_seam_${painterSeq}`,
          status: "completed",
          output_image: {
            mime_type: "image/webp",
            data: createFixtureWebpBuffer(
              `planner-plate-${painterSeq}`
            ).toString("base64"),
          },
          usage: { total_tokens: 160 },
        };
      },
    },
  };

  const ellisObservations =
    await repository.listObservationsByProject("TABS2027001001");
  const bootstrapRes = await bootstrapCanvas(
    {
      lineageId: DEFAULT_LINEAGE_ID,
      observations: ellisObservations,
      prompt: "Bootstrap Ellis corridor plate",
      now: new Date("2026-10-27T15:00:00.000Z"),
    },
    { repository, geminiClient: painterClient }
  );
  assert.equal(bootstrapRes.status, "plate_painted");
  if (bootstrapRes.status !== "plate_painted") {
    throw new Error("Expected plate_painted for bootstrapCanvas");
  }

  const branchRes = await branchLineage(
    {
      lineageId: DEFAULT_LINEAGE_ID,
      parentInteractionId: bootstrapRes.plate.interactionId,
      scenarioPrompt: "Add 300MW switchyard for planner_lead@example.com",
      now: new Date("2026-10-27T15:10:00.000Z"),
    },
    { repository, geminiClient: painterClient }
  );
  assert.equal(branchRes.status, "plate_painted");
  if (branchRes.status !== "plate_painted") {
    throw new Error("Expected plate_painted for branchLineage");
  }

  await saveTestVisualPlate(repository, {
    plateId: "plate_expired_branch",
    lineageId: DEFAULT_LINEAGE_ID,
    turnNumber: 2,
    parentInteractionId: bootstrapRes.plate.interactionId,
    parentPlateId: bootstrapRes.plate.plateId,
    projectNumbers: ["TABS2027001001"],
    triggeringObservationIds: ["obs_1001_m1"],
    sourceArtifactHashes: [HASH_ACTIVE_A],
    storageUri: `${ARTIFACT_BUCKET_URI}/branches/ephemeral/plate_expired_branch.webp`,
    sha256: "9".repeat(64),
    isBranch: true,
    scenarioPrompt: "Expired scenario prompt",
    createdAt: "2026-07-01T10:00:00.000Z",
    expiresAt: "2026-09-29T10:00:00.000Z",
  });

  await repository.appendObservation(
    createPlannerObservation(
      "obs_quarantined_lineage",
      "TABS2027001003",
      HASH_QUARANTINED
    )
  );
  await saveTestVisualPlate(repository, {
    plateId: "plate_quarantined_1",
    lineageId: "quarantined-lineage",
    projectNumbers: ["TABS2027001003"],
    triggeringObservationIds: ["obs_quarantined_lineage"],
    sourceArtifactHashes: [HASH_QUARANTINED],
    sha256: "e".repeat(64),
  });

  await repository.appendObservation(
    createPlannerObservation(
      "obs_expired_lineage",
      "TABS2027001004",
      HASH_EXPIRED
    )
  );
  await saveTestVisualPlate(repository, {
    plateId: "plate_expired_1",
    lineageId: "expired-lineage",
    projectNumbers: ["TABS2027001004"],
    triggeringObservationIds: ["obs_expired_lineage"],
    sourceArtifactHashes: [HASH_EXPIRED],
    sha256: "f".repeat(64),
  });

  return {
    repository,
    canonicalArtifactHash: HASH_ACTIVE_A,
    branchPlateId: branchRes.plate.plateId,
  };
}

export function createFiveCardLayoutSpec(
  branchPlateId: string
): PlannerLayoutSpec {
  return {
    nodes: [
      {
        nodeId: "dossier-1001",
        component: "ProjectDossierCard",
        projectNumber: "TABS2027001001",
      },
      {
        nodeId: "timeline-corridor",
        component: "ObservationTimeline",
        projectNumbers: ["TABS2027001001", "TABS2027001002"],
      },
      {
        nodeId: "metrics-corridor",
        component: "MetricComparisonTable",
        projectNumbers: ["TABS2027001001", "TABS2027001002"],
      },
      {
        nodeId: "scrubber-corridor",
        component: "VisualPlateScrubber",
        lineageId: DEFAULT_LINEAGE_ID,
        initialPlateId: branchPlateId,
      },
      {
        nodeId: "health-tdlr",
        component: "ConnectorHealthCard",
        connectorId: "tdlr-tabs",
      },
    ],
  };
}

export async function withGridlockTestServer(
  deps: GridlockHttpDeps,
  run: (baseUrl: string) => Promise<void>
): Promise<void> {
  const server = createGridlockHttpServer(deps);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

export function postInvestigatePlan(
  url: string,
  body: string
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

export async function assertInvestigateErrorResponse(
  resPromise: Promise<Response>,
  expectedStatus: number,
  expectedError: string
): Promise<Response> {
  const res = await resPromise;
  assert.equal(res.status, expectedStatus);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.equal(res.headers.get("cache-control"), "no-store");
  const payload = (await res.json()) as { error: string; message: string };
  assert.equal(payload.error, expectedError);
  assert.equal(typeof payload.message, "string");
  return res;
}
