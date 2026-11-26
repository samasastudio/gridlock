import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import {
  ARTIFACT_BUCKET_URI,
  bootstrapCanvas,
  branchTimeline,
  CANONICAL_MILESTONE_LABEL,
  CandidateSelectorPatchSchema,
  createGridlockHttpServer,
  createInMemoryGridlockRepository,
  DEFAULT_LINEAGE_ID,
  GeneratedIllustrationSchema,
  ingestTdlrFiling,
  ObservationSchema,
  PAINTER_AGENT_MODEL,
  runOutOfBandRepairAgent,
  SCENARIO_BRANCH_WATERMARK,
  type GeminiInteractionCreateRequest,
  type GeminiInteractionResponse,
  type GeminiInteractionsClient,
  type GeneratedIllustration,
  type GridlockHttpDeps,
  type GridlockRepository,
  type Observation,
  type OrchestrationLayoutSpec,
} from "../../src/index.ts";
import {
  createFixtureWebpBuffer,
  createTestProject,
  createTestRawCapture,
  GZIP_HTML_STUB,
  HISTORICAL_FIXTURE_V1_HTML,
  MUTATED_PORTAL_V2_HTML,
} from "./fixtures.ts";

export const ORCHESTRATION_TEST_NOW = new Date("2026-10-28T15:00:00.000Z");
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

export function createOrchestrationObservation(
  id: string,
  projectNumber: string,
  rawCaptureHash: string,
  overrides: Partial<Observation> = {}
): Observation {
  return ObservationSchema.parse({
    id,
    projectNumber,
    rawCaptureHash,
    observedAt: "2026-10-28T10:00:00.000Z",
    status: "Project Registered",
    estimatedCostUsd: 120_000_000,
    squareFootage: 260_000,
    scopeOfWork: "Construct hyperscale data hall A",
    isMilestone: true,
    ...overrides,
  });
}

