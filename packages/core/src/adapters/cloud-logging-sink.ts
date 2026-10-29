import {
  DEFAULT_GCP_PROJECT_ID,
  TelemetrySpanSchema,
  type TelemetrySpan,
  type TelemetrySpanSink,
} from "../interfaces/index.ts";

export function createCloudLoggingSpanSink(
  writer: (jsonLine: string) => void = (line) => {
    process.stdout.write(`${line}\n`);
  },
  projectId: string = process.env.GOOGLE_CLOUD_PROJECT ?? DEFAULT_GCP_PROJECT_ID
): TelemetrySpanSink {
  return (span: TelemetrySpan) => {
    const validated = TelemetrySpanSchema.parse(span);
    const isError =
      validated.status === "blocked_by_waf" ||
      validated.status === "selector_anomaly" ||
      validated.status === "aborted" ||
      validated.status === "agentic_failed";

    const cloudLogEntry: Record<string, unknown> = {
      severity: isError ? "WARNING" : "INFO",
      message: `[Gridlock Telemetry] stage=${validated.stage} mode=${validated.execution_mode} status=${validated.status} durationMs=${validated.durationMs} naiveTokensAvoided=${validated.naiveTokensAvoided} tokensUsed=${validated.tokensUsed}`,
      "logging.googleapis.com/trace": `projects/${projectId}/traces/${validated.traceId}`,
      "logging.googleapis.com/spanId": validated.spanId,
      stage: validated.stage,
      status: validated.status,
      execution_mode: validated.execution_mode,
      durationMs: validated.durationMs,
      tokensUsed: validated.tokensUsed,
      naiveTokensAvoided: validated.naiveTokensAvoided,
      startedAt: validated.startedAt,
      endedAt: validated.endedAt,
      ...(validated.interactionId !== undefined
        ? { interactionId: validated.interactionId }
        : {}),
      ...(validated.attributes !== undefined
        ? { attributes: validated.attributes }
        : {}),
    };

    writer(JSON.stringify(cloudLogEntry));
  };
}

export const defaultSpanSink: TelemetrySpanSink = createCloudLoggingSpanSink();
