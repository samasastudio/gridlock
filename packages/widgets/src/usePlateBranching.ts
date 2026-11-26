import { useEffect, useRef, useState } from "react";
import type {
  BranchPlateResponse,
  LineageNode,
  PlateLineageResponse,
} from "@samasastudio/gridlock-core/schemas";
import { submitPlateBranch } from "./plate-lineage-client.ts";
import {
  mergeBranchedNodeIntoLineage,
  orderLineageNodes,
  resolveActiveLineageNode,
} from "./plate-lineage-model.ts";

export interface PlateBranchAlert {
  message: string;
  statusCode?: number;
  errorCode?: string;
}

export interface UsePlateBranchingOptions {
  baseLineage: PlateLineageResponse;
  apiBaseUrl?: string;
  selectedPlateId?: string;
  initialIllustrationId?: string;
  onSelectPlate?: (illustrationId: string) => void;
}

export function usePlateBranching(options: UsePlateBranchingOptions) {
  const { baseLineage, apiBaseUrl, selectedPlateId, initialIllustrationId, onSelectPlate } = options;
  const queryKey = `${apiBaseUrl ?? "::static"}::${baseLineage.timelineId}`;

  const [internalPlateEntry, setInternalPlateEntry] = useState<{
    queryKey: string;
    illustrationId: string | null;
  } | null>(null);
  const [localBranchEntries, setLocalBranchEntries] = useState<
    readonly { queryKey: string; branch: BranchPlateResponse }[]
  >([]);
  const [scenarioPrompt, setScenarioPrompt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittingTargetNode, setSubmittingTargetNode] = useState<LineageNode | null>(null);
  const [branchErrorEntry, setBranchErrorEntry] = useState<{
    queryKey: string;
    alert: PlateBranchAlert;
  } | null>(null);
  const [isComparingEntry, setIsComparingEntry] = useState<{
    queryKey: string;
    value: boolean;
  } | null>(null);
  const inFlightRef = useRef<AbortController | null>(null);

  const internalPlateId =
    internalPlateEntry?.queryKey === queryKey
      ? internalPlateEntry.illustrationId
      : (initialIllustrationId ?? null);
  const isComparing =
    isComparingEntry?.queryKey === queryKey ? isComparingEntry.value : false;

  const scopedBranches = localBranchEntries
    .filter((entry) => entry.queryKey === queryKey)
    .map((entry) => entry.branch);
  const effectiveLineage = scopedBranches.reduce(
    (acc, branch) => mergeBranchedNodeIntoLineage(acc, branch),
    baseLineage
  );
  const orderedNodes = orderLineageNodes(effectiveLineage.nodes);
  const activeNode = resolveActiveLineageNode({
    orderedNodes,
    activeCanonicalIllustrationId: effectiveLineage.activeCanonicalIllustrationId,
    selectedPlateId: selectedPlateId ?? internalPlateId,
    initialIllustrationId,
  });

  const branchError =
    branchErrorEntry?.queryKey === queryKey ? branchErrorEntry.alert : null;
  const branchTargetNode =
    isSubmitting && submittingTargetNode ? submittingTargetNode : activeNode;

  useEffect(() => {
    return () => {
      if (inFlightRef.current !== null) {
        inFlightRef.current.abort();
        inFlightRef.current = null;
        setSubmittingTargetNode(null);
        setIsSubmitting(false);
      }
    };
  }, [apiBaseUrl, baseLineage.timelineId]);

  const setIsComparing = (value: boolean) => {
    setIsComparingEntry({ queryKey, value });
  };

  const selectPlateForQuery = (targetKey: string, illustrationId: string) => {
    setBranchErrorEntry(null);
    if (selectedPlateId === undefined) {
      setInternalPlateEntry({ queryKey: targetKey, illustrationId });
    }
    onSelectPlate?.(illustrationId);
  };

  const selectPlate = (illustrationId: string) => {
    selectPlateForQuery(queryKey, illustrationId);
  };

  const updateScenarioPrompt = (nextPrompt: string) => {
    setScenarioPrompt(nextPrompt);
    setBranchErrorEntry(null);
  };

  const submitScenarioBranch = async (parentInteractionId: string): Promise<void> => {
    if (
      apiBaseUrl === undefined ||
      inFlightRef.current !== null ||
      scenarioPrompt.trim().length === 0
    ) {
      return;
    }

    const targetQueryKey = queryKey;
    const targetTimelineId = baseLineage.timelineId;
    const pinnedTarget =
      orderedNodes.find((node) => node.plate.interactionId === parentInteractionId) ??
      activeNode ??
      null;
    const controller = new AbortController();

    inFlightRef.current = controller;
    setSubmittingTargetNode(pinnedTarget);
    setIsSubmitting(true);
    setBranchErrorEntry(null);

    const result = await submitPlateBranch({
      apiBaseUrl,
      interactionId: parentInteractionId,
      scenarioPrompt,
      timelineId: targetTimelineId,
      signal: controller.signal,
    });

    if (controller.signal.aborted || inFlightRef.current !== controller) {
      return;
    }

    inFlightRef.current = null;
    setSubmittingTargetNode(null);
    setIsSubmitting(false);

    if (!result.ok) {
      setBranchErrorEntry({
        queryKey: targetQueryKey,
        alert: {
          message: result.message,
          statusCode: result.statusCode,
          errorCode: result.errorCode,
        },
      });
      return;
    }

    if (
      result.branch.timelineId !== targetTimelineId ||
      result.branch.node.plate.timelineId !== targetTimelineId
    ) {
      setBranchErrorEntry({
        queryKey: targetQueryKey,
        alert: {
          message: "Scenario Branch response timelineId did not match active timeline",
        },
      });
      return;
    }

    setLocalBranchEntries((prev) => [
      ...prev,
      { queryKey: targetQueryKey, branch: result.branch },
    ]);
    setScenarioPrompt("");
    setBranchErrorEntry(null);
    setIsComparingEntry({ queryKey: targetQueryKey, value: true });
    selectPlateForQuery(targetQueryKey, result.branch.plate.illustrationId);
  };

  return {
    effectiveLineage,
    orderedNodes,
    activeNode,
    branchTargetNode,
    scenarioPrompt,
    isSubmitting,
    branchError,
    isComparing,
    setIsComparing,
    selectPlate,
    updateScenarioPrompt,
    submitScenarioBranch,
  };
}
