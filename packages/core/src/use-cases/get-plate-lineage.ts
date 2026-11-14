import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  DEFAULT_LINEAGE_ID,
  LineageNodeSchema,
  ObservationSchema,
  PlateLineageResponseSchema,
  SourceArtifactSchema,
  VisualPlateSchema,
  type GridlockRepository,
  type LineageEdge,
  type LineageNode,
  type LineageSourceCitation,
  type PlateLineageResponse,
  type VisualPlate,
} from "../interfaces/index.ts";
import {
  comparePlatesChronologically,
  isVisualPlateActiveAt,
  selectActiveCanonicalPlate,
} from "./helpers/painter-helpers.ts";
import { isWebpBuffer } from "./helpers/webp-codec.ts";

export interface GetPlateLineageQuery {
  lineageId?: string;
  now?: Date;
}

export type GetPlateLineageResult =
  | { ok: true; lineage: PlateLineageResponse }
  | { ok: false; error: "plate_lineage_error"; message: string };

export type GetVisualPlateAssetResult =
  | { ok: true; plate: VisualPlate; webpBuffer: Buffer }
  | { ok: false; error: "plate_not_found" | "plate_asset_error"; message: string };

type LineageRepo = Pick<
  GridlockRepository,
  "listVisualPlatesByLineage" | "listObservationsByProject" | "getSourceArtifactByHash"
>;

const lineageErr = (message: string) => ({
  ok: false as const,
  error: "plate_lineage_error" as const,
  message,
});

const assetErr = (
  error: "plate_not_found" | "plate_asset_error",
  message: string
): GetVisualPlateAssetResult => ({ ok: false, error, message });

async function hydrateLineageNodes(
  plates: readonly VisualPlate[],
  repository: Pick<
    GridlockRepository,
    "listObservationsByProject" | "getSourceArtifactByHash"
  >,
  now: Date
): Promise<
  | { ok: true; nodes: LineageNode[] }
  | { ok: false; error: "plate_lineage_error"; message: string }
> {
  const uniqueProjects = Array.from(new Set(plates.flatMap((plate) => plate.projectNumbers)));
  const uniqueHashes = Array.from(new Set(plates.flatMap((plate) => plate.sourceArtifactHashes)));

  const [obsLists, rawArtifacts] = await Promise.all([
    Promise.all(
      uniqueProjects.map(async (projectNumber) => ({
        projectNumber,
        raw: await repository.listObservationsByProject(projectNumber),
      }))
    ),
    Promise.all(
      uniqueHashes.map(async (sha256) => ({
        sha256,
        raw: await repository.getSourceArtifactByHash(sha256),
      }))
    ),
  ]);

  const parsedObs = obsLists.map(({ projectNumber, raw }) =>
    Array.isArray(raw)
      ? raw.map((obs) => ({ projectNumber, result: ObservationSchema.safeParse(obs) }))
      : null
  );
  const hasInvalidObs = parsedObs.some(
    (group) =>
      group === null ||
      group.some(
        ({ projectNumber, result }) =>
          !result.success || result.data.projectNumber !== projectNumber
      )
  );
  if (hasInvalidObs) {
    return lineageErr("Stored Observation record failed runtime schema validation");
  }

  const obsById = new Map(
    parsedObs.flatMap((group) =>
      (group ?? []).flatMap(({ result }) =>
        result.success ? [[result.data.id, result.data] as const] : []
      )
    )
  );

  const parsedArts = rawArtifacts
    .filter((entry) => entry.raw !== null && entry.raw !== undefined)
    .map(({ sha256, raw }) => ({ sha256, result: SourceArtifactSchema.safeParse(raw) }));
  if (parsedArts.some(({ sha256, result }) => !result.success || result.data.sha256 !== sha256)) {
    return lineageErr("Stored SourceArtifact failed runtime schema validation");
  }

  const nowMs = now.getTime();
  const citations = new Map<string, LineageSourceCitation>(
    parsedArts.flatMap(({ result }) => {
      if (!result.success) {
        return [];
      }
      const art = result.data;
      const isExpired = art.expiresAt !== null && Date.parse(art.expiresAt) <= nowMs;
      if (isExpired || art.storageUri.includes("/quarantine/")) {
        return [];
      }
      const { sha256, sourceUrl, connectorId, capturedAt, referencedByMilestone } = art;
      return [[sha256, { sha256, sourceUrl, connectorId, capturedAt, referencedByMilestone }]];
    })
  );

  const parsedNodes = plates.map((plate) => {
    const projectSet = new Set(plate.projectNumbers);
    const triggeringObservations = Array.from(
      new Set(plate.triggeringObservationIds)
    ).flatMap((id) => {
      const obs = obsById.get(id);
      return obs && projectSet.has(obs.projectNumber) ? [obs] : [];
    });
    const sourceArtifacts = Array.from(new Set(plate.sourceArtifactHashes)).flatMap((hash) => {
      const citation = citations.get(hash);
      return citation ? [citation] : [];
    });
    return LineageNodeSchema.safeParse({
      plate,
      assetPath: `/api/plates/assets/${encodeURIComponent(plate.plateId)}.webp`,
      triggeringObservations,
      sourceArtifacts,
    });
  });

  if (parsedNodes.some((result) => !result.success)) {
    return lineageErr("Hydrated LineageNode failed runtime schema validation");
  }
  return {
    ok: true,
    nodes: parsedNodes.flatMap((result) => (result.success ? [result.data] : [])),
  };
}

