import type {
  RepairChangelogEntry,
  RepairChangelogResponse,
} from "../../interfaces/index.ts";

function formatMarkdownCodeSpan(value: string, escapeTablePipes = false): string {
  if (value.length === 0) {
    return "_(empty)_";
  }
  const singleLine = value.replace(/\r?\n/g, " ");
  const sanitized = escapeTablePipes ? singleLine.replace(/\|/g, "\\|") : singleLine;
  const backtickRuns = sanitized.match(/`+/g) ?? [];
  const maxRun = backtickRuns.reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(maxRun + 1);
  const needsPadding =
    sanitized.trim().length > 0 &&
    (maxRun > 0 || sanitized.startsWith(" ") || sanitized.endsWith(" "));
  return needsPadding ? `${fence} ${sanitized} ${fence}` : `${fence}${sanitized}${fence}`;
}

function formatMarkdownProse(value: string): string {
  return value
    .replace(/\s*\r?\n\s*/g, " ")
    .trim()
    .replace(/[\\<>{}`*_~[\]]/g, "\\$&");
}

function formatEntrySection(entry: RepairChangelogEntry): string {
  const diffRows = entry.selectorDiffs.map(
    (diff) =>
      `| ${formatMarkdownCodeSpan(diff.field, true)} | ${formatMarkdownCodeSpan(diff.before, true)} | ${formatMarkdownCodeSpan(diff.after, true)} |`
  );

  return [
    `## v${entry.previousVersion} -> v${entry.promotedVersion} (${entry.patchPromotedAt})`,
    "",
    `- **Repair ID**: ${formatMarkdownCodeSpan(entry.id)} · **Interaction**: ${formatMarkdownCodeSpan(entry.interactionId)}`,
    `- **Quarantined Source Artifact**: \`sha256:${entry.quarantinedArtifactHash}\``,
    `- **Root Cause**: ${formatMarkdownProse(entry.rootCauseSummary)}`,
    `- **Broken Invariants**: ${entry.brokenInvariants.map(formatMarkdownProse).join("; ")}`,
    `- **Sandbox Replay Gate**: ${entry.historicalFixturesPassed}/${entry.historicalFixturesTested} historical fixtures passed (${entry.totalFixturesVerified} total verified)`,
    `- **Autonomous MTTR**: ${entry.mttrMs} ms (detected \`${entry.anomalyDetectedAt}\`, promoted \`${entry.patchPromotedAt}\`)`,
    `- **Repair Cost & Amortization**: ${entry.repairTokensUsed} tokens ($${entry.estimatedRepairCostUsd.toFixed(6)}) · ${entry.subsequentDeterministicRunsServed} subsequent deterministic runs served`,
    "",
    "| Field | Before | After |",
    "| :--- | :--- | :--- |",
    ...diffRows,
  ].join("\n");
}

export function formatRepairChangelogMarkdown(
  changelog: RepairChangelogResponse,
  totals?: {
    totalHealsCount: number;
    totalAmortizedRuns: number;
  }
): string {
  const totalHealsCount = totals?.totalHealsCount ?? changelog.entries.length;
  const totalAmortizedRuns =
    totals?.totalAmortizedRuns ??
    changelog.entries.reduce((sum, entry) => sum + entry.subsequentDeterministicRunsServed, 0);
  const healsSummary =
    changelog.entries.length < totalHealsCount
      ? `${totalHealsCount} (showing latest ${changelog.entries.length})`
      : `${totalHealsCount}`;

  const headerLines = [
    `# Gridlock Repair Changelog — ${formatMarkdownProse(changelog.connectorId)}`,
    "",
    `- **Connector Status**: \`${changelog.connectorStatus}\``,
    `- **Active Config Version**: \`v${changelog.activeVersion}\``,
    `- **Verified Autonomous Heals**: ${healsSummary}`,
    `- **Total Subsequent Deterministic Runs Served**: ${totalAmortizedRuns}`,
    "",
  ];

  if (changelog.entries.length === 0) {
    const emptyBody =
      changelog.connectorStatus === "healthy"
        ? `No autonomous selector repairs recorded — 100% deterministic uptime on ConnectorConfig \`v${changelog.activeVersion}\`.`
        : `Connector currently in \`${changelog.connectorStatus}\` state with 0 promoted selector repairs on ConnectorConfig \`v${changelog.activeVersion}\`.`;
    return [...headerLines, emptyBody, ""].join("\n");
  }

  return [...headerLines, changelog.entries.map(formatEntrySection).join("\n\n"), ""].join("\n");
}
