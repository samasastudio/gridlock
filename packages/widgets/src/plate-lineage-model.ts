import type { LineageNode } from "@samasastudio/gridlock-core/schemas";

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
