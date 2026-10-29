import {
  GRIDLOCK_USER_AGENT,
  type PageLoader,
  type PageLoaderResponse,
  type SearchLoader,
} from "../interfaces/index.ts";

export interface PlaywrightPageLike {
  goto(
    url: string,
    options?: { waitUntil?: "domcontentloaded" | "load" | "networkidle" }
  ): Promise<{
    status(): number;
    headers(): Record<string, string>;
  } | null>;
  content(): Promise<string>;
}

export function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}

export function createPlaywrightPageLoader(
  page: PlaywrightPageLike
): PageLoader {
  return async (url: string): Promise<PageLoaderResponse> => {
    const response = await page.goto(url, { waitUntil: "domcontentloaded" });
    const body = await page.content();
    const headers = response?.headers() ?? {};
    return {
      status: response?.status() ?? 200,
      contentType: headers["content-type"] ?? "text/html; charset=utf-8",
      body,
      headers,
    };
  };
}

export const defaultPageLoader: PageLoader = async (url: string) => {
  const response = await fetch(url, {
    headers: {
      "user-agent": GRIDLOCK_USER_AGENT,
      accept: "text/html,application/xhtml+xml",
    },
  });
  const body = await response.text();
  return {
    status: response.status,
    contentType:
      response.headers.get("content-type") ?? "text/html; charset=utf-8",
    body,
    headers: headersToRecord(response.headers),
  };
};

export const defaultSearchLoader: SearchLoader = async (
  url: string,
  formBody: string
): Promise<PageLoaderResponse> => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "user-agent": GRIDLOCK_USER_AGENT,
      "x-requested-with": "XMLHttpRequest",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      accept: "application/json, text/javascript, */*; q=0.01",
    },
    body: formBody,
  });
  const body = await response.text();
  return {
    status: response.status,
    contentType:
      response.headers.get("content-type") ?? "application/json; charset=utf-8",
    body,
    headers: headersToRecord(response.headers),
  };
};
