import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { MotionConfig, motion } from "motion/react";
import type { LineageNode } from "@samasastudio/gridlock-core/schemas";
import { DossierStatusBadge, EDITORIAL_EASE, RELIEF_RETICLE_ICON } from "./DossierPrimitives.tsx";
import { buildPlateAssetUrl } from "./plate-lineage-client.ts";
import { buildPlateTurnLabels, orderLineageNodes, resolveStageActiveNode } from "./plate-lineage-model.ts";
import { GRIDLOCK_PLATE_WIDGET_STYLESHEET } from "./plate-widget-styles.ts";

const STAGE_STYLESHEET_NODE = <style href="gridlock-plate-widget" precedence="default">{GRIDLOCK_PLATE_WIDGET_STYLESHEET}</style>;
const BRANCH_CUE_DOT = <span className="gridlock-branch-dot" aria-hidden="true" />;

export interface PlateFrameStageProps {
  nodes: readonly LineageNode[];
  activePlateId?: string | null;
  onSelectPlate: (plateId: string) => void;
  apiBaseUrl?: string;
  assetUrlOverrides?: Readonly<Record<string, string>>;
  baseId?: string;
  children?: ReactNode;
}

function PlateViewportFrame(props: {
  node: LineageNode;
  resolvedSrc?: string;
  isImageFailed: boolean;
  onImageError: () => void;
}) {
  const { plate } = props.node;
  const showRaster = props.resolvedSrc !== undefined && !props.isImageFailed;

  return (
    <figure className="gridlock-plate-viewport" data-plate-id={plate.plateId} data-branch={plate.isBranch ? "true" : "false"}>
      <figcaption className="gridlock-plate-meta-bar">
        <DossierStatusBadge tone={plate.isBranch ? "alert" : "healthy"} label={plate.epistemicLabel} />
        <span className="gridlock-plate-turn-stamp">
          <span>Turn {plate.turnNumber}</span>
          <span aria-hidden="true"> · </span>
          <time dateTime={plate.createdAt}>{plate.createdAt.slice(0, 10)}</time>
          <span aria-hidden="true"> · </span>
          <code>{plate.plateId}</code>
        </span>
      </figcaption>
      {showRaster ? (
        <motion.img
          key={`${plate.plateId}::${props.resolvedSrc}`}
          className="gridlock-plate-img"
          src={props.resolvedSrc}
          alt={`${plate.epistemicLabel} — Turn ${plate.turnNumber} (${plate.plateId})`}
          loading="eager"
          decoding="async"
          onError={props.onImageError}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.48, ease: EDITORIAL_EASE }}
        />
      ) : (
        <div className="gridlock-plate-fallback" data-plate-fallback="true">
          <div className="gridlock-plate-fallback-head">
            {RELIEF_RETICLE_ICON}
            <strong>Visual Plate preview unavailable</strong>
          </div>
          <p className="gridlock-plate-fallback-copy">
            WebP asset for <code>{plate.plateId}</code> could not be loaded; verified Observations and cryptographic Source Artifact provenance remain inspectable.
          </p>
        </div>
      )}
    </figure>
  );
}

export function PlateFrameStage(props: PlateFrameStageProps) {
  const generatedId = useId();
  const stageId = props.baseId ?? generatedId;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [failedAssetKeys, setFailedAssetKeys] = useState<ReadonlySet<string>>(() => new Set());

  const orderedNodes = orderLineageNodes(props.nodes);
  const turnLabels = buildPlateTurnLabels(orderedNodes);
  const activeNode = resolveStageActiveNode(orderedNodes, props.activePlateId);
  const overrideSrc = activeNode ? props.assetUrlOverrides?.[activeNode.plate.plateId]?.trim() : undefined;
  const resolvedSrc = activeNode
    ? (overrideSrc || (props.apiBaseUrl !== undefined ? buildPlateAssetUrl(props.apiBaseUrl, activeNode.assetPath) : undefined))
    : undefined;
  const activeAssetKey = activeNode && resolvedSrc !== undefined ? `${activeNode.plate.plateId}::${resolvedSrc}` : null;
  const isImageFailed = activeAssetKey !== null && failedAssetKeys.has(activeAssetKey);

  const handleImageError = () => {
    if (!activeAssetKey) return;
    setFailedAssetKeys((prev) => {
      if (prev.has(activeAssetKey)) return prev;
      const next = new Set(prev);
      next.add(activeAssetKey);
      return next;
    });
  };

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
            <PlateViewportFrame node={activeNode} resolvedSrc={resolvedSrc} isImageFailed={isImageFailed} onImageError={handleImageError} />
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
