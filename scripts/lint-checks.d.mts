export const NON_LINTABLE_GLOSSARY_WORDS: Set<string>;
export function parseGlossaryAvoidTerms(glossaryMarkdown: string): Array<{
  term: string;
  pattern: RegExp;
  useInstead: string;
}>;
export function loadBannedGlossaryTerms(repoRoot?: string): Array<{
  pattern: RegExp;
  useInstead: string;
}>;
export const BANNED_GLOSSARY_TERMS: ReadonlyArray<{
  pattern: RegExp;
  useInstead: string;
}>;
export const MAX_TSX_LINES: number;
export const MAX_CORE_TS_LINES: number;
export const PR_WARN_CHANGED_LINES: number;
export const MAX_PR_CHANGED_LINES: number;
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
export function evaluatePullRequestLineBudgetWarning(input: {
  insertions: number;
  deletions: number;
  baseRef: string;
  headRef?: string;
}): string | null;
export function checkPullRequestDiffSize(
  repoRoot: string,
  options?: { baseRef?: string; headRef?: string; workingTree?: boolean }
): {
  insertions: number;
  deletions: number;
  baseRef: string;
  headRef: string;
  violations: string[];
};
export function evaluateUnusedModuleExports(
  fileEntries: ReadonlyArray<{ relPath: string; content: string }>
): string[];
export function runRepoLintChecks(repoRoot?: string): string[];
export function evaluateBranchName(branchName: string): string[];
