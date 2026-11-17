import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { MotionConfig, motion } from "motion/react";
import type { LineageEdge, LineageNode } from "@samasastudio/gridlock-core/schemas";
import { RELIEF_RETICLE_ICON } from "./DossierPrimitives.tsx";
import { PlateComparisonStage } from "./PlateComparisonStage.tsx";
import { buildPlateTurnLabels, orderLineageNodes, resolveStageActiveNode } from "./plate-lineage-model.ts";
import { GRIDLOCK_PLATE_WIDGET_STYLESHEET } from "./plate-widget-styles.ts";

const STAGE_STYLESHEET_NODE = <style href="gridlock-plate-widget" precedence="default">{GRIDLOCK_PLATE_WIDGET_STYLESHEET}</style>;
const BRANCH_CUE_DOT = <span className="gridlock-branch-dot" aria-hidden="true" />;

export interface PlateFrameStageProps {
  nodes: readonly LineageNode[];
  edges?: readonly LineageEdge[];
  activeCanonicalPlateId?: string | null;
  activePlateId?: string | null;
  isComparing?: boolean;
  onCompareChange?: (isComparing: boolean) => void;
  onSelectPlate: (plateId: string) => void;
  apiBaseUrl?: string;
  assetUrlOverrides?: Readonly<Record<string, string>>;
  baseId?: string;
  children?: ReactNode;
}

export function PlateFrameStage(props: PlateFrameStageProps) {
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

  const orderedNodes = orderLineageNodes(props.nodes);
  const turnLabels = buildPlateTurnLabels(orderedNodes);
  const activeNode = resolveStageActiveNode(orderedNodes, props.activePlateId);

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
    props.onSelectPlate(target.plate.plateId);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="gridlock-plate-stage">
        {STAGE_STYLESHEET_NODE}
        <div className="gridlock-plate-scrubber-bar">
          <h3 className="gridlock-section-heading">Temporal Lineage Scrubber</h3>
          {activeNode ? (
            <div role="tablist" aria-label="Visual Plate Lineage turns" className="gridlock-tab-list">
              {orderedNodes.map((node, index) => {
                const isSelected = node.plate.plateId === activeNode.plate.plateId;
                const label =
                  turnLabels.get(node.plate.plateId) ??
                  (node.plate.isBranch ? `Branch · Turn ${node.plate.turnNumber}` : `Turn ${node.plate.turnNumber}`);
                return (
                  <button
                    key={node.plate.plateId}
                    ref={(el) => { tabRefs.current[index] = el; }}
                    id={`${stageId}-tab-${node.plate.plateId}`}
                    role="tab"
                    type="button"
                    aria-selected={isSelected}
                    aria-controls={`${stageId}-panel-${node.plate.plateId}`}
                    tabIndex={isSelected ? 0 : -1}
                    className="gridlock-plate-tab"
                    onClick={() => props.onSelectPlate(node.plate.plateId)}
                    onKeyDown={(event) => handleTabKeyDown(event, index)}
                  >
                    {node.plate.isBranch ? BRANCH_CUE_DOT : null}
                    <span>{label}</span>
                    {isSelected ? (
                      <motion.span
                        aria-hidden="true"
                        layoutId={`${stageId}-active-plate-tab`}
                        className="gridlock-plate-tab-indicator"
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
          <div id={`${stageId}-panel-${activeNode.plate.plateId}`} role="tabpanel" aria-labelledby={`${stageId}-tab-${activeNode.plate.plateId}`} className="gridlock-plate-panel">
            <PlateComparisonStage
              nodes={orderedNodes}
              edges={props.edges}
              activeCanonicalPlateId={props.activeCanonicalPlateId}
              activeNode={activeNode}
              isComparing={effectiveComparing}
              onToggleCompare={handleToggleCompare}
              apiBaseUrl={props.apiBaseUrl}
              assetUrlOverrides={props.assetUrlOverrides}
            />
            {props.children}
          </div>
        ) : (
          <p className="gridlock-empty-row" data-empty-lineage="true">
            {RELIEF_RETICLE_ICON}
            <span><strong>0 Visual Plates recorded</strong> — awaiting initial $25M+ corridor filing milestone to bootstrap Turn 1.</span>
          </p>
        )}
      </div>
    </MotionConfig>
  );
}
