import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface MockPortalRoute {
  status?: number;
  headers?: Record<string, string>;
  body: string;
}

export interface RecordedPortalRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface MockPortalServerHarness {
  server: Server;
  baseUrl: string;
  routeMap: Map<string, MockPortalRoute>;
  recordedRequests: RecordedPortalRequest[];
  getMaxInFlightSeen(): number;
  close(): Promise<void>;
}

export async function startMockPortalServer(options?: {
  defaultRobotsAllowAll?: boolean;
}): Promise<MockPortalServerHarness> {
  const routeMap = new Map<string, MockPortalRoute>();
  if (options?.defaultRobotsAllowAll) {
    routeMap.set("/robots.txt", {
      status: 200,
      headers: { "content-type": "text/plain" },
      body: "User-agent: *\nAllow: /\n",
    });
  }

  const recordedRequests: RecordedPortalRequest[] = [];
  let currentInFlight = 0;
  let maxInFlightSeen = 0;

  const server = createServer((req, res) => {
    currentInFlight += 1;
    if (currentInFlight > maxInFlightSeen) {
      maxInFlightSeen = currentInFlight;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf-8");
      recordedRequests.push({
        method: req.method ?? "GET",
        url: req.url ?? "",
        headers: req.headers,
        body: rawBody,
      });
      const route = routeMap.get(req.url ?? "");
      if (!route) {
        currentInFlight -= 1;
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("Not Found");
        return;
      }
      res.writeHead(route.status ?? 200, {
        "content-type": "text/html; charset=utf-8",
        ...(route.headers ?? {}),
      });
      res.end(route.body, () => {
        currentInFlight -= 1;
      });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    server,
    baseUrl,
    routeMap,
    recordedRequests,
    getMaxInFlightSeen: () => maxInFlightSeen,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}
