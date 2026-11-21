import assert from "node:assert/strict";
import {
  ARTIFACT_BUCKET_URI,
  createInMemoryGridlockRepository,
  ObservationSchema,
  type GeminiInteractionCreateRequest,
  type GeminiInteractionResponse,
  type GeminiInteractionsClient,
  type GridlockRepository,
  type Observation,
} from "../../src/index.ts";
import {
  createTestProject,
  createTestSourceArtifact,
  GZIP_HTML_STUB,
} from "./fixtures.ts";

export const PLANNER_TEST_NOW = new Date("2026-10-28T15:00:00.000Z");
export const HASH_ACTIVE_A = "a".repeat(64);
export const HASH_ACTIVE_B = "b".repeat(64);
export const HASH_QUARANTINED = "c".repeat(64);
export const HASH_EXPIRED = "d".repeat(64);

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
