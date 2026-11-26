import type {
  BranchIllustrationResponse,
  FrameTimelineEdge,
  FrameTimelineNode,
  FrameTimelineResponse,
  TimelineSourceCitation,
} from "@samasastudio/gridlock-core/schemas";

export interface FrameTimelineKpis {
  canonicalMilestonesCount: number;
  scenarioBranchesCount: number;
  linkedFilingsCount: number;
}

export function orderTimelineNodes(nodes: readonly FrameTimelineNode[]): FrameTimelineNode[] {
  return [...nodes].sort((left, right) => {
    const turnDiff = left.plate.turnNumber - right.plate.turnNumber;
    if (turnDiff !== 0) return turnDiff;

    const branchDiff = Number(left.plate.isBranch) - Number(right.plate.isBranch);
    if (branchDiff !== 0) return branchDiff;

    const leftEpochMs = Date.parse(left.plate.createdAt);
    const rightEpochMs = Date.parse(right.plate.createdAt);
    if (Number.isFinite(leftEpochMs) && Number.isFinite(rightEpochMs) && leftEpochMs !== rightEpochMs) {
      return leftEpochMs - rightEpochMs;
    }

    const createdDiff = left.plate.createdAt.localeCompare(right.plate.createdAt);
    if (createdDiff !== 0) return createdDiff;

    return left.plate.illustrationId.localeCompare(right.plate.illustrationId);
  });
}

export function resolveStageActiveNode(
  orderedNodes: readonly FrameTimelineNode[],
  activeIllustrationId?: string | null
): FrameTimelineNode | undefined {
  if (orderedNodes.length === 0) {
    return undefined;
  }

  if (activeIllustrationId) {
    const matched = orderedNodes.find((node) => node.plate.illustrationId === activeIllustrationId);
    if (matched) {
      return matched;
    }
  }

  const latestCanonical = orderedNodes
    .filter((node) => !node.plate.isBranch)
    .at(-1);

  return latestCanonical ?? orderedNodes.at(-1);
}

function toTurnGroupKey(node: FrameTimelineNode): string {
  return `${node.plate.turnNumber}:${node.plate.isBranch ? "branch" : "canonical"}`;
}

function formatTurnLabel(
  turnNumber: number,
  isBranch: boolean,
  ordinal: number,
  total: number
): string {
  if (isBranch) {
    return total > 1 ? `Branch ${ordinal} · Turn ${turnNumber}` : `Branch · Turn ${turnNumber}`;
  }

  return total > 1 ? `Turn ${turnNumber} (${ordinal})` : `Turn ${turnNumber}`;
}

export function buildTimelineTurnLabels(
  orderedNodes: readonly FrameTimelineNode[]
): ReadonlyMap<string, string> {
  const groupCounts = orderedNodes.reduce<ReadonlyMap<string, number>>((counts, node) => {
    const key = toTurnGroupKey(node);
    return new Map([...counts, [key, (counts.get(key) ?? 0) + 1]]);
  }, new Map());

  const { entries } = orderedNodes.reduce<{
    readonly seen: ReadonlyMap<string, number>;
    readonly entries: readonly (readonly [string, string])[];
  }>(
    (acc, node) => {
      const { illustrationId, turnNumber, isBranch } = node.plate;
      const key = toTurnGroupKey(node);
      const total = groupCounts.get(key) ?? 1;
      const ordinal = (acc.seen.get(key) ?? 0) + 1;
      const label = formatTurnLabel(turnNumber, isBranch, ordinal, total);

      return {
        seen: new Map([...acc.seen, [key, ordinal]]),
        entries: [...acc.entries, [illustrationId, label] as const],
      };
    },
    { seen: new Map(), entries: [] }
  );

  return new Map(entries);
}

export function computeFrameTimelineKpis(timeline: FrameTimelineResponse): FrameTimelineKpis {
  const canonicalMilestonesCount = timeline.nodes.filter((node) => !node.plate.isBranch).length;
  const scenarioBranchesCount = timeline.nodes.length - canonicalMilestonesCount;
  const linkedFilingsCount = new Set(timeline.nodes.flatMap((node) => node.plate.projectNumbers)).size;

  return { canonicalMilestonesCount, scenarioBranchesCount, linkedFilingsCount };
}

