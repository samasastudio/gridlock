export const BANNED_GLOSSARY_TERMS: ReadonlyArray<{
  pattern: RegExp;
  useInstead: string;
}>;
export const MAX_TSX_LINES: number;
export const MAX_CORE_TS_LINES: number;
export const ALLOWED_CORE_TOP_DIRS: Set<string>;
export function evaluateSourceFileLintRules(
  relPathRaw: string,
  content: string
): string[];
export function evaluatePullRequestLineBudget(input: {
  insertions: number;
  deletions: number;
  baseRef: string;
  headRef?: string;
}): string[];
export function checkPullRequestDiffSize(
  repoRoot: string,
  options?: { baseRef?: string; headRef?: string }
): {
  insertions: number;
  deletions: number;
  baseRef: string;
  headRef: string;
  violations: string[];
};
export function runRepoLintChecks(repoRoot?: string): string[];
