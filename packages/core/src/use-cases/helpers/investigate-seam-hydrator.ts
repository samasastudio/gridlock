import {
  CONNECTOR_HEALTH_RECENT_RUNS_LIMIT,
  ConnectorHealthCardNodeSchema,
  MAX_SCENARIO_PROMPT_LENGTH,
  VisualPlateScrubberNodeSchema,
  type CitedProject,
  type ConnectorHealthCardNode,
  type EfficiencyScorecard,
  type LineageNode,
  type Observation,
  type PlannerNodeSpec,
  type PlateLineageResponse,
  type RepairChangelogResponse,
  type RawCapture,
  type VisualPlateScrubberNode,
  type WorkspaceCardNode,
} from "../../interfaces/index.ts";
import {
  buildMetricComparisonTableNode,
  buildObservationTimelineNode,
  buildProjectDossierCardNode,
} from "./investigate-hydrator.ts";
import {
  sanitizeObservationRecord,
  sanitizeWorkspaceProse,
  stepFailure,
  type HydratorStepFailure,
} from "./investigate-provenance.ts";

export interface WorkspaceLookupKeys {
  uniqueProjectNumbers: string[];
  uniqueCitedProjectNumbers: string[];
  uniqueTimelineProjectNumbers: string[];
  uniqueLineageIds: string[];
  uniqueConnectorIds: string[];
}

export interface WorkspaceNodeHydrationContext {
  citedByNumber: ReadonlyMap<string, CitedProject>;
  observationsByProject: ReadonlyMap<string, Observation[]>;
  artifactsByHash: ReadonlyMap<string, RawCapture | null>;
  lineageById: ReadonlyMap<string, PlateLineageResponse>;
  changelogByConnector: ReadonlyMap<string, RepairChangelogResponse>;
  compactScorecard: EfficiencyScorecard | null;
  nowMs: number;
}

export function extractWorkspaceLookupKeys(
  nodes: readonly PlannerNodeSpec[]
): WorkspaceLookupKeys {
  const uniqueCitedProjectNumbers = Array.from(
    new Set(
      nodes.flatMap((node) => {
        switch (node.component) {
          case "ProjectDossierCard":
            return [node.projectNumber];
          case "MetricComparisonTable":
            return node.projectNumbers;
          case "ObservationTimeline":
          case "VisualPlateScrubber":
          case "ConnectorHealthCard":
            return [];
        }
      })
    )
  );

  const uniqueTimelineProjectNumbers = Array.from(
    new Set(
      nodes.flatMap((node) =>
        node.component === "ObservationTimeline" ? node.projectNumbers : []
      )
    )
  );

  const uniqueProjectNumbers = Array.from(
    new Set([...uniqueCitedProjectNumbers, ...uniqueTimelineProjectNumbers])
  );

  const uniqueLineageIds = Array.from(
    new Set(
      nodes.flatMap((node) =>
        node.component === "VisualPlateScrubber" ? [node.lineageId] : []
      )
    )
  );

  const uniqueConnectorIds = Array.from(
    new Set(
      nodes.flatMap((node) =>
        node.component === "ConnectorHealthCard" ? [node.connectorId] : []
      )
    )
  );

  return {
    uniqueProjectNumbers,
    uniqueCitedProjectNumbers,
    uniqueTimelineProjectNumbers,
    uniqueLineageIds,
    uniqueConnectorIds,
  };
}

function sanitizeScenarioPrompt(raw: string): string {
  const escaped = sanitizeWorkspaceProse(raw);
  if (escaped.length <= MAX_SCENARIO_PROMPT_LENGTH) {
    return escaped;
  }
  const sliced = escaped.slice(0, MAX_SCENARIO_PROMPT_LENGTH - 3);
  const trailingBackslashes = sliced.match(/\\+$/)?.[0].length ?? 0;
  const safePrefix =
    trailingBackslashes % 2 === 1 ? sliced.slice(0, -1) : sliced;
  return `${safePrefix}...`;
}

function sanitizeLineageNode(node: LineageNode): LineageNode {
  return {
    ...node,
    plate: {
      ...node.plate,
      prompt: sanitizeWorkspaceProse(node.plate.prompt),
      ...(node.plate.scenarioPrompt !== undefined
        ? { scenarioPrompt: sanitizeScenarioPrompt(node.plate.scenarioPrompt) }
        : {}),
    },
    triggeringObservations: node.triggeringObservations.map(
      sanitizeObservationRecord
    ),
  };
}