export function resolveActiveTimelineNode(options: {
  orderedNodes: readonly FrameTimelineNode[];
  activeCanonicalIllustrationId: string | null;
  selectedIllustrationId?: string | null;
  initialIllustrationId?: string | null;
}): FrameTimelineNode | undefined {
  const { orderedNodes, activeCanonicalIllustrationId, selectedIllustrationId, initialIllustrationId } = options;
  if (orderedNodes.length === 0) {
    return undefined;
  }

  const byIllustrationId = new Map(orderedNodes.map((node) => [node.plate.illustrationId, node]));
  const matchedCandidateId = [selectedIllustrationId, initialIllustrationId, activeCanonicalIllustrationId].find(
    (candidateId): candidateId is string => Boolean(candidateId && byIllustrationId.has(candidateId))
  );

  if (matchedCandidateId) {
    return byIllustrationId.get(matchedCandidateId);
  }

  return resolveStageActiveNode(orderedNodes);
}

export type ResolvedTimelineCitation =
  | ({ kind: "hydrated" } & TimelineSourceCitation)
  | { kind: "hash_only_ttl_aged"; sha256: string };

export interface ProvenanceHop {
  interactionId: string;
  parentInteractionId: string | null;
  illustrationId: string | null;
  turnNumber: number | null;
  isBranch: boolean;
  isActiveTarget: boolean;
  isAgedOutParent: boolean;
  rebootstrappedFromParentWebp: boolean;
}

export function resolveNodeSourceCitations(node: FrameTimelineNode): ResolvedTimelineCitation[] {
  const hydratedByHash = new Map(node.rawCaptures.map((art) => [art.sha256, art]));

  return Array.from(new Set(node.plate.rawCaptureHashes), (sha256) => {
    const hydrated = hydratedByHash.get(sha256);
    return hydrated ? { kind: "hydrated", ...hydrated } : { kind: "hash_only_ttl_aged", sha256 };
  });
}

export function buildAncestorProvenanceChain(
  timeline: FrameTimelineResponse,
  activeNode: FrameTimelineNode
): ProvenanceHop[] {
  const byInteraction = new Map(timeline.nodes.map((node) => [node.plate.interactionId, node]));
  const edgeByChild = new Map(timeline.edges.map((edge) => [edge.childInteractionId, edge]));

  const walkAncestors = (
    current: FrameTimelineNode,
    visited: ReadonlySet<string>
  ): ProvenanceHop[] => {
    if (visited.has(current.plate.interactionId)) {
      return [];
    }

    const nextVisited = new Set([...visited, current.plate.interactionId]);
    const parentInteractionId =
      edgeByChild.get(current.plate.interactionId)?.parentInteractionId ??
      current.plate.parentInteractionId;

    const currentHop: ProvenanceHop = {
      interactionId: current.plate.interactionId,
      parentInteractionId,
      illustrationId: current.plate.illustrationId,
      turnNumber: current.plate.turnNumber,
      isBranch: current.plate.isBranch,
      isActiveTarget: current.plate.illustrationId === activeNode.plate.illustrationId,
      isAgedOutParent: false,
      rebootstrappedFromParentWebp: current.plate.rebootstrappedFromParentWebp,
    };

    if (!parentInteractionId || nextVisited.has(parentInteractionId)) {
      return [currentHop];
    }

    const parentNode = byInteraction.get(parentInteractionId);
    if (!parentNode) {
      const agedOutParentHop: ProvenanceHop = {
        interactionId: parentInteractionId,
        parentInteractionId: null,
        illustrationId: current.plate.parentIllustrationId,
        turnNumber: null,
        isBranch: true,
        isActiveTarget: false,
        isAgedOutParent: true,
        rebootstrappedFromParentWebp: false,
      };

      return [agedOutParentHop, currentHop];
    }

    return [...walkAncestors(parentNode, nextVisited), currentHop];
  };

  return walkAncestors(activeNode, new Set());
}

