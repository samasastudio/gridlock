import { GoogleGenAI, type Interactions } from "@google/genai";
import type {
  GeminiInteractionCreateRequest,
  GeminiInteractionError,
  GeminiInteractionImageBlock,
  GeminiInteractionResponse,
  GeminiInteractionsClient,
} from "../interfaces/index.ts";

type GeminiSdkCreateInteractionParams =
  Interactions.CreateModelInteractionParamsNonStreaming;

export interface GeminiInteractionsAdapterOptions {
  apiKey?: string;
  sdkClient?: {
    interactions: {
      create(params: GeminiSdkCreateInteractionParams): Promise<unknown>;
    };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveSdkClient(
  options: GeminiInteractionsAdapterOptions
): NonNullable<GeminiInteractionsAdapterOptions["sdkClient"]> {
  if (options.sdkClient !== undefined) {
    return options.sdkClient;
  }
  const trimmedKey = options.apiKey?.trim() ?? "";
  if (trimmedKey.length === 0) {
    throw new Error(
      "createGeminiInteractionsClient requires a non-empty Gemini API key or sdkClient"
    );
  }
  const ai = new GoogleGenAI({ apiKey: trimmedKey });
  return {
    interactions: {
      create: (params) => ai.interactions.create(params),
    },
  };
}

function isFlatContentBlock(item: unknown): item is Interactions.Content {
  return isRecord(item) && (item.type === "text" || item.type === "image");
}

function normalizeSdkInput(
  input: GeminiInteractionCreateRequest["input"]
): Interactions.CreateModelInteractionParamsNonStreaming["input"] {
  if (!Array.isArray(input) || input.length === 0) {
    return typeof input === "string" ? input : [];
  }
  if (input.every(isFlatContentBlock)) {
    return [{ type: "user_input", content: input }];
  }
  return input as Interactions.Step[];
}

function buildSdkRequestPayload(
  request: GeminiInteractionCreateRequest
): GeminiSdkCreateInteractionParams {
  const format = request.response_format;
  const responseFormat: GeminiSdkCreateInteractionParams["response_format"] =
    format === undefined
      ? undefined
      : format.type === "text"
        ? {
            type: "text",
            mime_type: format.mime_type,
            ...(format.schema !== undefined ? { schema: format.schema } : {}),
          }
        : {
            type: "image",
            ...(format.mime_type !== undefined
              ? { mime_type: format.mime_type }
              : {}),
            ...(format.aspect_ratio !== undefined
              ? { aspect_ratio: format.aspect_ratio }
              : {}),
            ...(format.image_size !== undefined
              ? { image_size: format.image_size }
              : {}),
          };

  return {
    model: request.model,
    input: normalizeSdkInput(request.input),
    ...(request.previous_interaction_id !== undefined
      ? { previous_interaction_id: request.previous_interaction_id }
      : {}),
    ...(request.store !== undefined ? { store: request.store } : {}),
    ...(responseFormat !== undefined
      ? { response_format: responseFormat }
      : {}),
  };
}

function collectTrailingModelBlocks(
  raw: Record<string, unknown>
): Record<string, unknown>[] {
  const steps = Array.isArray(raw.steps) ? raw.steps.filter(isRecord) : [];
  const lastUserIdx = steps.reduce(
    (foundIdx, step, idx) => (step.type === "user_input" ? idx : foundIdx),
    -1
  );
  const trailingSteps =
    lastUserIdx >= 0 ? steps.slice(lastUserIdx + 1) : steps;
  const stepBlocks = trailingSteps
    .filter(
      (step) => step.type === "model_output" && Array.isArray(step.content)
    )
    .flatMap((step) => (step.content as unknown[]).filter(isRecord));
  if (stepBlocks.length > 0) {
    return stepBlocks;
  }
  return Array.isArray(raw.outputs) ? raw.outputs.filter(isRecord) : [];
}

function normalizeImageBlock(
  candidate: unknown
): GeminiInteractionImageBlock | null {
  if (!isRecord(candidate)) {
    return null;
  }
  const data = typeof candidate.data === "string" ? candidate.data : undefined;
  const mimeType =
    typeof candidate.mime_type === "string" ? candidate.mime_type : undefined;
  if (data === undefined && mimeType === undefined) {
    return null;
  }
  return {
    ...(data !== undefined ? { data } : {}),
    ...(mimeType !== undefined ? { mime_type: mimeType } : {}),
  };
}

function normalizeErrorEntry(entry: unknown): GeminiInteractionError | null {
  if (!isRecord(entry)) {
    return null;
  }
  const code =
    typeof entry.code === "string"
      ? entry.code
      : typeof entry.code === "number"
        ? String(entry.code)
        : undefined;
  const message =
    typeof entry.message === "string" ? entry.message : undefined;
  if (code === undefined && message === undefined) {
    return null;
  }
  return {
    ...(code !== undefined ? { code } : {}),
    ...(message !== undefined ? { message } : {}),
  };
}

function normalizeInteractionResponse(
  rawValue: unknown
): GeminiInteractionResponse {
  const raw = isRecord(rawValue) ? rawValue : {};
  const trailingBlocks = collectTrailingModelBlocks(raw);
  const stepTexts = trailingBlocks
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string);
  const outputText =
    typeof raw.output_text === "string"
      ? raw.output_text
      : stepTexts.length > 0
        ? stepTexts.join("")
        : raw.output_text === null
          ? null
          : undefined;

  const directImage = normalizeImageBlock(raw.output_image);
  const stepImage =
    [...trailingBlocks]
      .reverse()
      .map((block) =>
        block.type === "image" ? normalizeImageBlock(block) : null
      )
      .find((img): img is GeminiInteractionImageBlock => img !== null) ?? null;
  const outputImage =
    directImage ?? (stepImage ?? (raw.output_image === null ? null : undefined));

  const arrayErrors = Array.isArray(raw.errors)
    ? raw.errors
        .map(normalizeErrorEntry)
        .filter((err): err is GeminiInteractionError => err !== null)
    : [];
  const singularError = normalizeErrorEntry(raw.error);
  const errors =
    singularError !== null ? [...arrayErrors, singularError] : arrayErrors;

  const rawUsage = isRecord(raw.usage) ? raw.usage : null;
  const totalTokens =
    typeof rawUsage?.total_tokens === "number"
      ? rawUsage.total_tokens
      : undefined;

  return {
    id: typeof raw.id === "string" ? raw.id : "",
    ...(typeof raw.status === "string" ? { status: raw.status } : {}),
    ...(typeof raw.previous_interaction_id === "string"
      ? { previous_interaction_id: raw.previous_interaction_id }
      : {}),
    ...(outputText !== undefined ? { output_text: outputText } : {}),
    ...(outputImage !== undefined ? { output_image: outputImage } : {}),
    ...(errors.length > 0 ? { errors } : {}),
    ...(rawUsage !== null
      ? {
          usage:
            totalTokens !== undefined ? { total_tokens: totalTokens } : {},
        }
      : {}),
  };
}

export function createGeminiInteractionsClient(
  options: GeminiInteractionsAdapterOptions
): GeminiInteractionsClient {
  const sdkClient = resolveSdkClient(options);
  return {
    interactions: {
      async create(
        request: GeminiInteractionCreateRequest
      ): Promise<GeminiInteractionResponse> {
        const raw = await sdkClient.interactions.create(
          buildSdkRequestPayload(request)
        );
        return normalizeInteractionResponse(raw);
      },
    },
  };
}
