import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import {
  ARTIFACT_BUCKET_URI,
  bootstrapCanvas,
  branchLineage,
  createCorridorBaseCanvasWebp,
  createInMemoryGridlockRepository,
  DEFAULT_TDLR_CONNECTOR_CONFIG,
  handleGridlockHttpRequest,
  isWebpBuffer,
  ObservationSchema,
  paintMilestoneDelta,
  ProjectSchema,
  RawCaptureSchema,
} from "../packages/core/src/index.ts";
import { HealedWithAmortization } from "../packages/widgets/stories/GridlockRepairChangelogWidget.stories.tsx";

const GRIDLOCK_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE_SITE_ROOT = resolve(GRIDLOCK_ROOT, "../profile-site");
const STORIES_DIR = join(GRIDLOCK_ROOT, "packages/widgets/stories");
const IS_SMOKE_CHECK = process.argv.includes("--smoke-check");
const PORT = IS_SMOKE_CHECK ? 0 : Number(process.env.PORT ?? 6006);
const HOST = process.env.HOST ?? (IS_SMOKE_CHECK ? "127.0.0.1" : existsSync("/mnt/shared") ? "0.0.0.0" : "127.0.0.1");

const healedArgs = HealedWithAmortization.args;
const baseRepo = createInMemoryGridlockRepository(DEFAULT_TDLR_CONNECTOR_CONFIG, healedArgs.efficiencyScorecard);
if (healedArgs.changelog && healedArgs.efficiencyScorecard) {
  let activeCfg = { ...DEFAULT_TDLR_CONNECTOR_CONFIG, fieldLabels: { ...DEFAULT_TDLR_CONNECTOR_CONFIG.fieldLabels } };
  for (const entry of healedArgs.changelog.entries) {
    activeCfg = { ...activeCfg, version: entry.promotedVersion, fieldLabels: { ...activeCfg.fieldLabels } };
    for (const diff of entry.selectorDiffs) {
      if (diff.field.startsWith("fieldLabels.")) {
        activeCfg.fieldLabels[diff.field.slice("fieldLabels.".length)] = diff.after;
      } else {
        activeCfg[diff.field] = diff.after;
      }
    }
    await baseRepo.promoteConnectorConfig(activeCfg, entry, { updatedScorecard: healedArgs.efficiencyScorecard });
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDaysFrom(anchorMs, daysDelta) {
  return new Date(anchorMs + daysDelta * DAY_MS).toISOString();
}

function buildWorkbenchArtifact(sha256, capturedAt, expiresAt) {
  return RawCaptureSchema.parse({
    sha256,
    connectorId: "tdlr-tabs",
    sourceUrl: `https://www.tdlr.texas.gov/TABS/Search/Project/${sha256.slice(0, 8)}`,
    contentType: "text/html",
    rawByteLength: 512,
    compressedByteLength: 128,
    storageUri: `${ARTIFACT_BUCKET_URI}/artifacts/${sha256}.gz`,
    capturedAt,
    expiresAt,
    referencedByMilestone: false,
  });
}

async function seedWorkbenchPlateLineage(repo) {
  const anchorMs = Date.now();
  const [hashT1, hashT2, hashAged] = ["a".repeat(64), "b".repeat(64), "c".repeat(64)];
  const gzBytes = Buffer.from("gridlock-workbench-gz");
  const painterState = { seq: 0 };

  const projects = [
    ProjectSchema.parse({
      projectNumber: "TABS2027003697",
      projectName: "Red Oak 345kV Hyperscale Data Center Hall A",
      facilityName: "Red Oak Technology Campus",
      ownerName: "Compass Datacenters Red Oak LLC",
      designFirmName: "Corgan Associates Inc.",
      locationAddress: "1400 Ovilla Rd, Red Oak, TX 75154",
      county: "Ellis",
      estimatedCostUsd: 125_000_000,
      squareFootage: 250_000,
      typeOfWork: "New Construction",
      scopeOfWork: "250,000 sq ft structural steel erection and chilled-water loop expansion",
      currentStatus: "Construction Started",
      startDate: "2026-11-01",
      completionDate: "2027-09-30",
      latestRawCaptureHash: hashT2,
      updatedAt: isoDaysFrom(anchorMs, -2),
    }),
    ProjectSchema.parse({
      projectNumber: "TABS2027004200",
      projectName: "Red Oak Switchgear Interconnect Building",
      facilityName: "Red Oak 345kV Substation Yard",
      ownerName: "Oncor Electric Delivery Company LLC",
      locationAddress: "1420 Ovilla Rd, Red Oak, TX 75154",
      county: "Ellis",
      estimatedCostUsd: 65_000_000,
      squareFootage: 140_000,
      typeOfWork: "New Construction",
      scopeOfWork: "140,000 sq ft adjacent switchgear interconnect building",
      currentStatus: "Project Registered",
      startDate: "2026-11-15",
      completionDate: "2027-10-15",
      latestRawCaptureHash: hashAged,
      updatedAt: isoDaysFrom(anchorMs, -2),
    }),
  ];

  await Promise.all(projects.map((project) => repo.upsertProject(project)));

  await Promise.all([
    repo.saveRawCapture(
      buildWorkbenchArtifact(hashT1, isoDaysFrom(anchorMs, -4), isoDaysFrom(anchorMs, 85)),
      gzBytes
    ),
    repo.saveRawCapture(
      buildWorkbenchArtifact(hashT2, isoDaysFrom(anchorMs, -3), isoDaysFrom(anchorMs, 85)),
      gzBytes
    ),
  ]);

  const obs1 = ObservationSchema.parse({
    id: "obs_workbench_3697_t1",
    projectNumber: "TABS2027003697",
    rawCaptureHash: hashT1,
    observedAt: isoDaysFrom(anchorMs, -4),
    status: "Project Registered",
    estimatedCostUsd: 125_000_000,
    squareFootage: 250_000,
    scopeOfWork: "250,000 sq ft hyperscale data center hall and 345kV substation yard",
    isMilestone: true,
  });

  const obs2 = ObservationSchema.parse({
    ...obs1,
    id: "obs_workbench_3697_t2",
    rawCaptureHash: hashT2,
    observedAt: isoDaysFrom(anchorMs, -3),
    status: "Construction Started",
    scopeOfWork: "250,000 sq ft structural steel erection and chilled-water loop expansion",
  });

  const obs3 = ObservationSchema.parse({
    id: "obs_workbench_4200_t2",
    projectNumber: "TABS2027004200",
    rawCaptureHash: hashAged,
    observedAt: isoDaysFrom(anchorMs, -3),
    status: "Project Registered",
    estimatedCostUsd: 65_000_000,
    squareFootage: 140_000,
    scopeOfWork: "140,000 sq ft adjacent switchgear interconnect building",
    isMilestone: true,
  });

  await [obs1, obs2, obs3].reduce(
    (chain, obs) => chain.then(() => repo.appendObservation(obs)),
    Promise.resolve()
  );

  const geminiClient = {
    interactions: {
      async create() {
        painterState.seq += 1;
        const seq = painterState.seq;

        return {
          id: `inter_workbench_${seq}`,
          status: "completed",
          output_image: {
            mime_type: "image/webp",
            data: createCorridorBaseCanvasWebp(`workbench-plate-${seq}`).toString("base64"),
          },
          usage: { total_tokens: 140 },
        };
      },
    },
  };

  const t1Result = await bootstrapCanvas(
    { observations: [obs1], now: new Date(anchorMs - 4 * DAY_MS + 300_000) },
    { repository: repo, geminiClient }
  );
  if (t1Result.status !== "plate_painted") {
    throw new Error(`Failed to bootstrap workbench Turn 1: ${t1Result.status}`);
  }

  const t2Result = await paintMilestoneDelta(
    { observations: [obs2, obs3], now: new Date(anchorMs - 3 * DAY_MS + 300_000) },
    { repository: repo, geminiClient }
  );
  if (t2Result.status !== "plate_painted") {
    throw new Error(`Failed to paint workbench Turn 2: ${t2Result.status}`);
  }

  await repo.saveRawCapture(
    buildWorkbenchArtifact(hashAged, isoDaysFrom(anchorMs, -100), isoDaysFrom(anchorMs, -10)),
    gzBytes
  );

  const b1Result = await branchLineage(
    {
      parentInteractionId: t2Result.plate.interactionId,
      scenarioPrompt: "Simulate +400MW ERCOT 345kV substation queue delay across Red Oak campus",
      now: new Date(anchorMs - DAY_MS),
    },
    { repository: repo, geminiClient }
  );
  if (b1Result.status !== "plate_painted") {
    throw new Error(`Failed to branch workbench Turn 3: ${b1Result.status}`);
  }

  return geminiClient;
}

const geminiClient = await seedWorkbenchPlateLineage(baseRepo);

let force500 = false;
const repository = {
  ...baseRepo,
  async listRepairChangelog(connectorId) {
    return force500
      ? [{ malformedSimulatedCorruption: true }]
      : baseRepo.listRepairChangelog(connectorId);
  },
  async listVisualPlatesByLineage(lineageId) {
    return force500
      ? [{ malformedSimulatedCorruption: true }]
      : baseRepo.listVisualPlatesByLineage(lineageId);
  },
};

function buildVirtualClientEntry() {
  const storyFiles = readdirSync(STORIES_DIR)
    .filter((f) => f.endsWith(".stories.tsx"))
    .sort();
  const imports = storyFiles
    .map(
      (f, i) =>
        `import meta_${i}, * as stories_${i} from "./packages/widgets/stories/${f}";`
    )
    .join("\n");
  const modulesArray = storyFiles
    .map((f, i) => `{ file: ${JSON.stringify(f)}, meta: meta_${i}, exports: stories_${i} }`)
    .join(", ");

  return `
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
${imports}

const MODULES = [${modulesArray}];
const getStoryKeys = (mod: (typeof MODULES)[number]) =>
  Object.keys(mod.exports).filter((k) => k !== "default" && mod.exports[k]?.args);

function WorkbenchApp() {
  const [modIdx, setModIdx] = useState(0);
  const activeMod = MODULES[modIdx] ?? MODULES[0];
  const storyKeys = getStoryKeys(activeMod);
  const [storyKey, setStoryKey] = useState(storyKeys.includes("HealedWithAmortization") ? "HealedWithAmortization" : (storyKeys[0] ?? ""));
  const [hostDark, setHostDark] = useState(false);
  const [themeOverride, setThemeOverride] = useState("story");
  const [narrow, setNarrow] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const [force500, setForce500] = useState(false);
  const [mountKey, setMountKey] = useState(0);

  useEffect(() => { document.documentElement.classList.toggle("dark", hostDark); }, [hostDark]);
  useEffect(() => {
    void fetch("/__sim/force-500").then((r) => r.json()).then((d: { force500: boolean }) => setForce500(Boolean(d.force500))).catch(() => {});
  }, []);

  const Component = activeMod.meta.component;
  const activeStory = activeMod.exports[storyKey] ?? activeMod.exports[storyKeys[0]];
  const effectiveTheme = themeOverride === "story" ? (activeStory?.args?.theme ?? "inherit") : themeOverride;
  const activeSourceValue = liveMode ? "__live__" : storyKey;
  const toggle500 = async (next: boolean) => {
    const res = await fetch(\`/__sim/force-500?enable=\${next ? "1" : "0"}\`, { method: "POST" });
    setForce500(((await res.json()) as { force500: boolean }).force500);
  };

  return (
    <div>
      <header style={{ background: "#18181b", color: "#f4efe6", padding: "0.6rem 1.25rem", borderBottom: "1px solid rgba(244,239,230,0.16)" }}>
        <div style={{ maxWidth: "1040px", margin: "0 auto", display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "0.75rem", alignItems: "center" }}>
          <div style={{ display: "flex", flexWrap: "wrap", minWidth: 0, alignItems: "center", gap: "0.65rem", fontSize: "0.75rem", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.88 }}>
            <span>Widget Preview</span>
            {MODULES.length > 1 && (
              <select name="widget-module" value={modIdx} onChange={(e) => { const idx = Number(e.target.value); const nextKeys = getStoryKeys(MODULES[idx] ?? MODULES[0]); setModIdx(idx); setLiveMode(false); setStoryKey(nextKeys.includes("HealedWithAmortization") ? "HealedWithAmortization" : (nextKeys[0] ?? "")); }} style={barCtrlStyle}>
                {MODULES.map((m, i) => <option key={m.file} value={i}>{m.meta.title}</option>)}
              </select>
            )}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", minWidth: 0, gap: "0.5rem", alignItems: "center" }}>
            <select name="widget-story" aria-label="Story fixture" value={activeSourceValue} onChange={(e) => { if (e.target.value === "__live__") setLiveMode(true); else { setLiveMode(false); setStoryKey(e.target.value); } }} style={barCtrlStyle}>
              {storyKeys.map((k) => <option key={k} value={k}>Story: {k}</option>)}
              <option value="__live__">Source: Live API</option>
            </select>
            <select name="widget-theme" value={themeOverride} onChange={(e) => setThemeOverride(e.target.value)} style={barCtrlStyle} aria-label="Widget theme">
              <option value="story">Theme: story</option>
              <option value="inherit">Theme: inherit</option>
              <option value="diurnal">Theme: diurnal</option>
              <option value="nocturnal">Theme: nocturnal</option>
            </select>
            <button type="button" onClick={() => setHostDark((d) => !d)} style={barCtrlStyle}>Host: {hostDark ? "Dark" : "Light"}</button>
            <button type="button" onClick={() => setNarrow((n) => !n)} style={barCtrlStyle}>{narrow ? "Width: 420px" : "Width: Full"}</button>
            {liveMode && (
              <>
                <label style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.75rem" }}>
                  <input name="simulate-500" type="checkbox" checked={force500} onChange={(e) => void toggle500(e.target.checked)} /> 500
                </label>
                <button type="button" onClick={() => setMountKey((k) => k + 1)} style={barCtrlStyle}>Remount</button>
              </>
            )}
          </div>
        </div>
      </header>
      <main style={{ maxWidth: narrow ? "420px" : "1040px", margin: "0 auto", padding: "2.5rem 1.25rem 4rem" }}>
        {liveMode ? (
          <Component key={mountKey} apiBaseUrl="" theme={effectiveTheme} />
        ) : activeStory ? (
          <Component {...activeStory.args} theme={effectiveTheme} />
        ) : null}
      </main>
    </div>
  );
}

const barCtrlStyle: React.CSSProperties = { maxWidth: "100%", padding: "0.32rem 0.6rem", border: "1px solid rgba(244,239,230,0.28)", background: "#22272d", color: "#f4efe6", fontFamily: "var(--font-sans)", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer" };
const root = document.getElementById("root");
if (root) createRoot(root).render(<WorkbenchApp />);
`;
}

async function buildClientBundle() {
  const result = await esbuild.build({
    stdin: {
      contents: buildVirtualClientEntry(),
      loader: "tsx",
      resolveDir: GRIDLOCK_ROOT,
      sourcefile: "widget-workbench-entry.tsx",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    jsx: "automatic",
    nodePaths: [join(GRIDLOCK_ROOT, "node_modules")],
    alias: {
      "@samasastudio/gridlock-core/schemas": join(
        GRIDLOCK_ROOT,
        "packages/core/src/interfaces/index.ts"
      ),
    },
    define: { "process.env.NODE_ENV": '"development"' },
  });
  return result.outputFiles[0].text;
}

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="text-scale" content="scale" />
    <title>Gridlock Widget Workbench</title>
    <style>
      :root {
        --font-display: "Geomanist", "Google Sans Flex", system-ui, sans-serif;
        --font-serif: "Tinos", Georgia, serif;
        --font-sans: "Google Sans Flex", system-ui, -apple-system, sans-serif;
        --font-mono: "Google Sans Code", ui-monospace, SFMono-Regular, monospace;
      }
      .dark {
        color-scheme: dark;
        --background: #121c24;
        --foreground: #f4efe6;
        --card: #22272d;
        --muted-foreground: #a3b19b;
        --border: rgba(244, 239, 230, 0.16);
      }
      *, *::before, *::after { box-sizing: border-box; }
      body { margin: 0; background: var(--background, #f4efe6); color: var(--foreground, #18181b); font-family: var(--font-sans); }
    </style>
    <link rel="stylesheet" href="/atlas-fonts.css" />
    <link rel="stylesheet" href="/atlas-tokens.css" />
  </head>
  <body><div id="root"></div><script type="module" src="/bundle.js"></script></body>
</html>`;

const MIME_BY_EXT = { ".woff2": "font/woff2", ".ttf": "font/ttf" };

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname === "/__sim/force-500" && (req.method === "GET" || req.method === "POST")) {
      if (req.method === "POST") force500 = url.searchParams.get("enable") === "1";
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify({ force500 }));
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await handleGridlockHttpRequest(req, res, { repository, geminiClient });
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store, must-revalidate" });
      res.end(INDEX_HTML.replace("/bundle.js", `/bundle.js?v=${Date.now()}`));
      return;
    }
    if (url.pathname === "/atlas-fonts.css" || url.pathname === "/atlas-tokens.css") {
      const target = join(
        PROFILE_SITE_ROOT,
        url.pathname === "/atlas-fonts.css" ? "src/styles/fonts.css" : "src/styles/tokens.css"
      );
      res.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "no-store, must-revalidate" });
      res.end(existsSync(target) ? readFileSync(target) : "/* standalone fallback */");
      return;
    }
    if (url.pathname.startsWith("/fonts/")) {
      const safeRel = normalize(url.pathname).replace(/^(\.\.(\/|\\|$))+/, "");
      const fontPath = join(PROFILE_SITE_ROOT, "public", safeRel);
      if (fontPath.startsWith(join(PROFILE_SITE_ROOT, "public/fonts")) && existsSync(fontPath)) {
        res.writeHead(200, { "content-type": MIME_BY_EXT[extname(fontPath)] ?? "application/octet-stream" });
        res.end(readFileSync(fontPath));
        return;
      }
    }
    if (url.pathname === "/bundle.js") {
      const js = await buildClientBundle();
      res.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" });
      res.end(js);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(err instanceof Error ? err.stack ?? err.message : String(err));
  }
});

const SMOKE_ROUTES = [
  "/",
  "/bundle.js",
  "/atlas-tokens.css",
  "/api/repairs/changelog",
  "/api/efficiency/scorecard",
];

async function verifySmokeRoute(baseUrl, path) {
  const res = await fetch(`${baseUrl}${path}`);
  if (!res.ok) {
    throw new Error(`${path} returned HTTP ${res.status}`);
  }

  if (path === "/api/efficiency/scorecard") {
    const scorecard = await res.json();
    if (!Array.isArray(scorecard.recentRuns) || scorecard.recentRuns.length === 0) {
      throw new Error("Expected seeded recentRuns in /api/efficiency/scorecard");
    }
  }
}

async function verifyWebpAssetRoute(baseUrl, assetPath) {
  const assetRes = await fetch(`${baseUrl}${assetPath}`);
  if (!assetRes.ok) {
    throw new Error(`${assetPath} returned HTTP ${assetRes.status}`);
  }

  const contentType = assetRes.headers.get("content-type") ?? "";
  if (!contentType.includes("image/webp")) {
    throw new Error(`Expected image/webp content-type for ${assetPath}, got ${contentType}`);
  }

  const bytes = Buffer.from(await assetRes.arrayBuffer());
  if (!isWebpBuffer(bytes)) {
    throw new Error(`Expected valid RIFF/WEBP payload at ${assetPath}`);
  }
}

async function verifyWorkbenchPlateSeam(baseUrl) {
  const lineageRes = await fetch(`${baseUrl}/api/plates/lineage`);
  if (!lineageRes.ok) {
    throw new Error(`/api/plates/lineage returned HTTP ${lineageRes.status}`);
  }

  const lineage = await lineageRes.json();
  if (
    !Array.isArray(lineage.nodes) ||
    lineage.nodes.length < 3 ||
    !lineage.activeCanonicalPlateId
  ) {
    throw new Error(
      "Expected >= 3 seeded VisualPlate nodes and activeCanonicalPlateId in /api/plates/lineage"
    );
  }

  const activeNode = lineage.nodes.find(
    (node) => node.plate.plateId === lineage.activeCanonicalPlateId
  );
  if (!activeNode) {
    throw new Error("Active canonical node missing from /api/plates/lineage nodes");
  }

  await verifyWebpAssetRoute(baseUrl, activeNode.assetPath);

  const branchRes = await fetch(`${baseUrl}/api/plates/branch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      interactionId: activeNode.plate.interactionId,
      scenarioPrompt: "Smoke check 345kV substation reroute",
    }),
  });
  if (branchRes.status !== 201) {
    throw new Error(`/api/plates/branch expected HTTP 201, got ${branchRes.status}`);
  }

  const branched = await branchRes.json();
  if (branched?.plate?.isBranch !== true || !branched?.node?.assetPath) {
    throw new Error("Expected branched VisualPlate payload from POST /api/plates/branch");
  }

  await verifyWebpAssetRoute(baseUrl, branched.node.assetPath);
}

server.listen(PORT, HOST, async () => {
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : PORT;
  if (IS_SMOKE_CHECK) {
    const baseUrl = `http://127.0.0.1:${actualPort}`;

    try {
      await SMOKE_ROUTES.reduce(
        (chain, path) => chain.then(() => verifySmokeRoute(baseUrl, path)),
        Promise.resolve()
      );
      await verifyWorkbenchPlateSeam(baseUrl);
      console.log(
        "Widget workbench smoke check OK (/, /bundle.js, /atlas-tokens.css, /api/repairs/changelog, /api/efficiency/scorecard, /api/plates/*)"
      );
      server.close(() => process.exit(0));
    } catch (err) {
      console.error(err);
      server.close(() => process.exit(1));
    }
    return;
  }
  console.log(`Gridlock Widget Workbench listening on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${actualPort}`);
});
