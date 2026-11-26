import {
  CONNECTOR_HEALTH_RECENT_RUNS_LIMIT,
  ConnectorHealthCardNodeSchema,
  FrameTimelineScrubberNodeSchema,
  MAX_SCENARIO_PROMPT_LENGTH,
  type CitedProject,
  type ConnectorHealthCardNode,
  type EfficiencyScorecard,
  type FrameTimelineNode,
  type FrameTimelineResponse,
  type FrameTimelineScrubberNode,
  type Observation,
  type OrchestrationNodeSpec,
  type RepairChangelogResponse,
  type RawCapture,
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
  uniqueTimelineIds: string[];
  uniqueConnectorIds: string[];
}

export interface WorkspaceNodeHydrationContext {
  citedByNumber: ReadonlyMap<string, CitedProject>;
  observationsByProject: ReadonlyMap<string, Observation[]>;
  artifactsByHash: ReadonlyMap<string, RawCapture | null>;
  timelineById: ReadonlyMap<string, FrameTimelineResponse>;
  changelogByConnector: ReadonlyMap<string, RepairChangelogResponse>;
  compactScorecard: EfficiencyScorecard | null;
  nowMs: number;
}

export function extractWorkspaceLookupKeys(
  nodes: readonly OrchestrationNodeSpec[]
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
          case "FrameTimelineScrubber":
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

  const uniqueTimelineIds = Array.from(
    new Set(
      nodes.flatMap((node) =>
        node.component === "FrameTimelineScrubber" ? [node.lineageId] : []
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
    uniqueTimelineIds,
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

function sanitizeTimelineNode(node: FrameTimelineNode): FrameTimelineNode {
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

function buildFrameTimelineScrubberNode(
  nodeId: string,
  timeline: FrameTimelineResponse,
  initialPlateId?: string
): { ok: true; node: FrameTimelineScrubberNode } | HydratorStepFailure {
  if (timeline.nodes.length === 0) {
    return stepFailure(
      "entity_not_found",
      `Frame Timeline "${timeline.lineageId}" has no active illustrations`
    );
  }

  if (
    initialPlateId !== undefined &&
    !timeline.nodes.some((node) => node.plate.plateId === initialPlateId)
  ) {
    return stepFailure(
      "entity_not_found",
      `Generated Illustration "${initialPlateId}" was not found in active timeline "${timeline.lineageId}"`
    );
  }

  const unresolvableNode = timeline.nodes.find((node) => {
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
      `Generated Illustration "${unresolvableNode.plate.plateId}" in timeline "${timeline.lineageId}" lacks resolvable Raw Capture provenance`
    );
  }

  const parsedNode = FrameTimelineScrubberNodeSchema.safeParse({
    nodeId,
    component: "FrameTimelineScrubber",
    timeline: {
      ...timeline,
      nodes: timeline.nodes.map(sanitizeTimelineNode),
    },
    ...(initialPlateId !== undefined ? { initialPlateId } : {}),
  });
  if (!parsedNode.success) {
    return stepFailure(
      "repository_integrity_error",
      `FrameTimelineScrubberNode "${nodeId}" failed runtime schema validation`
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
  specNodes: readonly OrchestrationNodeSpec[],
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
      case "FrameTimelineScrubber": {
        const timeline = ctx.timelineById.get(specNode.lineageId);
        return timeline
          ? buildFrameTimelineScrubberNode(
              specNode.nodeId,
              timeline,
              specNode.initialPlateId
            )
          : stepFailure(
              "entity_not_found",
              `Frame Timeline "${specNode.lineageId}" was not found`
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
