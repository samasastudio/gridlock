import type ts from "typescript";

export function evaluateProgramTypeHygiene(
  program: ts.Program,
  repoRoot: string
): string[];
export function runTypeHygieneChecks(repoRoot?: string): string[];
