import {
  EfficiencyLedgerSchema,
  type EfficiencyLedger,
  type GridlockRepository,
  type TelemetryLedgerQueryOptions,
} from "../interfaces/index.ts";

export type GetEfficiencyScorecardResult =
  | { ok: true; ledger: EfficiencyLedger }
  | { ok: false; error: "telemetry_ledger_error"; message: string };

export async function getEfficiencyScorecard(
  query: TelemetryLedgerQueryOptions,
  deps: {
    repository: Pick<GridlockRepository, "getEfficiencyLedger">;
  }
): Promise<GetEfficiencyScorecardResult> {
  try {
    const ledgerCandidate = await deps.repository.getEfficiencyLedger(query);
    const validatedLedger = EfficiencyLedgerSchema.safeParse(ledgerCandidate);
    if (!validatedLedger.success) {
      return {
        ok: false,
        error: "telemetry_ledger_error",
        message:
          "Stored EfficiencyLedger document failed runtime schema validation",
      };
    }

    return {
      ok: true,
      ledger: validatedLedger.data,
    };
  } catch (error) {
    return {
      ok: false,
      error: "telemetry_ledger_error",
      message:
        error instanceof Error
          ? error.message
          : "Failed to read EfficiencyLedger telemetry",
    };
  }
}