export async function getPlateLineage(
  query: GetPlateLineageQuery,
  deps: { repository: LineageRepo }
): Promise<GetPlateLineageResult> {
  const lineageId = query.lineageId ?? DEFAULT_LINEAGE_ID;
  const now = query.now ?? new Date();
  try {
    const rawPlates = await deps.repository.listVisualPlatesByLineage(lineageId);
    if (!Array.isArray(rawPlates)) {
      return lineageErr("Stored VisualPlate list failed runtime schema validation");
    }

    const parsedPlates = rawPlates.map((plate) => VisualPlateSchema.safeParse(plate));
    if (
      parsedPlates.some((result) => !result.success || result.data.lineageId !== lineageId)
    ) {
      return lineageErr("Stored VisualPlate record failed runtime schema validation");
    }

    const activePlates = parsedPlates
      .flatMap((result) => (result.success ? [result.data] : []))
      .filter((plate) => isVisualPlateActiveAt(plate, now))
      .sort(comparePlatesChronologically);
    if (activePlates.length === 0) {
      const empty = PlateLineageResponseSchema.safeParse({
        lineageId,
        activeCanonicalPlateId: null,
        nodes: [],
        edges: [],
      });
      return empty.success
        ? { ok: true, lineage: empty.data }
        : lineageErr("Invalid lineage response envelope");
    }

    const hydrated = await hydrateLineageNodes(activePlates, deps.repository, now);
    if (!hydrated.ok) {
      return hydrated;
    }

    const byInteraction = new Map(
      activePlates.map((plate) => [plate.interactionId, plate])
    );
    const edges: LineageEdge[] = activePlates.flatMap((child) => {
      const parent = child.parentInteractionId
        ? byInteraction.get(child.parentInteractionId)
        : undefined;
      if (!parent) {
        return [];
      }
      return [
        {
          parentInteractionId: parent.interactionId,
          childInteractionId: child.interactionId,
          parentPlateId: parent.plateId,
          childPlateId: child.plateId,
          isBranch: child.isBranch,
        },
      ];
    });

    const validated = PlateLineageResponseSchema.safeParse({
      lineageId,
      activeCanonicalPlateId: selectActiveCanonicalPlate(activePlates)?.plateId ?? null,
      nodes: hydrated.nodes,
      edges,
    });
    return validated.success
      ? { ok: true, lineage: validated.data }
      : lineageErr("Lineage response failed runtime schema validation");
  } catch (error) {
    return lineageErr(
      error instanceof Error ? error.message : "Failed to read VisualPlate lineage"
    );
  }
}

export async function getVisualPlateAsset(
  input: { plateId: string; now?: Date },
  deps: { repository: Pick<GridlockRepository, "getVisualPlateById" | "readVisualPlateWebp"> }
): Promise<GetVisualPlateAssetResult> {
  const now = input.now ?? new Date();
  try {
    const plateCandidate = await deps.repository.getVisualPlateById(input.plateId);
    if (plateCandidate === null || plateCandidate === undefined) {
      return assetErr("plate_not_found", `VisualPlate "${input.plateId}" not found`);
    }

    const parsedPlate = VisualPlateSchema.safeParse(plateCandidate);
    if (!parsedPlate.success || parsedPlate.data.plateId !== input.plateId) {
      return assetErr(
        "plate_asset_error",
        "Stored VisualPlate metadata failed runtime schema validation"
      );
    }
    if (!isVisualPlateActiveAt(parsedPlate.data, now)) {
      return assetErr(
        "plate_not_found",
        `VisualPlate asset "${input.plateId}" not found or expired`
      );
    }

    const webpCandidate = await deps.repository.readVisualPlateWebp(input.plateId);
    if (webpCandidate === null || webpCandidate === undefined) {
      return assetErr(
        "plate_not_found",
        `VisualPlate asset "${input.plateId}" not found or expired`
      );
    }

    const actualSha = Buffer.isBuffer(webpCandidate)
      ? createHash("sha256").update(webpCandidate).digest("hex")
      : "";
    const isIntegrityValid =
      Buffer.isBuffer(webpCandidate) &&
      webpCandidate.byteLength === parsedPlate.data.byteLength &&
      isWebpBuffer(webpCandidate) &&
      actualSha === parsedPlate.data.sha256;
    if (!isIntegrityValid) {
      return assetErr(
        "plate_asset_error",
        "Stored VisualPlate WebP asset failed integrity verification"
      );
    }

    return { ok: true, plate: parsedPlate.data, webpBuffer: webpCandidate };
  } catch (error) {
    return assetErr(
      "plate_asset_error",
      error instanceof Error ? error.message : "Failed to read VisualPlate asset"
    );
  }
}
