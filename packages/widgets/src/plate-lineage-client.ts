import { PlateLineageResponseSchema, type PlateLineageResponse } from "@samasastudio/gridlock-core/schemas";

export interface PlateLineageQuery {
  apiBaseUrl: string;
  lineageId?: string;
}

export type PlateLineageSnapshotResult =
  | { ok: true; lineage: PlateLineageResponse }
  | { ok: false; message: string; statusCode?: number };

export function buildPlateLineageUrl(options: PlateLineageQuery): string {
  const base = options.apiBaseUrl.replace(/\/+$/, "");
  const trimmedId = options.lineageId?.trim();
  if (!trimmedId) return `${base}/api/plates/lineage`;
  const query = new URLSearchParams([["lineage_id", trimmedId]]).toString();
  return `${base}/api/plates/lineage?${query}`;
}

export function buildPlateAssetUrl(apiBaseUrl: string, assetPath: string): string {
  const base = apiBaseUrl.replace(/\/+$/, "");
  const normalizedPath = `/${assetPath.replace(/^\/+/, "")}`;
  return `${base}${normalizedPath}`;
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown };
    return typeof body.message === "string" && body.message.length > 0 ? body.message : fallback;
  } catch {
    return fallback;
  }
}

export async function fetchPlateLineageSnapshot(
  options: PlateLineageQuery & { signal?: AbortSignal }
): Promise<PlateLineageSnapshotResult> {
  try {
    const res = await globalThis.fetch(buildPlateLineageUrl(options), { signal: options.signal });
    if (!res.ok) {
      return {
        ok: false,
        statusCode: res.status,
        message: await readErrorMessage(res, `Plate Lineage HTTP ${res.status}`),
      };
    }
    const raw = await res.json();
    const parsed = PlateLineageResponseSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, message: "Malformed Plate Lineage payload" };
    }
    return { ok: true, lineage: parsed.data };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Network error loading Plate Lineage",
    };
  }
}
