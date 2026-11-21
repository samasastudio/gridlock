import { Fragment, useId, type Ref } from "react";
import { MotionConfig, motion } from "motion/react";
import { CANONICAL_MILESTONE_LABEL, ProjectDossierCardNodeSchema, type CitedProject } from "@samasastudio/gridlock-core/schemas";
import { computeBuildWindowSummary, computeCostPerSqFtUsd, unescapeAstProse } from "./ast-card-model.ts";
import { GRIDLOCK_AST_CARD_STYLESHEET } from "./ast-card-styles.ts";
import {
  CopyCitationButton,
  DossierNumber,
  DossierStatusBadge,
  EDITORIAL_EASE,
  EXPORT_ARROW_ICON,
  type GridlockWidgetTheme,
} from "./DossierPrimitives.tsx";
import { DossierErrorShell, DossierTitle } from "./RepairLogSections.tsx";

const AST_CARD_STYLESHEET_NODE = <style href="gridlock-ast-cards" precedence="default">{GRIDLOCK_AST_CARD_STYLESHEET}</style>;
const META_DOT_NODE = <span aria-hidden="true">·</span>;
const INTEGER_FORMAT = { maximumFractionDigits: 0 } as const;

export interface ProjectDossierCardProps {
  citedProject: CitedProject;
  nodeId?: string;
  theme?: GridlockWidgetTheme;
  ref?: Ref<HTMLElement>;
}

function ProjectDossierContent(props: { baseId: string; citedProject: CitedProject; nodeId?: string }) {
  const { baseId, citedProject, nodeId } = props;
  const { project, citation } = citedProject;
  const costPerSqFtUsd = computeCostPerSqFtUsd(project.estimatedCostUsd, project.squareFootage);
  const buildWindow = computeBuildWindowSummary(project.startDate, project.completionDate);
  const corporateMetaItems = [
    project.ownerName,
    project.facilityName,
    ...(project.designFirmName ? [project.designFirmName] : []),
    project.locationAddress,
  ].map(unescapeAstProse);
  const citationKey = `${nodeId ?? "card"}:${project.projectNumber}:${citation.sha256}`;
  const retentionStatus = citation.referencedByMilestone
    ? CANONICAL_MILESTONE_LABEL
    : "90-day non-milestone window";

  const kpiItems = [
    {
      label: "Estimated Capital",
      value: project.estimatedCostUsd,
      prefix: "$",
      format: INTEGER_FORMAT,
      sub: `$${costPerSqFtUsd.toLocaleString("en-US")} / sq ft capital intensity`,
      delay: 0.08,
    },
    {
      label: "Physical Footprint",
      value: project.squareFootage,
      suffix: " sq ft",
      format: INTEGER_FORMAT,
      sub: unescapeAstProse(project.typeOfWork),
      delay: 0.2,
    },
    {
      label: "Build Window",
      value: buildWindow.value,
      suffix: buildWindow.unitSuffix,
      sub: `${unescapeAstProse(project.county)} County · ${buildWindow.rangeLabel}`,
      delay: 0.32,
    },
  ];

  return (
    <>
      <header className="gridlock-repair-header">
        <DossierTitle
          baseId={baseId}
          title={unescapeAstProse(project.projectName)}
          connectorId={project.projectNumber}
        />
        <div className="gridlock-header-controls">
          <DossierStatusBadge label={unescapeAstProse(project.currentStatus)} />
        </div>
      </header>

      <dl className="gridlock-headline-stats">
        {kpiItems.map((item) => (
          <motion.div
            key={item.label}
            className="gridlock-headline-stat"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: item.delay, ease: EDITORIAL_EASE }}
          >
            <dt>{item.label}</dt>
            <dd>
              <strong className="gridlock-kpi-value">
                <DossierNumber value={item.value} prefix={item.prefix} suffix={item.suffix} format={item.format} />
              </strong>
              <span className="gridlock-kpi-sub">{item.sub}</span>
            </dd>
          </motion.div>
        ))}
      </dl>

      <div className="gridlock-ast-specimen">
        <p className="gridlock-ast-lead">{unescapeAstProse(project.scopeOfWork)}</p>
        <div className="gridlock-inline-meta" aria-label="Filing entity and site metadata">
          {corporateMetaItems.map((item, idx) => (
            <Fragment key={`${idx}-${item}`}>
              {idx > 0 ? META_DOT_NODE : null}
              <span>{item}</span>
            </Fragment>
          ))}
        </div>
        <div className="gridlock-citations-row" aria-label="Source Artifact citation">
          <span className="gridlock-citation-item">
            <CopyCitationButton
              key={`copy-${citationKey}`}
              value={citation.sha256}
              displayLabel={`sha256:${citation.sha256.slice(0, 12)}`}
              citationKind="Source Artifact SHA-256"
            />
            <a className="gridlock-citation-link" href={citation.sourceUrl} target="_blank" rel="noreferrer noopener">
              <span>{`${citation.connectorId} filing`}</span>
              {EXPORT_ARROW_ICON}
            </a>
          </span>
        </div>
        <details key={`details-${citationKey}`} className="gridlock-ast-disclosure">
          <summary className="gridlock-ast-disclosure-summary">
            <span>Inspect filing timestamps &amp; retention</span>
          </summary>
          <div className="gridlock-ast-disclosure-body">
            <div className="gridlock-inline-meta">
              <span>Captured <time dateTime={citation.capturedAt}>{citation.capturedAt}</time></span>
              {META_DOT_NODE}
              <span>Updated <time dateTime={project.updatedAt}>{project.updatedAt}</time></span>
              {META_DOT_NODE}
              <span>{retentionStatus}</span>
            </div>
          </div>
        </details>
      </div>
    </>
  );
}

export function ProjectDossierCard(props: ProjectDossierCardProps) {
  const { citedProject, nodeId, theme = "inherit", ref } = props;
  const baseId = useId();
  const parsed = ProjectDossierCardNodeSchema.safeParse({
    nodeId: nodeId ?? "standalone-dossier-card",
    component: "ProjectDossierCard",
    citedProject,
  });

  return (
    <MotionConfig reducedMotion="user">
      <section
        ref={ref}
        aria-labelledby={`${baseId}-title`}
        className="gridlock-dossier-surface gridlock-ast-card gridlock-project-dossier-card"
        data-gridlock-theme={theme}
        data-ast-card="ProjectDossierCard"
        data-node-id={nodeId}
      >
        {AST_CARD_STYLESHEET_NODE}
        {!parsed.success ? (
          <DossierErrorShell
            baseId={baseId}
            title="Project Filing Dossier"
            errorPrefix="Malformed ProjectDossierCard props:"
            message={parsed.error.issues[0]?.message ?? "Invalid cited project payload"}
          />
        ) : (
          <ProjectDossierContent baseId={baseId} citedProject={parsed.data.citedProject} nodeId={nodeId} />
        )}
      </section>
    </MotionConfig>
  );
}
