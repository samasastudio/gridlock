export interface DossierHttpError {
  ok: false;
  message: string;
  statusCode?: number;
  errorCode?: string;
}

export type ValidatedJsonResult<TData> =
  | { ok: true; data: TData }
  | DossierHttpError;

interface SafeParseSchema<TData> {
  safeParse(input: unknown): { success: true; data: TData } | { success: false };
}

export interface FetchValidatedJsonOptions<TData> {
  url: string;
  schema: SafeParseSchema<TData>;
  resourceLabel: string;
  malformedMessage?: string;
  networkErrorVerb?: string;
  init?: RequestInit;
}

export function buildApiEndpointUrl(
  apiBaseUrl: string,
  pathname: string,
  params?: Readonly<Record<string, string | number | undefined>>
): string {
  const base = apiBaseUrl.replace(/\/+$/, "");
  const normalizedPath = `/${pathname.replace(/^\/+/, "")}`;
  if (!params) return `${base}${normalizedPath}`;
  const entries = Object.entries(params)
    .map(([key, value]): [string, string] | null => {
      if (value === undefined) return null;
      const serialized = typeof value === "string" ? value.trim() : String(value);
      return serialized.length > 0 ? [key, serialized] : null;
    })
    .filter((entry): entry is [string, string] => entry !== null);
  const query = new URLSearchParams(entries).toString();
  return query ? `${base}${normalizedPath}?${query}` : `${base}${normalizedPath}`;
}

async function parseJsonBody(
  res: Response
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    const value: unknown = await res.json();
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

async function readErrorEnvelope(
  res: Response,
  fallback: string
): Promise<{ message: string; errorCode?: string }> {
  const parsed = await parseJsonBody(res);
  const body =
    parsed.ok && typeof parsed.value === "object" && parsed.value !== null
      ? (parsed.value as { error?: unknown; message?: unknown })
      : null;

  const message =
    typeof body?.message === "string" && body.message.length > 0 ? body.message : fallback;
  const errorCode =
    typeof body?.error === "string" && body.error.length > 0 ? body.error : undefined;

  return errorCode !== undefined ? { message, errorCode } : { message };
}

export async function fetchValidatedJson<TData>(
  options: FetchValidatedJsonOptions<TData>
): Promise<ValidatedJsonResult<TData>> {
  const verb = options.networkErrorVerb ?? "loading";
  try {
    const response = await globalThis.fetch(options.url, options.init);
    if (!response.ok) {
      const envelope = await readErrorEnvelope(
        response,
        `${options.resourceLabel} HTTP ${response.status}`
      );
      return { ok: false, statusCode: response.status, ...envelope };
    }
    const rawBody = await parseJsonBody(response);
    const parsed = rawBody.ok ? options.schema.safeParse(rawBody.value) : null;
    if (!parsed?.success) {
      return {
        ok: false,
        message: options.malformedMessage ?? `Malformed ${options.resourceLabel} payload`,
      };
    }
    return { ok: true, data: parsed.data };
  } catch (error: unknown) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : `Network error ${verb} ${options.resourceLabel}`,
    };
  }
}
