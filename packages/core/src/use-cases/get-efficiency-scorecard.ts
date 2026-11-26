import {
  EfficiencyScorecardSchema,
  type EfficiencyScorecard,
  type GridlockRepository,
  type ScorecardQueryOptions,
} from "../interfaces/index.ts";

export type GetEfficiencyScorecardResult =
  | { ok: true; scorecard: EfficiencyScorecard }
  | { ok: false; error: "efficiency_scorecard_error"; message: string };

export async function getEfficiencyScorecard(
  query: ScorecardQueryOptions,
  deps: {
    repository: Pick<GridlockRepository, "getEfficiencyScorecard">;
  }
): Promise<GetEfficiencyScorecardResult> {
  try {
    const scorecardCandidate = await deps.repository.getEfficiencyScorecard(query);
    const validatedScorecard =
      EfficiencyScorecardSchema.safeParse(scorecardCandidate);
    if (!validatedScorecard.success) {
      return {
        ok: false,
        error: "efficiency_scorecard_error",
        message:
          "Stored EfficiencyScorecard document failed runtime schema validation",
      };
    }

    return {
      ok: true,
      scorecard: validatedScorecard.data,
    };
  } catch (error) {
    return {
      ok: false,
      error: "efficiency_scorecard_error",
      message:
        error instanceof Error
          ? error.message
          : "Failed to read EfficiencyScorecard",
    };
  }
}
