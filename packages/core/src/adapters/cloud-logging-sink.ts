import {
  DEFAULT_GCP_PROJECT_ID,
  RunSpanSchema,
  type RunSpan,
  type RunSpanSink,
} from "../interfaces/index.ts";

export function createCloudLoggingSpanSink(
  writer: (jsonLine: string) => void = (line) => {
    process.stdout.write(`${line}\n`);
  },
  projectId: string = process.env.GOOGLE_CLOUD_PROJECT ?? DEFAULT_GCP_PROJECT_ID
): RunSpanSink {
  return (span: RunSpan) => {
    const validated = RunSpanSchema.parse(span);
    const isError =
      validated.status === "blocked_by_waf" ||
      validated.status === "selector_anomaly" ||
      validated.status === "aborted" ||
      validated.status === "agentic_failed";

    const cloudLogEntry: Record<string, unknown> = {
      severity: isError ? "WARNING" : "INFO",
      message: `[Gridlock Run] stage=${validated.stage} mode=${validated.execution_mode} status=${validated.status} durationMs=${validated.durationMs} naiveTokensAvoided=${validated.naiveTokensAvoided} tokensUsed=${validated.tokensUsed}`,
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

export const defaultSpanSink: RunSpanSink = createCloudLoggingSpanSink();
