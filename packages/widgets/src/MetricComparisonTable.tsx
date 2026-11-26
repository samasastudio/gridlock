import { useId, type Ref } from "react";
import { MotionConfig, motion } from "motion/react";
import { MetricComparisonTableNodeSchema, type CitedProject } from "@samasastudio/gridlock-core/schemas";
import { buildComparisonBenchmarkModel, unescapeAstProse, type ComparisonRowViewModel } from "./ast-card-model.ts";
import { GRIDLOCK_AST_CARD_STYLESHEET } from "./ast-card-styles.ts";
import { CopyCitationButton, DossierNumber, DossierStatusBadge, EDITORIAL_EASE, EXPORT_ARROW_ICON, RELIEF_RETICLE_ICON, type GridlockWidgetTheme } from "./DossierPrimitives.tsx";
import { DossierErrorShell, DossierTitle } from "./RepairChangelogSections.tsx";

const AST_CARD_STYLESHEET_NODE = <style href="gridlock-ast-cards" precedence="default">{GRIDLOCK_AST_CARD_STYLESHEET}</style>;
const INTEGER_FORMAT = { maximumFractionDigits: 0 } as const;
const COMPARISON_COLUMNS = [
  "Project",
  "Location & Owner",
  "Estimated Capital",
  "Footprint & Density",
  "Window & Status",
  "Provenance",
] as const;

const COMPARISON_TABLE_HEAD_NODE = (
  <thead>
    <tr>
      {COMPARISON_COLUMNS.map((column) => (
        <th key={column} scope="col">{column}</th>
      ))}
    </tr>
  </thead>
);

export interface MetricComparisonTableProps {
  rows: readonly CitedProject[];
  nodeId?: string;
  theme?: GridlockWidgetTheme;
  ref?: Ref<HTMLElement>;
}

function ComparisonTableRow(props: { row: ComparisonRowViewModel; nodeId?: string }) {
  const { row, nodeId } = props;
  const { project, citation } = row.citedProject;
  const citationKey = `${nodeId ?? "card"}:${project.projectNumber}:${citation.sha256}`;

  return (
    <tr data-project-number={project.projectNumber}>
      <th scope="row">
        <div className="gridlock-comparison-cell-stack">
          <span>{unescapeAstProse(project.projectName)}</span>
          <code className="gridlock-project-chip">{project.projectNumber}</code>
        </div>
      </th>
      <td>
        <div className="gridlock-comparison-cell-stack">
          <span>{`${unescapeAstProse(project.county)} County`}</span>
          <span className="gridlock-comparison-sub">
            {`${unescapeAstProse(project.ownerName)} · ${unescapeAstProse(project.locationAddress)}`}
          </span>
        </div>
      </td>
      <td>
        <span>{`$${project.estimatedCostUsd.toLocaleString("en-US")}`}</span>
        <div aria-hidden="true" className="gridlock-scale-track">
          <div className="gridlock-scale-bar" style={{ inlineSize: `${row.scalePercent}%` }} />
        </div>
      </td>
      <td>
        <div className="gridlock-comparison-cell-stack">
          <span>{`${project.squareFootage.toLocaleString("en-US")} sq ft`}</span>
          <span className="gridlock-comparison-sub">
            {`$${row.costPerSqFtUsd.toLocaleString("en-US")} / sq ft · ${unescapeAstProse(project.typeOfWork)}`}
          </span>
        </div>
      </td>
      <td>
        <div className="gridlock-comparison-cell-stack">
          <span>{`${row.buildWindow.value}${row.buildWindow.unitSuffix} · ${unescapeAstProse(project.currentStatus)}`}</span>
          <span className="gridlock-comparison-sub">{row.buildWindow.rangeLabel}</span>
        </div>
      </td>
      <td>
        <span className="gridlock-citation-item">
          <CopyCitationButton
            key={`copy-${citationKey}`}
            value={citation.sha256}
            displayLabel={`sha256:${citation.sha256.slice(0, 12)}`}
            citationKind="Raw Capture SHA-256"
          />
          <a className="gridlock-citation-link" href={citation.sourceUrl} target="_blank" rel="noreferrer noopener">
            <span>{`${citation.connectorId} filing`}</span>
            {EXPORT_ARROW_ICON}
          </a>
        </span>
      </td>
    </tr>
  );
}