export function resolveCanonicalBaselineNode(options: {
  nodes: readonly FrameTimelineNode[];
  activeNode: FrameTimelineNode | undefined;
  edges?: readonly FrameTimelineEdge[];
  activeCanonicalIllustrationId?: string | null;
}): FrameTimelineNode | undefined {
  const { nodes, activeNode, edges, activeCanonicalIllustrationId } = options;
  if (!activeNode || !activeNode.plate.isBranch || nodes.length === 0) {
    return undefined;
  }

  const byInteraction = new Map(nodes.map((node) => [node.plate.interactionId, node]));
  const byIllustrationId = new Map(nodes.map((node) => [node.plate.illustrationId, node]));
  const edgeByChild = new Map((edges ?? []).map((edge) => [edge.childInteractionId, edge]));

  const findCanonicalAncestor = (
    current: FrameTimelineNode,
    visited: ReadonlySet<string>
  ): FrameTimelineNode | undefined => {
    const parentInteractionId =
      edgeByChild.get(current.plate.interactionId)?.parentInteractionId ??
      current.plate.parentInteractionId;
    const parentNode =
      (parentInteractionId ? byInteraction.get(parentInteractionId) : undefined) ??
      (current.plate.parentIllustrationId ? byIllustrationId.get(current.plate.parentIllustrationId) : undefined);

    if (!parentNode || visited.has(parentNode.plate.interactionId)) {
      return undefined;
    }

    if (!parentNode.plate.isBranch) {
      return parentNode;
    }

    return findCanonicalAncestor(
      parentNode,
      new Set([...visited, parentNode.plate.interactionId])
    );
  };

  const directAncestor = findCanonicalAncestor(
    activeNode,
    new Set([activeNode.plate.interactionId])
  );
  if (directAncestor) {
    return directAncestor;
  }

  if (activeCanonicalIllustrationId) {
    const headCandidate = byIllustrationId.get(activeCanonicalIllustrationId);
    return headCandidate && !headCandidate.plate.isBranch ? headCandidate : undefined;
  }

  if (activeCanonicalIllustrationId === null) {
    return undefined;
  }

  return orderTimelineNodes(nodes)
    .filter((node) => !node.plate.isBranch)
    .at(-1);
}

export function mergeBranchedNodeIntoTimeline(
  timeline: FrameTimelineResponse,
  branch: BranchIllustrationResponse
): FrameTimelineResponse {
  if (
    branch.timelineId !== timeline.timelineId ||
    branch.node.plate.timelineId !== timeline.timelineId
  ) {
    return timeline;
  }

  const incomingIllustration = branch.node.plate;
  const remainingNodes = timeline.nodes.filter(
    (existing) =>
      existing.plate.illustrationId !== incomingIllustration.illustrationId &&
      existing.plate.interactionId !== incomingIllustration.interactionId
  );
  const nextNodes = orderTimelineNodes([...remainingNodes, branch.node]);

  const parentInteractionId = incomingIllustration.parentInteractionId;
  const parentNode = parentInteractionId
    ? nextNodes.find((node) => node.plate.interactionId === parentInteractionId)
    : undefined;
  const hasExistingEdge =
    parentInteractionId !== null &&
    timeline.edges.some(
      (edge) =>
        edge.parentInteractionId === parentInteractionId &&
        edge.childInteractionId === incomingIllustration.interactionId
    );

  const nextEdges =
    parentNode &&
    parentNode.plate.interactionId !== incomingIllustration.interactionId &&
    !hasExistingEdge
      ? [
          ...timeline.edges,
          {
            parentInteractionId: parentNode.plate.interactionId,
            childInteractionId: incomingIllustration.interactionId,
            parentIllustrationId: parentNode.plate.illustrationId,
            childIllustrationId: incomingIllustration.illustrationId,
            isBranch: incomingIllustration.isBranch,
          },
        ]
      : timeline.edges;

  return {
    ...timeline,
    nodes: nextNodes,
    edges: nextEdges,
  };
}

