import type {
  LineageNode,
  LineageSourceCitation,
  PlateLineageResponse,
} from "@samasastudio/gridlock-core/schemas";

export interface PlateLineageKpis {
  canonicalMilestonesCount: number;
  scenarioBranchesCount: number;
  linkedFilingsCount: number;
}

export function orderLineageNodes(nodes: readonly LineageNode[]): LineageNode[] {
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
    return left.plate.plateId.localeCompare(right.plate.plateId);
  });
}

export function resolveStageActiveNode(
  orderedNodes: readonly LineageNode[],
  activePlateId?: string | null
): LineageNode | undefined {
  if (orderedNodes.length === 0) return undefined;
  if (activePlateId) {
    const matched = orderedNodes.find((node) => node.plate.plateId === activePlateId);
    if (matched) return matched;
  }
  for (let index = orderedNodes.length - 1; index >= 0; index -= 1) {
    const candidate = orderedNodes[index];
    if (candidate && !candidate.plate.isBranch) {
      return candidate;
    }
  }
  return orderedNodes[orderedNodes.length - 1];
}

export function buildPlateTurnLabels(
  orderedNodes: readonly LineageNode[]
): ReadonlyMap<string, string> {
  const groupCounts = new Map<string, number>();
  for (const node of orderedNodes) {
    const key = `${node.plate.turnNumber}:${node.plate.isBranch ? "branch" : "canonical"}`;
    groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
  }
  const groupSeen = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const node of orderedNodes) {
    const { plateId, turnNumber, isBranch } = node.plate;
    const key = `${turnNumber}:${isBranch ? "branch" : "canonical"}`;
    const total = groupCounts.get(key) ?? 1;
    const ordinal = (groupSeen.get(key) ?? 0) + 1;
    groupSeen.set(key, ordinal);
    const label = isBranch
      ? total > 1 ? `Branch ${ordinal} · Turn ${turnNumber}` : `Branch · Turn ${turnNumber}`
      : total > 1 ? `Turn ${turnNumber} (${ordinal})` : `Turn ${turnNumber}`;
    labels.set(plateId, label);
  }
  return labels;
}

export function computePlateLineageKpis(lineage: PlateLineageResponse): PlateLineageKpis {
  const canonicalMilestonesCount = lineage.nodes.filter((node) => !node.plate.isBranch).length;
  const scenarioBranchesCount = lineage.nodes.length - canonicalMilestonesCount;
  const linkedFilingsCount = new Set(lineage.nodes.flatMap((node) => node.plate.projectNumbers)).size;
  return { canonicalMilestonesCount, scenarioBranchesCount, linkedFilingsCount };
}

export function resolveActiveLineageNode(options: {
  orderedNodes: readonly LineageNode[];
  activeCanonicalPlateId: string | null;
  selectedPlateId?: string | null;
  initialPlateId?: string | null;
}): LineageNode | undefined {
  const { orderedNodes, activeCanonicalPlateId, selectedPlateId, initialPlateId } = options;
  if (orderedNodes.length === 0) return undefined;
  const byPlateId = new Map(orderedNodes.map((node) => [node.plate.plateId, node]));
  for (const candidateId of [selectedPlateId, initialPlateId, activeCanonicalPlateId]) {
    if (candidateId && byPlateId.has(candidateId)) {
      return byPlateId.get(candidateId);
    }
  }
  return resolveStageActiveNode(orderedNodes);
}

export type ResolvedPlateCitation =
  | ({ kind: "hydrated" } & LineageSourceCitation)
  | { kind: "hash_only_ttl_aged"; sha256: string };

export interface ProvenanceHop {
  interactionId: string;
  parentInteractionId: string | null;
  plateId: string | null;
  turnNumber: number | null;
  isBranch: boolean;
  isActiveTarget: boolean;
  isAgedOutParent: boolean;
  rebootstrappedFromParentWebp: boolean;
}

export function resolveNodeSourceCitations(node: LineageNode): ResolvedPlateCitation[] {
  const hydratedByHash = new Map(node.sourceArtifacts.map((art) => [art.sha256, art]));
  return Array.from(new Set(node.plate.sourceArtifactHashes), (sha256) => {
    const hydrated = hydratedByHash.get(sha256);
    return hydrated ? { kind: "hydrated", ...hydrated } : { kind: "hash_only_ttl_aged", sha256 };
  });
}

export function buildAncestorProvenanceChain(
  lineage: PlateLineageResponse,
  activeNode: LineageNode
): ProvenanceHop[] {
  const byInteraction = new Map(lineage.nodes.map((node) => [node.plate.interactionId, node]));
  const edgeByChild = new Map(lineage.edges.map((edge) => [edge.childInteractionId, edge]));
  const reversedHops: ProvenanceHop[] = [];
  const visited = new Set<string>();
  let current: LineageNode | undefined = activeNode;

  while (current && !visited.has(current.plate.interactionId)) {
    visited.add(current.plate.interactionId);
    const parentInteractionId =
      edgeByChild.get(current.plate.interactionId)?.parentInteractionId ??
      current.plate.parentInteractionId;

    reversedHops.push({
      interactionId: current.plate.interactionId,
      parentInteractionId,
      plateId: current.plate.plateId,
      turnNumber: current.plate.turnNumber,
      isBranch: current.plate.isBranch,
      isActiveTarget: current.plate.plateId === activeNode.plate.plateId,
      isAgedOutParent: false,
      rebootstrappedFromParentWebp: current.plate.rebootstrappedFromParentWebp,
    });

    if (!parentInteractionId || visited.has(parentInteractionId)) break;
    const parentNode = byInteraction.get(parentInteractionId);
    if (!parentNode) {
      reversedHops.push({
        interactionId: parentInteractionId,
        parentInteractionId: null,
        plateId: current.plate.parentPlateId,
        turnNumber: null,
        isBranch: true,
        isActiveTarget: false,
        isAgedOutParent: true,
        rebootstrappedFromParentWebp: false,
      });
      break;
    }
    current = parentNode;
  }

  return reversedHops.reverse();
}

