import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { MotionConfig, motion } from "motion/react";
import type { FrameTimelineEdge, FrameTimelineNode } from "@samasastudio/gridlock-core/schemas";
import { RELIEF_RETICLE_ICON } from "./DossierPrimitives.tsx";
import { TimelineComparisonStage } from "./TimelineComparisonStage.tsx";
import { buildTimelineTurnLabels, orderTimelineNodes, resolveStageActiveNode } from "./frame-timeline-model.ts";
import { GRIDLOCK_TIMELINE_WIDGET_STYLESHEET } from "./timeline-widget-styles.ts";

const STAGE_STYLESHEET_NODE = <style href="gridlock-timeline-widget" precedence="default">{GRIDLOCK_TIMELINE_WIDGET_STYLESHEET}</style>;
const BRANCH_CUE_DOT = <span className="gridlock-branch-dot" aria-hidden="true" />;

export interface TimelineFrameStageProps {
  nodes: readonly FrameTimelineNode[];
  edges?: readonly FrameTimelineEdge[];
  activeCanonicalIllustrationId?: string | null;
  activeIllustrationId?: string | null;
  isComparing?: boolean;
  onCompareChange?: (isComparing: boolean) => void;
  onSelectIllustration: (illustrationId: string) => void;
  apiBaseUrl?: string;
  assetUrlOverrides?: Readonly<Record<string, string>>;
  baseId?: string;
  children?: ReactNode;
}

export function TimelineFrameStage(props: TimelineFrameStageProps) {
  const generatedId = useId();
  const stageId = props.baseId ?? generatedId;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [internalComparing, setInternalComparing] = useState(false);
  const effectiveComparing = props.isComparing ?? internalComparing;

  const handleToggleCompare = (nextComparing: boolean) => {
    if (props.isComparing === undefined) {
      setInternalComparing(nextComparing);
    }
    props.onCompareChange?.(nextComparing);
  };

  const orderedNodes = orderTimelineNodes(props.nodes);
  const turnLabels = buildTimelineTurnLabels(orderedNodes);
  const activeNode = resolveStageActiveNode(orderedNodes, props.activeIllustrationId);

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (orderedNodes.length <= 1) return;
    const nextIndex =
      event.key === "ArrowRight"
        ? (index + 1) % orderedNodes.length
        : event.key === "ArrowLeft"
          ? (index - 1 + orderedNodes.length) % orderedNodes.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? orderedNodes.length - 1
              : -1;
    if (nextIndex === -1) return;
    event.preventDefault();
    const target = orderedNodes[nextIndex];
    if (!target) return;
    props.onSelectIllustration(target.plate.illustrationId);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="gridlock-timeline-stage">
        {STAGE_STYLESHEET_NODE}
        <div className="gridlock-timeline-scrubber-bar">
          <h3 className="gridlock-section-heading">Frame Timeline Scrubber</h3>
          {activeNode ? (
            <div role="tablist" aria-label="Frame Timeline turns" className="gridlock-tab-list">
              {orderedNodes.map((node, index) => {
                const isSelected = node.plate.illustrationId === activeNode.plate.illustrationId;
                const label =
                  turnLabels.get(node.plate.illustrationId) ??
                  (node.plate.isBranch ? `Branch · Turn ${node.plate.turnNumber}` : `Turn ${node.plate.turnNumber}`);
                return (
                  <button
                    key={node.plate.illustrationId}
                    ref={(el) => { tabRefs.current[index] = el; }}
                    id={`${stageId}-tab-${node.plate.illustrationId}`}
                    role="tab"
                    type="button"
                    aria-selected={isSelected}
                    aria-controls={`${stageId}-panel-${node.plate.illustrationId}`}
                    tabIndex={isSelected ? 0 : -1}
                    className="gridlock-timeline-tab"
                    onClick={() => props.onSelectIllustration(node.plate.illustrationId)}
                    onKeyDown={(event) => handleTabKeyDown(event, index)}
                  >
                    {node.plate.isBranch ? BRANCH_CUE_DOT : null}
                    <span>{label}</span>
                    {isSelected ? (
                      <motion.span
                        aria-hidden="true"
                        layoutId={`${stageId}-active-timeline-tab`}
                        className="gridlock-timeline-tab-indicator"
                        transition={{ type: "spring", visualDuration: 0.5, bounce: 0 }}
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        {activeNode ? (
          <div id={`${stageId}-panel-${activeNode.plate.illustrationId}`} role="tabpanel" aria-labelledby={`${stageId}-tab-${activeNode.plate.illustrationId}`} className="gridlock-timeline-panel">
            <TimelineComparisonStage
              nodes={orderedNodes}
              edges={props.edges}
              activeCanonicalIllustrationId={props.activeCanonicalIllustrationId}
              activeNode={activeNode}
              isComparing={effectiveComparing}
              onToggleCompare={handleToggleCompare}
              apiBaseUrl={props.apiBaseUrl}
              assetUrlOverrides={props.assetUrlOverrides}
            />
            {props.children}
          </div>
        ) : (
          <p className="gridlock-empty-row" data-empty-timeline="true">
            {RELIEF_RETICLE_ICON}
            <span><strong>0 Generated Illustrations recorded</strong> — awaiting initial $25M+ corridor filing milestone to bootstrap Turn 1.</span>
          </p>
        )}
      </div>
    </MotionConfig>
  );
}
