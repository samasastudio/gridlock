import {
  ObservationSchema,
  ProjectSchema,
  SourceArtifactSchema,
  type HydrateWorkspaceErrorCode,
  type LineageSourceCitation,
  type Observation,
  type Project,
  type SourceArtifact,
} from "../../interfaces/index.ts";
import {
  sanitizeLocationAddressPii,
  sanitizeTextPii,
} from "./pii-sanitizer.ts";

export type HydratorStepFailure = {
  ok: false;
  error: HydrateWorkspaceErrorCode;
  message: string;
};

export function stepFailure(
  error: HydrateWorkspaceErrorCode,
  message: string
): HydratorStepFailure {
  return { ok: false, error, message };
}

const REDACTED_PLACEHOLDER_SPLIT = /(\[REDACTED_(?:ADDRESS|EMAIL|PHONE)\])/g;
const REDACTED_PLACEHOLDER_EXACT = /^\[REDACTED_(?:ADDRESS|EMAIL|PHONE)\]$/;

function escapeProseOutsidePlaceholders(value: string): string {
  return value
    .split(REDACTED_PLACEHOLDER_SPLIT)
    .map((segment, idx, segments) => {
      if (!REDACTED_PLACEHOLDER_EXACT.test(segment)) {
        return segment.replace(/[\\<>{}`*_~[\]]/g, "\\$&");
      }
      const prevText = segments.slice(0, idx).join("");
      const nextText = segments.slice(idx + 1).join("");
      const hasAdjacentLinkSyntax =
        prevText.endsWith("!") || /^[(:[]/.test(nextText);
      return hasAdjacentLinkSyntax
        ? segment.replace(/[\[\]]/g, "\\$&")
        : segment;
    })
    .join("");
}

export function sanitizeAstProse(raw: string): string {
  const singleLine = raw.replace(/\s*\r?\n\s*/g, " ").trim();
  return escapeProseOutsidePlaceholders(sanitizeTextPii(singleLine));
}

function sanitizeAstAddressProse(raw: string): string {
  const singleLine = raw.replace(/\s*\r?\n\s*/g, " ").trim();
  return escapeProseOutsidePlaceholders(sanitizeLocationAddressPii(singleLine));
}

function sanitizeProjectRecord(project: Project): Project {
  return {
    ...project,
    projectName: sanitizeAstProse(project.projectName),
    facilityName: sanitizeAstProse(project.facilityName),
    ownerName: sanitizeAstProse(project.ownerName),
    ...(project.designFirmName !== undefined
      ? { designFirmName: sanitizeAstProse(project.designFirmName) }
      : {}),
    locationAddress: sanitizeAstAddressProse(project.locationAddress),
    county: sanitizeAstProse(project.county),
    typeOfWork: sanitizeAstProse(project.typeOfWork),
    scopeOfWork: sanitizeAstProse(project.scopeOfWork),
    currentStatus: sanitizeAstProse(project.currentStatus),
  };
}

export function sanitizeObservationRecord(obs: Observation): Observation {
  return {
    ...obs,
    status: sanitizeAstProse(obs.status),
    scopeOfWork: sanitizeAstProse(obs.scopeOfWork),
  };
}

export function validateStoredProjects(
  entries: ReadonlyArray<{ projectNumber: string; raw: unknown }>
): { ok: true; projectsByNumber: Map<string, Project> } | HydratorStepFailure {
  const present = entries
    .filter((entry) => entry.raw !== null && entry.raw !== undefined)
    .map(({ projectNumber, raw }) => ({
      projectNumber,
      parsed: ProjectSchema.safeParse(raw),
    }));

  const corrupted = present.find(
    ({ projectNumber, parsed }) =>
      !parsed.success || parsed.data.projectNumber !== projectNumber
  );
  if (corrupted) {
    return stepFailure(
      "repository_integrity_error",
      `Stored Project "${corrupted.projectNumber}" failed runtime schema validation`
    );
  }

  const missing = entries.find(
    (entry) => entry.raw === null || entry.raw === undefined
  );
  if (missing) {
    return stepFailure(
      "entity_not_found",
      `Project "${missing.projectNumber}" was not found in GridlockRepository`
    );
  }

  const sanitized = present.flatMap(({ projectNumber, parsed }) =>
    parsed.success
      ? [
          {
            projectNumber,
            reParsed: ProjectSchema.safeParse(
              sanitizeProjectRecord(parsed.data)
            ),
          },
        ]
      : []
  );

  const invalidSanitized = sanitized.find(({ reParsed }) => !reParsed.success);
  if (invalidSanitized) {
    return stepFailure(
      "repository_integrity_error",
      `Sanitized Project "${invalidSanitized.projectNumber}" failed runtime schema validation`
    );
  }

  return {
    ok: true,
    projectsByNumber: new Map(
      sanitized.flatMap(({ projectNumber, reParsed }) =>
        reParsed.success ? [[projectNumber, reParsed.data] as const] : []
      )
    ),
  };
}

export function validateStoredObservationsByProject(
  entries: ReadonlyArray<{ projectNumber: string; raw: unknown }>
):
  | { ok: true; observationsByProject: Map<string, Observation[]> }
  | HydratorStepFailure {
  const outcomes = entries.map(({ projectNumber, raw }) => {
    if (!Array.isArray(raw)) {
      return stepFailure(
        "repository_integrity_error",
        `Stored Observations for "${projectNumber}" failed runtime schema validation`
      );
    }
    const parsedItems = raw.map((item: unknown) => ObservationSchema.safeParse(item));
    const hasInvalidItem = parsedItems.some(
      (parsed) => !parsed.success || parsed.data.projectNumber !== projectNumber
    );
    if (hasInvalidItem) {
      return stepFailure(
        "repository_integrity_error",
        `Stored Observation for "${projectNumber}" failed runtime schema validation`
      );
    }
    const sanitizedItems = parsedItems.flatMap((parsed) =>
      parsed.success
        ? [ObservationSchema.safeParse(sanitizeObservationRecord(parsed.data))]
        : []
    );
    if (sanitizedItems.some((reParsed) => !reParsed.success)) {
      return stepFailure(
        "repository_integrity_error",
        `Sanitized Observation for "${projectNumber}" failed runtime schema validation`
      );
    }
    return {
      ok: true as const,
      projectNumber,
      observations: sanitizedItems.flatMap((reParsed) =>
        reParsed.success ? [reParsed.data] : []
      ),
    };
  });

  const failure = outcomes.find((outcome) => !outcome.ok);
  if (failure && !failure.ok) {
    return failure;
  }

  return {
    ok: true,
    observationsByProject: new Map(
      outcomes.flatMap((outcome) =>
        outcome.ok
          ? [[outcome.projectNumber, outcome.observations] as const]
          : []
      )
    ),
  };
}

export function validateStoredArtifacts(
  entries: ReadonlyArray<{ sha256: string; raw: unknown }>
):
  | { ok: true; artifactsByHash: Map<string, SourceArtifact | null> }
  | HydratorStepFailure {
  const checked = entries.map(({ sha256, raw }) =>
    raw === null || raw === undefined
      ? ({ sha256, parsed: null })
      : ({ sha256, parsed: SourceArtifactSchema.safeParse(raw) })
  );

  const corrupted = checked.find(
    ({ sha256, parsed }) =>
      parsed !== null && (!parsed.success || parsed.data.sha256 !== sha256)
  );
  if (corrupted) {
    return stepFailure(
      "repository_integrity_error",
      `Stored Source Artifact "${corrupted.sha256}" failed runtime schema validation`
    );
  }

  return {
    ok: true,
    artifactsByHash: new Map(
      checked.map(({ sha256, parsed }) => [
        sha256,
        parsed !== null && parsed.success ? parsed.data : null,
      ])
    ),
  };
}

export function resolveLiveCitation(
  sha256: string,
  artifactsByHash: ReadonlyMap<string, SourceArtifact | null>,
  nowMs: number
):
  | { ok: true; citation: LineageSourceCitation }
  | {
      ok: false;
      reason: "missing" | "quarantined" | "invalid_url" | "expired";
      message: string;
    } {
  const artifact = artifactsByHash.get(sha256) ?? null;
  if (artifact === null) {
    return {
      ok: false,
      reason: "missing",
      message: `Source Artifact "${sha256}" was not found in GridlockRepository`,
    };
  }
  if (artifact.storageUri.includes("/quarantine/")) {
    return {
      ok: false,
      reason: "quarantined",
      message: `Source Artifact "${sha256}" is quarantined and cannot back a UI AST citation`,
    };
  }
  if (!/^https?:\/\//i.test(artifact.sourceUrl)) {
    return {
      ok: false,
      reason: "invalid_url",
      message: `Source Artifact "${sha256}" must use an http:// or https:// sourceUrl`,
    };
  }
  if (artifact.expiresAt !== null && Date.parse(artifact.expiresAt) <= nowMs) {
    return {
      ok: false,
      reason: "expired",
      message: `Source Artifact "${sha256}" has expired and cannot back a required UI AST citation`,
    };
  }
  return {
    ok: true,
    citation: {
      sha256: artifact.sha256,
      sourceUrl: artifact.sourceUrl,
      connectorId: artifact.connectorId,
      capturedAt: artifact.capturedAt,
      referencedByMilestone: artifact.referencedByMilestone,
    },
  };
}
