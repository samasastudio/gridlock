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
  initialPlateId?: string;
  onSelectPlate?: (plateId: string) => void;
}

export function usePlateBranching(options: UsePlateBranchingOptions) {
  const { baseLineage, apiBaseUrl, selectedPlateId, initialPlateId, onSelectPlate } = options;
  const queryKey = `${apiBaseUrl ?? "::static"}::${baseLineage.lineageId}`;

  const [internalPlateEntry, setInternalPlateEntry] = useState<{
    queryKey: string;
    plateId: string | null;
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
      ? internalPlateEntry.plateId
      : (initialPlateId ?? null);
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
    activeCanonicalPlateId: effectiveLineage.activeCanonicalPlateId,
    selectedPlateId: selectedPlateId ?? internalPlateId,
    initialPlateId,
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
  }, [apiBaseUrl, baseLineage.lineageId]);

  const setIsComparing = (value: boolean) => {
    setIsComparingEntry({ queryKey, value });
  };

  const selectPlateForQuery = (targetKey: string, plateId: string) => {
    setBranchErrorEntry(null);
    if (selectedPlateId === undefined) {
      setInternalPlateEntry({ queryKey: targetKey, plateId });
    }
    onSelectPlate?.(plateId);
  };

  const selectPlate = (plateId: string) => {
    selectPlateForQuery(queryKey, plateId);
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
    const targetLineageId = baseLineage.lineageId;
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
      lineageId: targetLineageId,
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
      result.branch.lineageId !== targetLineageId ||
      result.branch.node.plate.lineageId !== targetLineageId
    ) {
      setBranchErrorEntry({
        queryKey: targetQueryKey,
        alert: {
          message: "Scenario Branch response lineageId did not match active lineage",
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
    selectPlateForQuery(targetQueryKey, result.branch.plate.plateId);
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
