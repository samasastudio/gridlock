import { useState } from "react";
import { motion } from "motion/react";
import type { LineageEdge, LineageNode } from "@samasastudio/gridlock-core/schemas";
import { DossierStatusBadge, EDITORIAL_EASE, RELIEF_RETICLE_ICON } from "./DossierPrimitives.tsx";
import { buildPlateAssetUrl } from "./plate-lineage-client.ts";
import { resolveCanonicalBaselineNode } from "./plate-lineage-model.ts";

export interface PlateComparisonStageProps {
  nodes: readonly LineageNode[];
  edges?: readonly LineageEdge[];
  activeCanonicalIllustrationId?: string | null;
  activeNode: LineageNode;
  isComparing: boolean;
  onToggleCompare: (nextComparing: boolean) => void;
  apiBaseUrl?: string;
  assetUrlOverrides?: Readonly<Record<string, string>>;
}

function resolveNodeAssetSrc(
  node: LineageNode,
  apiBaseUrl?: string,
  assetUrlOverrides?: Readonly<Record<string, string>>
): string | undefined {
  const overrideSrc = assetUrlOverrides?.[node.plate.illustrationId]?.trim();
  if (overrideSrc) {
    return overrideSrc;
  }

  return apiBaseUrl !== undefined
    ? buildPlateAssetUrl(apiBaseUrl, node.assetPath)
    : undefined;
}

function PlateViewportFrame(props: {
  node: LineageNode;
  apiBaseUrl?: string;
  assetUrlOverrides?: Readonly<Record<string, string>>;
  failedAssetKeys: ReadonlySet<string>;
  onAssetFailed: (assetKey: string | null) => void;
  comparisonSlot?: "canonical" | "branch";
}) {
  const { plate } = props.node;
  const resolvedSrc = resolveNodeAssetSrc(props.node, props.apiBaseUrl, props.assetUrlOverrides);
  const assetKey = resolvedSrc !== undefined ? `${plate.illustrationId}::${resolvedSrc}` : null;
  const showRaster =
    resolvedSrc !== undefined && (assetKey === null || !props.failedAssetKeys.has(assetKey));

  return (
    <figure
      className="gridlock-plate-viewport"
      data-plate-id={plate.illustrationId}
      data-branch={plate.isBranch ? "true" : "false"}
      data-comparison-slot={props.comparisonSlot}
    >
      <figcaption className="gridlock-plate-meta-bar">
        <DossierStatusBadge tone={plate.isBranch ? "alert" : "healthy"} label={plate.epistemicLabel} />
        <span className="gridlock-plate-turn-stamp">
          <span>Turn {plate.turnNumber}</span>
          <span aria-hidden="true"> · </span>
          <time dateTime={plate.createdAt}>{plate.createdAt.slice(0, 10)}</time>
          <span aria-hidden="true"> · </span>
          <code>{plate.illustrationId}</code>
        </span>
      </figcaption>
      {showRaster ? (
        <motion.img
          key={`${plate.illustrationId}::${resolvedSrc}`}
          className="gridlock-plate-img"
          src={resolvedSrc}
          alt={`${plate.epistemicLabel} — Turn ${plate.turnNumber} (${plate.illustrationId})`}
          loading="eager"
          decoding="async"
          onError={() => props.onAssetFailed(assetKey)}
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
            WebP asset for <code>{plate.illustrationId}</code> could not be loaded; verified Observations
            and cryptographic Raw Capture provenance remain inspectable.
          </p>
        </div>
      )}
    </figure>
  );
}

export function PlateComparisonStage(props: PlateComparisonStageProps) {
  const [failedAssetKeys, setFailedAssetKeys] = useState<ReadonlySet<string>>(() => new Set());

  const markAssetFailed = (assetKey: string | null) => {
    if (!assetKey) {
      return;
    }

    setFailedAssetKeys((prev) =>
      prev.has(assetKey) ? prev : new Set([...prev, assetKey])
    );
  };

  const baselineNode = resolveCanonicalBaselineNode({
    nodes: props.nodes,
    activeNode: props.activeNode,
    edges: props.edges,
    activeCanonicalIllustrationId: props.activeCanonicalIllustrationId,
  });

  const activeViewport = (
    <PlateViewportFrame
      node={props.activeNode}
      apiBaseUrl={props.apiBaseUrl}
      assetUrlOverrides={props.assetUrlOverrides}
      failedAssetKeys={failedAssetKeys}
      onAssetFailed={markAssetFailed}
      comparisonSlot={baselineNode && props.isComparing ? "branch" : undefined}
    />
  );

  if (!baselineNode) {
    return activeViewport;
  }

  return (
    <>
      <div className="gridlock-plate-compare-bar">
        <span className="gridlock-plate-compare-context">
          <span>Baseline · Turn {baselineNode.plate.turnNumber}</span>
          <span aria-hidden="true"> · </span>
          <code>{baselineNode.plate.illustrationId}</code>
        </span>
        <button
          type="button"
          className="gridlock-action-btn gridlock-plate-compare-toggle"
          aria-pressed={props.isComparing}
          onClick={() => props.onToggleCompare(!props.isComparing)}
        >
          Compare with Canonical
        </button>
      </div>
      {props.isComparing ? (
        <div
          className="gridlock-plate-comparison-grid"
          data-plate-comparison="split"
          role="group"
          aria-label="Canonical Milestone versus Scenario Branch comparison"
        >
          <PlateViewportFrame
            node={baselineNode}
            apiBaseUrl={props.apiBaseUrl}
            assetUrlOverrides={props.assetUrlOverrides}
            failedAssetKeys={failedAssetKeys}
            onAssetFailed={markAssetFailed}
            comparisonSlot="canonical"
          />
          {activeViewport}
        </div>
      ) : (
        activeViewport
      )}
    </>
  );
}