function MetricComparisonContent(props: { baseId: string; rows: readonly CitedProject[]; nodeId?: string }) {
  const { baseId, rows, nodeId } = props;
  const captionId = `${baseId}-caption`;
  const benchmark = buildComparisonBenchmarkModel(rows);
  const kpiItems = [
    {
      label: "Projects Benchmarked",
      value: benchmark.projectCount,
      sub: `${benchmark.uniqueCounties.length} ${benchmark.uniqueCounties.length === 1 ? "county" : "counties"} represented`,
      delay: 0.08,
    },
    {
      label: "Combined Capital",
      value: benchmark.combinedCapitalUsd,
      prefix: "$",
      sub: `peak $${benchmark.maxCapitalUsd.toLocaleString("en-US")} filing`,
      delay: 0.2,
    },
    {
      label: "Peak $/sq ft Density",
      value: benchmark.peakDensityUsdPerSqFt,
      prefix: "$",
      suffix: " / sq ft",
      sub: "highest capital intensity",
      delay: 0.32,
    },
  ];

  return (
    <>
      <header className="gridlock-repair-header">
        <DossierTitle baseId={baseId} title="Comparative Scale & Density Benchmark" />
        <div className="gridlock-header-controls">
          <DossierStatusBadge label={`${rows.length} project${rows.length === 1 ? "" : "s"}`} />
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="gridlock-empty-row" data-empty-comparison="true">
          {RELIEF_RETICLE_ICON}
          <span>0 projects selected for comparative density benchmarking.</span>
        </p>
      ) : (
        <>
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
                    <DossierNumber value={item.value} prefix={item.prefix} suffix={item.suffix} format={INTEGER_FORMAT} />
                  </strong>
                  <span className="gridlock-kpi-sub">{item.sub}</span>
                </dd>
              </motion.div>
            ))}
          </dl>

          <p className="gridlock-ast-lead">{benchmark.framingCopy}</p>

          <div tabIndex={0} role="region" aria-labelledby={captionId} className="gridlock-comparison-scroll">
            <table className="gridlock-comparison-table">
              <caption id={captionId}>
                {`Planner-ordered cohort benchmark (${benchmark.projectCount} ${benchmark.projectCount === 1 ? "project" : "projects"})`}
              </caption>
              {COMPARISON_TABLE_HEAD_NODE}
              <tbody>
                {benchmark.rows.map((row) => (
                  <ComparisonTableRow key={row.citedProject.project.projectNumber} row={row} nodeId={nodeId} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

export function MetricComparisonTable(props: MetricComparisonTableProps) {
  const { rows, nodeId, theme = "inherit", ref } = props;
  const baseId = useId();
  const parsed = MetricComparisonTableNodeSchema.safeParse({
    nodeId: nodeId ?? "standalone-metric-comparison",
    component: "MetricComparisonTable",
    rows,
  });

  return (
    <MotionConfig reducedMotion="user">
      <section
        ref={ref}
        aria-labelledby={`${baseId}-title`}
        className="gridlock-dossier-surface gridlock-ast-card gridlock-metric-comparison-table"
        data-gridlock-theme={theme}
        data-ast-card="MetricComparisonTable"
        data-node-id={nodeId}
      >
        {AST_CARD_STYLESHEET_NODE}
        {!parsed.success ? (
          <DossierErrorShell
            baseId={baseId}
            title="Comparative Scale & Density Benchmark"
            errorPrefix="Malformed MetricComparisonTable props:"
            message={parsed.error.issues[0]?.message ?? "Invalid metric comparison payload"}
          />
        ) : (
          <MetricComparisonContent baseId={baseId} rows={parsed.data.rows} nodeId={nodeId} />
        )}
      </section>
    </MotionConfig>
  );
}
