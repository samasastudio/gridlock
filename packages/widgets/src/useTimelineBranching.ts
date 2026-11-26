import { useEffect, useRef, useState } from "react";
import type {
  BranchIllustrationResponse,
  FrameTimelineNode,
  FrameTimelineResponse,
} from "@samasastudio/gridlock-core/schemas";
import { submitPlateBranch } from "./plate-lineage-client.ts";
import {
  mergeBranchedNodeIntoTimeline,
  orderTimelineNodes,
  resolveActiveTimelineNode,
} from "./frame-timeline-model.ts";

export interface TimelineBranchAlert {
  message: string;
  statusCode?: number;
  errorCode?: string;
}

export interface UseTimelineBranchingOptions {
  baseTimeline: FrameTimelineResponse;
  apiBaseUrl?: string;
  selectedIllustrationId?: string;
  initialIllustrationId?: string;
  onSelectIllustration?: (illustrationId: string) => void;
}

export function useTimelineBranching(options: UseTimelineBranchingOptions) {
  const {
    baseTimeline,
    apiBaseUrl,
    selectedIllustrationId,
    initialIllustrationId,
    onSelectIllustration,
  } = options;
  const queryKey = `${apiBaseUrl ?? "::static"}::${baseTimeline.timelineId}`;

  const [internalIllustrationEntry, setInternalIllustrationEntry] = useState<{
    queryKey: string;
    illustrationId: string | null;
  } | null>(null);
  const [localBranchEntries, setLocalBranchEntries] = useState<
    readonly { queryKey: string; branch: BranchIllustrationResponse }[]
  >([]);
  const [scenarioPrompt, setScenarioPrompt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittingTargetNode, setSubmittingTargetNode] = useState<FrameTimelineNode | null>(null);
  const [branchErrorEntry, setBranchErrorEntry] = useState<{
    queryKey: string;
    alert: TimelineBranchAlert;
  } | null>(null);
  const [isComparingEntry, setIsComparingEntry] = useState<{
    queryKey: string;
    value: boolean;
  } | null>(null);
  const inFlightRef = useRef<AbortController | null>(null);

  const internalIllustrationId =
    internalIllustrationEntry?.queryKey === queryKey
      ? internalIllustrationEntry.illustrationId
      : (initialIllustrationId ?? null);
  const isComparing =
    isComparingEntry?.queryKey === queryKey ? isComparingEntry.value : false;

  const scopedBranches = localBranchEntries
    .filter((entry) => entry.queryKey === queryKey)
    .map((entry) => entry.branch);
  const effectiveTimeline = scopedBranches.reduce(
    (acc, branch) => mergeBranchedNodeIntoTimeline(acc, branch),
    baseTimeline
  );
  const orderedNodes = orderTimelineNodes(effectiveTimeline.nodes);
  const activeNode = resolveActiveTimelineNode({
    orderedNodes,
    activeCanonicalIllustrationId: effectiveTimeline.activeCanonicalIllustrationId,
    selectedIllustrationId: selectedIllustrationId ?? internalIllustrationId,
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
  }, [apiBaseUrl, baseTimeline.timelineId]);

  const setIsComparing = (value: boolean) => {
    setIsComparingEntry({ queryKey, value });
  };

  const selectIllustrationForQuery = (targetKey: string, illustrationId: string) => {
    setBranchErrorEntry(null);
    if (selectedIllustrationId === undefined) {
      setInternalIllustrationEntry({ queryKey: targetKey, illustrationId });
    }
    onSelectIllustration?.(illustrationId);
  };

  const selectIllustration = (illustrationId: string) => {
    selectIllustrationForQuery(queryKey, illustrationId);
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
    const targetTimelineId = baseTimeline.timelineId;
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
    selectIllustrationForQuery(targetQueryKey, result.branch.plate.illustrationId);
  };

  return {
    effectiveTimeline,
    orderedNodes,
    activeNode,
    branchTargetNode,
    scenarioPrompt,
    isSubmitting,
    branchError,
    isComparing,
    setIsComparing,
    selectIllustration,
    updateScenarioPrompt,
    submitScenarioBranch,
  };
}
