import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  ConnectorConfigSchema,
  type CandidateSelectorPatch,
  type ConnectorConfig,
  type SandboxReplayResult,
  type SelectorDiffEntry,
  type TdlrFieldLabels,
} from "../../interfaces/index.ts";
import { parseTdlrFilingHtml } from "./tdlr-parser.ts";

const TOP_SELECTOR_FIELDS = [
  "detailContainerSelector",
  "definitionListSelector",
  "termSelector",
  "descriptionSelector",
] as const;

function buildCandidateConfig(
  currentConfig: ConnectorConfig,
  patch: CandidateSelectorPatch,
  nowIso: string
): ConnectorConfig {
  const mergedLabels: TdlrFieldLabels = {
    ...currentConfig.fieldLabels,
    ...(patch.fieldLabels ?? {}),
  };

  return ConnectorConfigSchema.parse({
    ...currentConfig,
    version: currentConfig.version + 1,
    status: "healthy",
    detailContainerSelector:
      patch.detailContainerSelector ?? currentConfig.detailContainerSelector,
    definitionListSelector:
      patch.definitionListSelector ?? currentConfig.definitionListSelector,
    termSelector: patch.termSelector ?? currentConfig.termSelector,
    descriptionSelector:
      patch.descriptionSelector ?? currentConfig.descriptionSelector,
    fieldLabels: mergedLabels,
    updatedAt: nowIso,
  });
}

function computeSelectorDiffs(
  currentConfig: ConnectorConfig,
  candidateConfig: ConnectorConfig
): SelectorDiffEntry[] {
  const topLevelDiffs: SelectorDiffEntry[] = TOP_SELECTOR_FIELDS.filter(
    (field) => currentConfig[field] !== candidateConfig[field]
  ).map((field) => ({
    field,
    before: currentConfig[field],
    after: candidateConfig[field],
  }));

  const labelKeys = Object.keys(
    candidateConfig.fieldLabels
  ) as Array<keyof TdlrFieldLabels>;

  const fieldLabelDiffs: SelectorDiffEntry[] = labelKeys
    .map((key) => ({
      field: `fieldLabels.${key}`,
      before: currentConfig.fieldLabels[key] ?? "",
      after: candidateConfig.fieldLabels[key] ?? "",
    }))
    .filter((diff) => diff.before !== diff.after);

  return [...topLevelDiffs, ...fieldLabelDiffs];
}

function replayHtmlFixture(
  html: string,
  candidateConfig: ConnectorConfig,
  nowIso: string
) {
  const sha256 = createHash("sha256")
    .update(Buffer.from(html, "utf-8"))
    .digest("hex");
  return parseTdlrFilingHtml(html, candidateConfig, { sha256, nowIso });
}

export function evaluateSandboxReplayGate(input: {
  currentConfig: ConnectorConfig;
  patch: CandidateSelectorPatch;
  quarantinedHtml: string;
  historicalFixtures: readonly string[];
  nowIso: string;
}): SandboxReplayResult {
  const { currentConfig, patch, quarantinedHtml, historicalFixtures, nowIso } =
    input;

  const candidateConfig = buildCandidateConfig(currentConfig, patch, nowIso);
  const selectorDiffs = computeSelectorDiffs(currentConfig, candidateConfig);

  const prerequisiteFailures = [
    ...(selectorDiffs.length === 0
      ? ["Candidate patch produced zero selector diffs"]
      : []),
    ...(historicalFixtures.length === 0
      ? [
          "At least 1 historical fixture is required for Sandbox Replay Gate verification",
        ]
      : []),
  ];

  const quarantinedParse = replayHtmlFixture(
    quarantinedHtml,
    candidateConfig,
    nowIso
  );
  const quarantinedPassed = quarantinedParse.ok;
  const quarantinedFailures = quarantinedParse.ok
    ? []
    : [
        `Quarantined artifact failed replay: ${quarantinedParse.invariantErrors.join("; ")}`,
      ];

  const historicalOutcomes = historicalFixtures.map((fixtureHtml, index) => ({
    index,
    result: replayHtmlFixture(fixtureHtml, candidateConfig, nowIso),
  }));

  const historicalFixturesPassed = historicalOutcomes.filter(
    (item) => item.result.ok
  ).length;

  const historicalFailures = historicalOutcomes.flatMap((item) =>
    item.result.ok
      ? []
      : [
          `Historical fixture #${item.index + 1} regressed: ${item.result.invariantErrors.join("; ")}`,
        ]
  );

  const failureReasons = [
    ...prerequisiteFailures,
    ...quarantinedFailures,
    ...historicalFailures,
  ];

  const passed =
    selectorDiffs.length > 0 &&
    historicalFixtures.length > 0 &&
    quarantinedPassed &&
    historicalFixturesPassed === historicalFixtures.length;

  return {
    passed,
    candidateConfig,
    selectorDiffs,
    quarantinedPassed,
    historicalFixturesTested: historicalFixtures.length,
    historicalFixturesPassed,
    totalFixturesVerified:
      historicalFixturesPassed + (quarantinedPassed ? 1 : 0),
    failureReasons,
  };
}
