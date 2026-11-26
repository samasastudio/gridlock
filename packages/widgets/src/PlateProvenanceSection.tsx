import type { LineageNode, PlateLineageResponse } from "@samasastudio/gridlock-core/schemas";
import { CopyCitationButton, EXPORT_ARROW_ICON } from "./DossierPrimitives.tsx";
import {
  buildAncestorProvenanceChain,
  buildPlateTurnLabels,
  orderLineageNodes,
  resolveNodeSourceCitations,
  type ProvenanceHop,
} from "./plate-lineage-model.ts";

export interface PlateProvenanceSectionProps {
  lineage: PlateLineageResponse;
  activeNode: LineageNode;
  onSelectPlate: (illustrationId: string) => void;
}

function formatTurnLabel(hop: ProvenanceHop): string {
  return hop.isBranch ? `Branch · Turn ${hop.turnNumber}` : `Turn ${hop.turnNumber}`;
}

function ProvenanceHopRow(props: {
  hop: ProvenanceHop;
  turnLabel?: string;
  onSelectPlate: (illustrationId: string) => void;
}) {
  const { hop, turnLabel, onSelectPlate } = props;
  const resolvedTurnLabel = turnLabel ?? formatTurnLabel(hop);
  const selectablePlateId = !hop.isActiveTarget && !hop.isAgedOutParent ? hop.illustrationId : null;

  return (
    <li className="gridlock-provenance-hop" aria-current={hop.isActiveTarget ? "step" : undefined}>
      {selectablePlateId ? (
        <button type="button" className="gridlock-hop-btn" onClick={() => onSelectPlate(selectablePlateId)}>
          {`${resolvedTurnLabel} · ${hop.interactionId}`}
        </button>
      ) : hop.isAgedOutParent ? (
        <span>
          <code>{hop.interactionId}</code>
          {hop.illustrationId ? ` (${hop.illustrationId})` : null}
        </span>
      ) : (
        <strong>
          {resolvedTurnLabel}
          {" · "}
          <code>{hop.interactionId}</code>
        </strong>
      )}
      {hop.parentInteractionId ? (
        <span className="gridlock-hop-note">
          {"← parent "}
          <code>{hop.parentInteractionId}</code>
        </span>
      ) : null}
      {hop.rebootstrappedFromParentWebp ? (
        <span className="gridlock-hop-note">re-bootstrapped from parent WebP</span>
      ) : null}
      {hop.isAgedOutParent ? (
        <span className="gridlock-hop-note">parent aged past 90d TTL</span>
      ) : null}
    </li>
  );
}

export function PlateProvenanceSection(props: PlateProvenanceSectionProps) {
  const { lineage, activeNode, onSelectPlate } = props;
  const { plate } = activeNode;
  const citations = resolveNodeSourceCitations(activeNode);
  const turnLabels = buildPlateTurnLabels(orderLineageNodes(lineage.nodes));
  const hops = buildAncestorProvenanceChain(lineage, activeNode);

  return (
    <>
      {citations.length > 0 ? (
        <div key={`citations-${plate.illustrationId}`} className="gridlock-citations-row" aria-label="Raw Capture citations">
          {citations.map((citation) => (
            <span key={citation.sha256} className="gridlock-citation-item">
              <CopyCitationButton
                value={citation.sha256}
                displayLabel={`sha256:${citation.sha256.slice(0, 12)}`}
                citationKind="Raw Capture SHA-256"
              />
              {citation.kind === "hydrated" && /^https?:\/\//i.test(citation.sourceUrl) ? (
                <a className="gridlock-citation-link" href={citation.sourceUrl} target="_blank" rel="noreferrer noopener">
                  <span>{citation.connectorId} filing</span>
                  {EXPORT_ARROW_ICON}
                </a>
              ) : citation.kind === "hash_only_ttl_aged" ? (
                <span className="gridlock-citation-aged">90d TTL archived</span>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      <details key={`prov-${plate.illustrationId}`} className="gridlock-plate-disclosure">
        <summary className="gridlock-plate-disclosure-summary">
          <span>Inspect Stateful Painter provenance ({hops.length} {hops.length === 1 ? "turn" : "turns"})</span>
        </summary>
        <div className="gridlock-plate-disclosure-body">
          <div className="gridlock-plate-invariant-strip">
            <span>
              <strong>Stateful Painter Agent:</strong> <code>{plate.model}</code>
            </span>
            <span className="gridlock-provenance-meta">
              <CopyCitationButton value={plate.interactionId} displayLabel={plate.interactionId} citationKind="Interaction ID" />
              <CopyCitationButton value={plate.sha256} displayLabel={`webp:${plate.sha256.slice(0, 12)}`} citationKind="Visual Plate WebP SHA-256" />
            </span>
          </div>
          <ol className="gridlock-provenance-hops" aria-label="Interaction lineage chain">
            {hops.map((hop) => (
              <ProvenanceHopRow
                key={hop.interactionId}
                hop={hop}
                turnLabel={hop.illustrationId ? turnLabels.get(hop.illustrationId) : undefined}
                onSelectPlate={onSelectPlate}
              />
            ))}
          </ol>
          <p className="gridlock-painter-prompt">
            <strong>Painter prompt:</strong> <code>{plate.prompt}</code>
          </p>
        </div>
      </details>
    </>
  );
}
