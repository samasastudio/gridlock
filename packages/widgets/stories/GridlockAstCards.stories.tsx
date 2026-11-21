import type { CSSProperties, ComponentType } from "react";
import { GRIDLOCK_AST_CARD_STYLESHEET } from "../src/ast-card-styles.ts";
import {
  DossierStatusBadge,
  MetricComparisonTable,
  ObservationTimeline,
  ProjectDossierCard,
  type GridlockWidgetTheme,
} from "../src/index.ts";
import {
  DEFAULT_BRIEF_NODES,
  STORY_COMPUTE_CAMPUS_PROJECT,
  STORY_INTERLEAVED_OBSERVATIONS,
  STORY_LOGISTICS_SHELL_PROJECT,
  STORY_SUBSTATION_YARD_PROJECT,
  type AstPreviewNode,
} from "./ast-card-fixtures.ts";

export interface StoryMeta<TProps> {
  title: string;
  component: ComponentType<TProps>;
  tags?: readonly string[];
}

export interface StoryObj<TProps> {
  args: TProps;
}

export type AstShowcaseSurfaceMode = "brief-sheet" | "standalone";

export interface AstCardsShowcaseProps {
  nodes?: readonly AstPreviewNode[];
  surfaceMode?: AstShowcaseSurfaceMode;
  briefTitle?: string;
  theme?: GridlockWidgetTheme;
  apiBaseUrl?: string;
}

const AST_CARD_STYLESHEET_NODE = (
  <style href="gridlock-ast-cards" precedence="default">
    {GRIDLOCK_AST_CARD_STYLESHEET}
  </style>
);

const DEFAULT_BRIEF_TITLE =
  "Williamson–Hays 345kV Corridor Investigative Brief";

const BRIEF_HEADER_STYLE: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.75rem 1rem",
  paddingBlockEnd: "1.25rem",
};

const BRIEF_TITLE_STYLE: CSSProperties = {
  fontSize: "clamp(1.4rem, 1.18rem + 0.65cqi, 1.75rem)",
  fontWeight: 800,
  letterSpacing: "-0.025em",
  lineHeight: 1.12,
  minInlineSize: 0,
  overflowWrap: "anywhere",
};

const STANDALONE_STACK_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "1.75rem",
};

function renderAstPreviewNode(
  node: AstPreviewNode,
  cardTheme: GridlockWidgetTheme
) {
  switch (node.component) {
    case "ProjectDossierCard":
      return (
        <ProjectDossierCard
          key={node.nodeId}
          nodeId={node.nodeId}
          citedProject={node.citedProject}
          theme={cardTheme}
        />
      );
    case "ObservationTimeline":
      return (
        <ObservationTimeline
          key={node.nodeId}
          nodeId={node.nodeId}
          projectNumbers={node.projectNumbers}
          observations={node.observations}
          theme={cardTheme}
        />
      );
    case "MetricComparisonTable":
      return (
        <MetricComparisonTable
          key={node.nodeId}
          nodeId={node.nodeId}
          rows={node.rows}
          theme={cardTheme}
        />
      );
  }
}

function AstCardsShowcase(props: AstCardsShowcaseProps) {
  const nodes = props.nodes ?? DEFAULT_BRIEF_NODES;
  const surfaceMode = props.surfaceMode ?? "brief-sheet";
  const briefTitle = props.briefTitle ?? DEFAULT_BRIEF_TITLE;
  const theme = props.theme ?? "inherit";

  if (surfaceMode === "standalone") {
    if (nodes.length === 1) {
      return renderAstPreviewNode(nodes[0]!, theme);
    }

    return (
      <div style={STANDALONE_STACK_STYLE}>
        {nodes.map((node) => renderAstPreviewNode(node, theme))}
      </div>
    );
  }

  return (
    <article
      className="gridlock-dossier-surface"
      data-gridlock-theme={theme}
      data-source-mode={props.apiBaseUrl !== undefined ? "live-fallback" : "story"}
    >
      {AST_CARD_STYLESHEET_NODE}
      <header style={BRIEF_HEADER_STYLE}>
        <h2 style={BRIEF_TITLE_STYLE}>{briefTitle}</h2>
        <DossierStatusBadge
          label={`${nodes.length} verified AST card${nodes.length === 1 ? "" : "s"}`}
        />
      </header>
      {nodes.map((node) => renderAstPreviewNode(node, "inherit"))}
    </article>
  );
}

function makeStandaloneStory(
  node: AstPreviewNode
): StoryObj<AstCardsShowcaseProps> {
  return {
    args: {
      nodes: [node],
      surfaceMode: "standalone",
      theme: "diurnal",
    },
  };
}

const astCardsMeta: StoryMeta<AstCardsShowcaseProps> = {
  title: "Gridlock/Seam 4/GridlockAstCards",
  component: AstCardsShowcase,
  tags: ["autodocs"],
};

export default astCardsMeta;

export const InvestigativeBriefDiurnal: StoryObj<AstCardsShowcaseProps> = {
  args: {
    nodes: DEFAULT_BRIEF_NODES,
    surfaceMode: "brief-sheet",
    theme: "diurnal",
  },
};

export const InvestigativeBriefNocturnal: StoryObj<AstCardsShowcaseProps> = {
  args: {
    nodes: DEFAULT_BRIEF_NODES,
    surfaceMode: "brief-sheet",
    theme: "nocturnal",
  },
};

export const StandaloneProjectDossier = makeStandaloneStory({
  nodeId: "standalone-dossier",
  component: "ProjectDossierCard",
  citedProject: STORY_COMPUTE_CAMPUS_PROJECT,
});

export const MultiProjectObservationTimeline = makeStandaloneStory({
  nodeId: "standalone-timeline",
  component: "ObservationTimeline",
  projectNumbers: ["TABS2027003697", "TABS2027004112"],
  observations: STORY_INTERLEAVED_OBSERVATIONS,
});

export const CohortMetricComparison = makeStandaloneStory({
  nodeId: "standalone-comparison",
  component: "MetricComparisonTable",
  rows: [
    STORY_SUBSTATION_YARD_PROJECT,
    STORY_COMPUTE_CAMPUS_PROJECT,
    STORY_LOGISTICS_SHELL_PROJECT,
  ],
});

export const EmptyTimeline = makeStandaloneStory({
  nodeId: "standalone-empty-timeline",
  component: "ObservationTimeline",
  projectNumbers: ["TABS2027003697", "TABS2027004112"],
  observations: [],
});

export const EmptyComparisonTable = makeStandaloneStory({
  nodeId: "standalone-empty-comparison",
  component: "MetricComparisonTable",
  rows: [],
});
