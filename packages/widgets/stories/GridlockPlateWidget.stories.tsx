import type { ComponentType } from "react";
import {
  ARTIFACT_BUCKET_URI, CANONICAL_MILESTONE_LABEL, DEFAULT_LINEAGE_ID, PAINTER_AGENT_MODEL,
  PlateLineageResponseSchema, SCENARIO_BRANCH_WATERMARK,
  type LineageEdge, type LineageNode, type LineageSourceCitation, type Observation, type VisualPlate,
} from "@samasastudio/gridlock-core/schemas";
import { GridlockPlateWidget, type GridlockPlateWidgetProps } from "../src/index.ts";
import { makeMineralCorridorWebpUri } from "./mineral-corridor-webp.ts";

export interface StoryMeta<TProps> {
  title: string;
  component: ComponentType<TProps>;
  tags?: readonly string[];
}

export interface StoryObj<TProps> {
  args: TProps;
}

const [HASH_T1, HASH_T2, HASH_AGED] = ["a".repeat(64), "b".repeat(64), "c".repeat(64)];
const [WEBP_T1, WEBP_T2, WEBP_B3] = [
  makeMineralCorridorWebpUri("baseline"),
  makeMineralCorridorWebpUri("canonical"),
  makeMineralCorridorWebpUri("branch"),
];

function makeCitation(sha256: string, capturedAt: string): LineageSourceCitation {
  return {
    sha256, connectorId: "tdlr-tabs", capturedAt, referencedByMilestone: true,
    sourceUrl: `https://www.tdlr.texas.gov/TABS/Search/Project/${sha256.slice(0, 8)}`,
  };
}

function makeMilestoneObs(
  id: string, projectNumber: string, rawCaptureHash: string,
  observedAt: string, status: string, estimatedCostUsd: number, squareFootage: number, scopeOfWork: string
): Observation {
  return { id, projectNumber, rawCaptureHash, observedAt, status, estimatedCostUsd, squareFootage, scopeOfWork, isMilestone: true };
}

function makePlateNode(
  plate: Omit<VisualPlate, "lineageId" | "model" | "mimeType" | "byteLength">,
  triggeringObservations: Observation[],
  rawCaptures: LineageSourceCitation[]
): LineageNode {
  return {
    plate: { ...plate, lineageId: DEFAULT_LINEAGE_ID, model: PAINTER_AGENT_MODEL, mimeType: "image/webp", byteLength: 129_782 },
    assetPath: `/api/plates/assets/${plate.plateId}.webp`,
    triggeringObservations,
    rawCaptures,
  };
}

const OBS_T1 = makeMilestoneObs(
  "obs_tabs_3697_t1", "TABS2027003697", HASH_T1, "2026-10-27T14:00:00.000Z",
  "Project Registered", 125_000_000, 250_000, "250,000 sq ft hyperscale data center hall and 345kV substation yard"
);
const OBS_T2_PRIMARY = makeMilestoneObs(
  "obs_tabs_3697_t2", "TABS2027003697", HASH_T2, "2026-10-28T09:00:00.000Z",
  "Construction Started", 125_000_000, 250_000, "250,000 sq ft structural steel erection and chilled-water loop expansion"
);
const OBS_T2_SWITCHGEAR = makeMilestoneObs(
  "obs_tabs_4200_t2", "TABS2027004200", HASH_AGED, "2026-10-28T09:10:00.000Z",
  "Project Registered", 65_000_000, 140_000, "140,000 sq ft adjacent switchgear interconnect building"
);

const NODE_T1 = makePlateNode({
  plateId: "plate_corridor_t1", turnNumber: 1, interactionId: "inter_painter_t1",
  parentInteractionId: null, parentPlateId: null, rebootstrappedFromParentWebp: false,
  projectNumbers: ["TABS2027003697"], triggeringObservationIds: [OBS_T1.id], rawCaptureHashes: [HASH_T1],
  prompt: "Bootstrap Ellis County 345kV data center corridor plate from TABS2027003697",
  storageUri: `${ARTIFACT_BUCKET_URI}/plates/plate_corridor_t1.webp`, sha256: "1".repeat(64),
  isBranch: false, epistemicLabel: CANONICAL_MILESTONE_LABEL, watermarkText: null,
  createdAt: "2026-10-27T14:05:00.000Z", expiresAt: null,
}, [OBS_T1], [makeCitation(HASH_T1, "2026-10-27T14:00:00.000Z")]);

const NODE_T2 = makePlateNode({
  plateId: "plate_corridor_t2", turnNumber: 2, interactionId: "inter_painter_t2",
  parentInteractionId: "inter_painter_t1", parentPlateId: "plate_corridor_t1", rebootstrappedFromParentWebp: false,
  projectNumbers: ["TABS2027003697", "TABS2027004200"],
  triggeringObservationIds: [OBS_T2_PRIMARY.id, OBS_T2_SWITCHGEAR.id], rawCaptureHashes: [HASH_T2, HASH_AGED],
  prompt: "Paint chilled-water loop expansion and TABS2027004200 switchgear interconnect pad",
  storageUri: `${ARTIFACT_BUCKET_URI}/plates/plate_corridor_t2.webp`, sha256: "2".repeat(64),
  isBranch: false, epistemicLabel: CANONICAL_MILESTONE_LABEL, watermarkText: null,
  createdAt: "2026-10-28T09:15:00.000Z", expiresAt: null,
}, [OBS_T2_PRIMARY, OBS_T2_SWITCHGEAR], [makeCitation(HASH_T2, "2026-10-28T09:00:00.000Z")]);

