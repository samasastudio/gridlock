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

export function evaluateSandboxReplayGate(input: {
  currentConfig: ConnectorConfig;
  patch: CandidateSelectorPatch;
  quarantinedHtml: string;
  historicalFixtures: readonly string[];
  nowIso: string;
}): SandboxReplayResult {
  const { currentConfig, patch, quarantinedHtml, historicalFixtures, nowIso } =
    input;

  const mergedLabels: TdlrFieldLabels = {
    ...currentConfig.fieldLabels,
    ...(patch.fieldLabels ?? {}),
  };

  const candidateConfig = ConnectorConfigSchema.parse({
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

  const selectorDiffs: SelectorDiffEntry[] = [];
  const topFields = [
    "detailContainerSelector",
    "definitionListSelector",
    "termSelector",
    "descriptionSelector",
  ] as const;

  for (const field of topFields) {
    if (currentConfig[field] !== candidateConfig[field]) {
      selectorDiffs.push({
        field,
        before: currentConfig[field],
        after: candidateConfig[field],
      });
    }
  }

  for (const key of Object.keys(
    candidateConfig.fieldLabels
  ) as Array<keyof TdlrFieldLabels>) {
    const beforeVal = currentConfig.fieldLabels[key] ?? "";
    const afterVal = candidateConfig.fieldLabels[key] ?? "";
    if (beforeVal !== afterVal) {
      selectorDiffs.push({
        field: `fieldLabels.${key}`,
        before: beforeVal,
        after: afterVal,
      });
    }
  }

  const failureReasons: string[] = [];
  if (selectorDiffs.length === 0) {
    failureReasons.push("Candidate patch produced zero selector diffs");
  }
  if (historicalFixtures.length === 0) {
    failureReasons.push(
      "At least 1 historical fixture is required for Sandbox Replay Gate verification"
    );
  }

  const replayFixture = (html: string) => {
    const sha256 = createHash("sha256")
      .update(Buffer.from(html, "utf-8"))
      .digest("hex");
    return parseTdlrFilingHtml(html, candidateConfig, { sha256, nowIso });
  };

  const quarantinedParse = replayFixture(quarantinedHtml);
  const quarantinedPassed = quarantinedParse.ok;
  if (!quarantinedParse.ok) {
    failureReasons.push(
      `Quarantined artifact failed replay: ${quarantinedParse.invariantErrors.join("; ")}`
    );
  }

  let historicalFixturesPassed = 0;
  for (let i = 0; i < historicalFixtures.length; i += 1) {
    const parsed = replayFixture(historicalFixtures[i]!);
    if (parsed.ok) {
      historicalFixturesPassed += 1;
    } else {
      failureReasons.push(
        `Historical fixture #${i + 1} regressed: ${parsed.invariantErrors.join("; ")}`
      );
    }
  }

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
