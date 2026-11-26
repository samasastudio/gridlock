import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  DEFAULT_TIMELINE_ID,
  FrameTimelineNodeSchema,
  FrameTimelineResponseSchema,
  GeneratedIllustrationSchema,
  ObservationSchema,
  RawCaptureSchema,
  type FrameTimelineEdge,
  type FrameTimelineNode,
  type FrameTimelineResponse,
  type GeneratedIllustration,
  type GridlockRepository,
  type TimelineSourceCitation,
} from "../interfaces/index.ts";
import {
  compareIllustrationsChronologically,
  isGeneratedIllustrationActiveAt,
  selectActiveCanonicalIllustration,
} from "./helpers/painter-helpers.ts";
import { isWebpBuffer } from "./helpers/webp-codec.ts";

export interface GetFrameTimelineQuery {
  lineageId?: string;
  now?: Date;
}

export type GetFrameTimelineResult =
  | { ok: true; timeline: FrameTimelineResponse }
  | { ok: false; error: "frame_timeline_error"; message: string };

export type GetGeneratedIllustrationAssetResult =
  | { ok: true; plate: GeneratedIllustration; webpBuffer: Buffer }
  | { ok: false; error: "illustration_not_found" | "illustration_asset_error"; message: string };

type TimelineRepo = Pick<
  GridlockRepository,
  "listGeneratedIllustrationsByTimeline" | "listObservationsByProject" | "getRawCaptureByHash"
>;

const lineageErr = (message: string) => ({
  ok: false as const,
  error: "frame_timeline_error" as const,
  message,
});

const assetErr = (
  error: "illustration_not_found" | "illustration_asset_error",
  message: string
): GetGeneratedIllustrationAssetResult => ({ ok: false, error, message });

export async function hydrateTimelineNodes(
  plates: readonly GeneratedIllustration[],
  repository: Pick<
    GridlockRepository,
    "listObservationsByProject" | "getRawCaptureByHash"
  >,
  now: Date
): Promise<
  | { ok: true; nodes: FrameTimelineNode[] }
  | { ok: false; error: "frame_timeline_error"; message: string }
> {
  const uniqueProjects = Array.from(new Set(plates.flatMap((plate) => plate.projectNumbers)));
  const uniqueHashes = Array.from(new Set(plates.flatMap((plate) => plate.rawCaptureHashes)));

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
        raw: await repository.getRawCaptureByHash(sha256),
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
    .map(({ sha256, raw }) => ({ sha256, result: RawCaptureSchema.safeParse(raw) }));
  if (parsedArts.some(({ sha256, result }) => !result.success || result.data.sha256 !== sha256)) {
    return lineageErr("Stored RawCapture failed runtime schema validation");
  }

  const nowMs = now.getTime();
  const citations = new Map<string, TimelineSourceCitation>(
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
    const rawCaptures = Array.from(new Set(plate.rawCaptureHashes)).flatMap((hash) => {
      const citation = citations.get(hash);
      return citation ? [citation] : [];
    });
    return FrameTimelineNodeSchema.safeParse({
      plate,
      assetPath: `/api/illustrations/assets/${encodeURIComponent(plate.plateId)}.webp`,
      triggeringObservations,
      rawCaptures,
    });
  });

  if (parsedNodes.some((result) => !result.success)) {
    return lineageErr("Hydrated FrameTimelineNode failed runtime schema validation");
  }
  return {
    ok: true,
    nodes: parsedNodes.flatMap((result) => (result.success ? [result.data] : [])),
  };
}

export async function getFrameTimeline(
  query: GetFrameTimelineQuery,
  deps: { repository: TimelineRepo }
): Promise<GetFrameTimelineResult> {
  const lineageId = query.lineageId ?? DEFAULT_TIMELINE_ID;
  const now = query.now ?? new Date();
  try {
    const rawPlates = await deps.repository.listGeneratedIllustrationsByTimeline(lineageId);
    if (!Array.isArray(rawPlates)) {
      return lineageErr("Stored GeneratedIllustration list failed runtime schema validation");
    }

    const parsedPlates = rawPlates.map((plate) => GeneratedIllustrationSchema.safeParse(plate));
    if (
      parsedPlates.some((result) => !result.success || result.data.lineageId !== lineageId)
    ) {
      return lineageErr("Stored GeneratedIllustration record failed runtime schema validation");
    }

    const activePlates = parsedPlates
      .flatMap((result) => (result.success ? [result.data] : []))
      .filter((plate) => isGeneratedIllustrationActiveAt(plate, now))
      .sort(compareIllustrationsChronologically);
    if (activePlates.length === 0) {
      const empty = FrameTimelineResponseSchema.safeParse({
        lineageId,
        activeCanonicalPlateId: null,
        nodes: [],
        edges: [],
      });
      return empty.success
        ? { ok: true, timeline: empty.data }
        : lineageErr("Invalid frame timeline response envelope");
    }

    const hydrated = await hydrateTimelineNodes(activePlates, deps.repository, now);
    if (!hydrated.ok) {
      return hydrated;
    }

    const byInteraction = new Map(
      activePlates.map((plate) => [plate.interactionId, plate])
    );
    const edges: FrameTimelineEdge[] = activePlates.flatMap((child) => {
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

    const validated = FrameTimelineResponseSchema.safeParse({
      lineageId,
      activeCanonicalPlateId: selectActiveCanonicalIllustration(activePlates)?.plateId ?? null,
      nodes: hydrated.nodes,
      edges,
    });
    return validated.success
      ? { ok: true, timeline: validated.data }
      : lineageErr("Frame timeline response failed runtime schema validation");
  } catch (error) {
    return lineageErr(
      error instanceof Error ? error.message : "Failed to read GeneratedIllustration timeline"
    );
  }
}

export async function getGeneratedIllustrationAsset(
  input: { plateId: string; now?: Date },
  deps: { repository: Pick<GridlockRepository, "getGeneratedIllustrationById" | "readGeneratedIllustrationWebp"> }
): Promise<GetGeneratedIllustrationAssetResult> {
  const now = input.now ?? new Date();
  try {
    const plateCandidate = await deps.repository.getGeneratedIllustrationById(input.plateId);
    if (plateCandidate === null || plateCandidate === undefined) {
      return assetErr("illustration_not_found", `GeneratedIllustration "${input.plateId}" not found`);
    }

    const parsedPlate = GeneratedIllustrationSchema.safeParse(plateCandidate);
    if (!parsedPlate.success || parsedPlate.data.plateId !== input.plateId) {
      return assetErr(
        "illustration_asset_error",
        "Stored GeneratedIllustration metadata failed runtime schema validation"
      );
    }
    if (!isGeneratedIllustrationActiveAt(parsedPlate.data, now)) {
      return assetErr(
        "illustration_not_found",
        `GeneratedIllustration asset "${input.plateId}" not found or expired`
      );
    }

    const webpCandidate = await deps.repository.readGeneratedIllustrationWebp(input.plateId);
    if (webpCandidate === null || webpCandidate === undefined) {
      return assetErr(
        "illustration_not_found",
        `GeneratedIllustration asset "${input.plateId}" not found or expired`
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
        "illustration_asset_error",
        "Stored GeneratedIllustration WebP asset failed integrity verification"
      );
    }

    return { ok: true, plate: parsedPlate.data, webpBuffer: webpCandidate };
  } catch (error) {
    return assetErr(
      "illustration_asset_error",
      error instanceof Error ? error.message : "Failed to read GeneratedIllustration asset"
    );
  }
}