export function createOrchestrationClientStub(
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
  return createOrchestrationClientStub(async () => {
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

export async function seedFilingOrchestrationRepository(): Promise<GridlockRepository> {
  const repository = createInMemoryGridlockRepository();

  await repository.saveRawCapture(
    createTestRawCapture(HASH_ACTIVE_A, "TABS2027001001"),
    GZIP_HTML_STUB
  );
  await repository.saveRawCapture(
    createTestRawCapture(HASH_ACTIVE_B, "TABS2027001002"),
    GZIP_HTML_STUB
  );
  await repository.saveRawCapture(
    createTestRawCapture(HASH_QUARANTINED, "TABS2027001003", {
      storageUri: `${ARTIFACT_BUCKET_URI}/quarantine/${HASH_QUARANTINED}.gz`,
      referencedByMilestone: false,
    }),
    GZIP_HTML_STUB
  );
  await repository.saveRawCapture(
    createTestRawCapture(HASH_EXPIRED, "TABS2027001004", {
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
    createOrchestrationObservation("obs_1001_m1", "TABS2027001001", HASH_ACTIVE_A)
  );
  await repository.appendObservation(
    createOrchestrationObservation("obs_1002_r1", "TABS2027001002", HASH_ACTIVE_B, {
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
  overrides: Partial<GeneratedIllustration> &
    Pick<
      GeneratedIllustration,
      | "plateId"
      | "lineageId"
      | "projectNumbers"
      | "triggeringObservationIds"
      | "rawCaptureHashes"
      | "sha256"
    >
): Promise<void> {
  const webpBuf = createFixtureWebpBuffer(overrides.plateId);
  const isBranch = overrides.isBranch ?? false;
  await repository.saveGeneratedIllustration(
    GeneratedIllustrationSchema.parse({
      turnNumber: 1,
      model: PAINTER_AGENT_MODEL,
      interactionId: `ix_${overrides.plateId}`,
      parentInteractionId: null,
      parentPlateId: null,
      prompt: `Fixture prompt ${overrides.plateId}`,
      storageUri: `${ARTIFACT_BUCKET_URI}/illustrations/${overrides.plateId}.webp`,
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

export async function seedFiveCardOrchestrationRepository(): Promise<{
  repository: GridlockRepository;
  canonicalArtifactHash: string;
  branchPlateId: string;
}> {
  const repository = await seedFilingOrchestrationRepository();

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
      quarantinedArtifact: anomaly.rawCapture,
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
              `orchestration-plate-${painterSeq}`
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
  assert.equal(bootstrapRes.status, "illustration_painted");
  if (bootstrapRes.status !== "illustration_painted") {
    throw new Error("Expected illustration_painted for bootstrapCanvas");
  }

  const branchRes = await branchTimeline(
    {
      lineageId: DEFAULT_LINEAGE_ID,
      parentInteractionId: bootstrapRes.illustration.interactionId,
      scenarioPrompt: "Add 300MW switchyard for corridor_lead@example.com",
      now: new Date("2026-10-27T15:10:00.000Z"),
    },
    { repository, geminiClient: painterClient }
  );
  assert.equal(branchRes.status, "illustration_painted");
  if (branchRes.status !== "illustration_painted") {
    throw new Error("Expected illustration_painted for branchTimeline");
  }

  await saveTestVisualPlate(repository, {
    plateId: "plate_expired_branch",
    lineageId: DEFAULT_LINEAGE_ID,
    turnNumber: 2,
    parentInteractionId: bootstrapRes.illustration.interactionId,
    parentPlateId: bootstrapRes.illustration.plateId,
    projectNumbers: ["TABS2027001001"],
    triggeringObservationIds: ["obs_1001_m1"],
    rawCaptureHashes: [HASH_ACTIVE_A],
    storageUri: `${ARTIFACT_BUCKET_URI}/branches/ephemeral/plate_expired_branch.webp`,
    sha256: "9".repeat(64),
    isBranch: true,
    scenarioPrompt: "Expired scenario prompt",
    createdAt: "2026-07-01T10:00:00.000Z",
    expiresAt: "2026-09-29T10:00:00.000Z",
  });

  await repository.appendObservation(
    createOrchestrationObservation(
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
    rawCaptureHashes: [HASH_QUARANTINED],
    sha256: "e".repeat(64),
  });

  await repository.appendObservation(
    createOrchestrationObservation(
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
    rawCaptureHashes: [HASH_EXPIRED],
    sha256: "f".repeat(64),
  });

  return {
    repository,
    canonicalArtifactHash: HASH_ACTIVE_A,
    branchPlateId: branchRes.illustration.plateId,
  };
}

export function createFiveCardLayoutSpec(
  branchPlateId: string
): OrchestrationLayoutSpec {
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

export function streamOversizedJsonPost(
  baseUrl: string,
  pathname: string,
  chunkBytes: number,
  chunkCount: number
): Promise<{
  status: number | undefined;
  connection: string | string[] | undefined;
  error: unknown;
  message: unknown;
}> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out waiting for 400 response")),
      2000
    ).unref();

    const req = httpRequest(
      new URL(pathname, baseUrl),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on("end", () => {
          clearTimeout(timer);
          const parsed = JSON.parse(
            Buffer.concat(chunks).toString("utf-8")
          ) as { error: unknown; message: unknown };
          resolve({
            status: res.statusCode,
            connection: res.headers.connection,
            error: parsed.error,
            message: parsed.message,
          });
        });
      }
    );

    req.on("error", () => {});

    const chunk = Buffer.alloc(chunkBytes, 0x61);
    const writeNext = (remaining: number): void => {
      if (remaining === 0) {
        req.end();
        return;
      }
      if (!req.destroyed && !req.writableEnded) {
        req.write(chunk, () => writeNext(remaining - 1));
      }
    };
    writeNext(chunkCount);
  });
}