function buildVisualPlateScrubberNode(
  nodeId: string,
  lineage: PlateLineageResponse,
  initialPlateId?: string
): { ok: true; node: VisualPlateScrubberNode } | HydratorStepFailure {
  if (lineage.nodes.length === 0) {
    return stepFailure(
      "entity_not_found",
      `Visual Plate lineage "${lineage.lineageId}" has no active plates`
    );
  }

  if (
    initialPlateId !== undefined &&
    !lineage.nodes.some((node) => node.plate.plateId === initialPlateId)
  ) {
    return stepFailure(
      "entity_not_found",
      `Visual Plate "${initialPlateId}" was not found in active lineage "${lineage.lineageId}"`
    );
  }

  const unresolvableNode = lineage.nodes.find((node) => {
    const hasInvalidUrl = node.rawCaptures.some(
      (art) => !/^https?:\/\//i.test(art.sourceUrl)
    );
    const expectedCitationCount = new Set(node.plate.rawCaptureHashes).size;
    const expectedObservationCount = new Set(
      node.plate.triggeringObservationIds
    ).size;
    return (
      expectedCitationCount === 0 ||
      hasInvalidUrl ||
      node.rawCaptures.length !== expectedCitationCount ||
      node.triggeringObservations.length !== expectedObservationCount
    );
  });

  if (unresolvableNode) {
    return stepFailure(
      "unresolvable_provenance",
      `Visual Plate "${unresolvableNode.plate.plateId}" in lineage "${lineage.lineageId}" lacks resolvable Raw Capture provenance`
    );
  }

  const parsedNode = VisualPlateScrubberNodeSchema.safeParse({
    nodeId,
    component: "VisualPlateScrubber",
    lineage: {
      ...lineage,
      nodes: lineage.nodes.map(sanitizeLineageNode),
    },
    ...(initialPlateId !== undefined ? { initialPlateId } : {}),
  });
  if (!parsedNode.success) {
    return stepFailure(
      "repository_integrity_error",
      `VisualPlateScrubberNode "${nodeId}" failed runtime schema validation`
    );
  }

  return { ok: true, node: parsedNode.data };
}

function buildConnectorHealthCardNode(
  nodeId: string,
  changelog: RepairChangelogResponse,
  scorecard: EfficiencyScorecard
): { ok: true; node: ConnectorHealthCardNode } | HydratorStepFailure {
  const sanitizedChangelog: RepairChangelogResponse = {
    ...changelog,
    entries: changelog.entries.map((entry) => ({
      ...entry,
      rootCauseSummary: sanitizeWorkspaceProse(entry.rootCauseSummary),
      brokenInvariants: entry.brokenInvariants.map(sanitizeWorkspaceProse),
    })),
  };

  const parsedNode = ConnectorHealthCardNodeSchema.safeParse({
    nodeId,
    component: "ConnectorHealthCard",
    changelog: sanitizedChangelog,
    scorecard: {
      ...scorecard,
      recentRuns: scorecard.recentRuns.slice(
        -CONNECTOR_HEALTH_RECENT_RUNS_LIMIT
      ),
    },
  });
  if (!parsedNode.success) {
    return stepFailure(
      "repository_integrity_error",
      `ConnectorHealthCardNode "${nodeId}" failed runtime schema validation`
    );
  }

  return { ok: true, node: parsedNode.data };
}

export function hydrateWorkspaceNodes(
  specNodes: readonly PlannerNodeSpec[],
  ctx: WorkspaceNodeHydrationContext
): { ok: true; nodes: WorkspaceCardNode[] } | HydratorStepFailure {
  const nodeResults = specNodes.map((specNode) => {
    switch (specNode.component) {
      case "ProjectDossierCard":
        return buildProjectDossierCardNode(
          specNode.nodeId,
          specNode.projectNumber,
          ctx.citedByNumber
        );
      case "VisualPlateScrubber": {
        const lineage = ctx.lineageById.get(specNode.lineageId);
        return lineage
          ? buildVisualPlateScrubberNode(
              specNode.nodeId,
              lineage,
              specNode.initialPlateId
            )
          : stepFailure(
              "entity_not_found",
              `Visual Plate lineage "${specNode.lineageId}" was not found`
            );
      }
      case "ObservationTimeline":
        return buildObservationTimelineNode(
          specNode.nodeId,
          specNode.projectNumbers,
          ctx.observationsByProject,
          ctx.artifactsByHash,
          ctx.nowMs
        );
      case "MetricComparisonTable":
        return buildMetricComparisonTableNode(
          specNode.nodeId,
          specNode.projectNumbers,
          ctx.citedByNumber
        );
      case "ConnectorHealthCard": {
        const changelog = ctx.changelogByConnector.get(specNode.connectorId);
        return changelog && ctx.compactScorecard
          ? buildConnectorHealthCardNode(
              specNode.nodeId,
              changelog,
              ctx.compactScorecard
            )
          : stepFailure(
              "entity_not_found",
              `Connector "${specNode.connectorId}" was not found`
            );
      }
    }
  });

  const firstFailure = nodeResults.find((result) => !result.ok);
  if (firstFailure && !firstFailure.ok) {
    return firstFailure;
  }

  return {
    ok: true,
    nodes: nodeResults.flatMap((result) => (result.ok ? [result.node] : [])),
  };
}