const NODE_B3 = makePlateNode({
  plateId: "plate_branch_t3", turnNumber: 3, interactionId: "inter_painter_b3",
  parentInteractionId: "inter_painter_t2", parentPlateId: "plate_corridor_t2", rebootstrappedFromParentWebp: true,
  projectNumbers: ["TABS2027003697", "TABS2027004200"], triggeringObservationIds: [], rawCaptureHashes: [HASH_T2],
  prompt: "Project +400MW ERCOT 345kV substation queue delay reroute across Red Oak campus",
  storageUri: `${ARTIFACT_BUCKET_URI}/branches/ephemeral/plate_branch_t3.webp`, sha256: "3".repeat(64),
  isBranch: true, scenarioPrompt: "Simulate +400MW ERCOT 345kV substation queue delay across Red Oak campus",
  epistemicLabel: SCENARIO_BRANCH_WATERMARK, watermarkText: SCENARIO_BRANCH_WATERMARK,
  createdAt: "2026-10-29T11:00:00.000Z", expiresAt: "2027-01-27T11:00:00.000Z",
}, [], [makeCitation(HASH_T2, "2026-10-28T09:00:00.000Z")]);

const NODE_B4 = makePlateNode(
  {
    plateId: "plate_branch_t4",
    turnNumber: 4,
    interactionId: "inter_painter_b4",
    parentInteractionId: "inter_painter_b3",
    parentPlateId: "plate_branch_t3",
    rebootstrappedFromParentWebp: false,
    projectNumbers: ["TABS2027003697", "TABS2027004200"],
    triggeringObservationIds: [],
    rawCaptureHashes: [HASH_T2],
    prompt: "Project dual-feed 345kV transmission ring bus expansion north of Red Oak substation",
    storageUri: `${ARTIFACT_BUCKET_URI}/branches/ephemeral/plate_branch_t4.webp`,
    sha256: "4".repeat(64),
    isBranch: true,
    scenarioPrompt: "Model dual-feed 345kV transmission ring bus expansion north of Red Oak substation",
    epistemicLabel: SCENARIO_BRANCH_WATERMARK,
    watermarkText: SCENARIO_BRANCH_WATERMARK,
    createdAt: "2026-10-30T15:00:00.000Z",
    expiresAt: "2027-01-28T15:00:00.000Z",
  },
  [],
  [makeCitation(HASH_T2, "2026-10-28T09:00:00.000Z")]
);

function makeEdge(parent: LineageNode, child: LineageNode): LineageEdge {
  return {
    parentInteractionId: parent.plate.interactionId, childInteractionId: child.plate.interactionId,
    parentPlateId: parent.plate.plateId, childPlateId: child.plate.plateId, isBranch: child.plate.isBranch,
  };
}

function makeLineage(activeCanonicalPlateId: string | null, nodes: LineageNode[], edges: LineageEdge[] = []) {
  return PlateLineageResponseSchema.parse({ lineageId: DEFAULT_LINEAGE_ID, activeCanonicalPlateId, nodes, edges });
}

const EDGE_T1_T2 = makeEdge(NODE_T1, NODE_T2);
const FULL_LINEAGE = makeLineage(NODE_T2.plate.plateId, [NODE_T1, NODE_T2, NODE_B3], [EDGE_T1_T2, makeEdge(NODE_T2, NODE_B3)]);
const ALL_OVERRIDES = { plate_corridor_t1: WEBP_T1, plate_corridor_t2: WEBP_T2, plate_branch_t3: WEBP_B3 };

const plateWidgetMeta: StoryMeta<GridlockPlateWidgetProps> = {
  title: "Gridlock/Seam 3/GridlockPlateWidget",
  component: GridlockPlateWidget,
  tags: ["autodocs"],
};

export default plateWidgetMeta;

export const CanonicalAndBranchLineage: StoryObj<GridlockPlateWidgetProps> = {
  args: { lineage: FULL_LINEAGE, assetUrlOverrides: ALL_OVERRIDES, theme: "diurnal" },
};

export const ScenarioBranchSelected: StoryObj<GridlockPlateWidgetProps> = {
  args: { ...CanonicalAndBranchLineage.args, initialPlateId: "plate_branch_t3" },
};

export const SingleFrameBootstrap: StoryObj<GridlockPlateWidgetProps> = {
  args: { lineage: makeLineage(NODE_T1.plate.plateId, [NODE_T1]), assetUrlOverrides: { plate_corridor_t1: WEBP_T1 }, theme: "diurnal" },
};

export const EmptyLineage: StoryObj<GridlockPlateWidgetProps> = {
  args: { lineage: makeLineage(null, []), theme: "diurnal" },
};

export const BrokenAssetFallback: StoryObj<GridlockPlateWidgetProps> = {
  args: { lineage: makeLineage(NODE_T2.plate.plateId, [NODE_T1, NODE_T2], [EDGE_T1_T2]), assetUrlOverrides: { plate_corridor_t1: WEBP_T1 }, theme: "diurnal" },
};

export const NocturnalTheme: StoryObj<GridlockPlateWidgetProps> = {
  args: { ...CanonicalAndBranchLineage.args, theme: "nocturnal" },
};

export const MultiHopBranchComparison: StoryObj<GridlockPlateWidgetProps> = {
  args: {
    lineage: makeLineage(
      NODE_T2.plate.plateId,
      [NODE_T1, NODE_T2, NODE_B3, NODE_B4],
      [EDGE_T1_T2, makeEdge(NODE_T2, NODE_B3), makeEdge(NODE_B3, NODE_B4)]
    ),
    assetUrlOverrides: {
      ...ALL_OVERRIDES,
      plate_branch_t4: WEBP_B3,
    },
    initialPlateId: "plate_branch_t4",
    theme: "diurnal",
  },
};
