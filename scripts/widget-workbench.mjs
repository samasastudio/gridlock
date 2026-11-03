import { createServer } from "node:http";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  createInMemoryGridlockRepository,
  DEFAULT_TDLR_CONNECTOR_CONFIG,
  handleGridlockHttpRequest,
} from "../packages/core/src/index.ts";
import { HealedWithAmortization } from "../packages/widgets/stories/GridlockRepairLogWidget.stories.tsx";

const GRIDLOCK_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE_SITE_ROOT = resolve(GRIDLOCK_ROOT, "../profile-site");
const STORIES_DIR = join(GRIDLOCK_ROOT, "packages/widgets/stories");
const IS_SMOKE_CHECK = process.argv.includes("--smoke-check");
const PORT = IS_SMOKE_CHECK ? 0 : Number(process.env.PORT ?? 6006);

function loadEsbuild() {
  for (const pkgPath of [
    join(GRIDLOCK_ROOT, "package.json"),
    join(PROFILE_SITE_ROOT, "package.json"),
  ]) {
    if (!existsSync(pkgPath)) continue;
    try {
      return createRequire(pkgPath)("esbuild");
    } catch {
      // Try next candidate
    }
  }
  throw new Error(
    "esbuild not found in gridlock or ../profile-site node_modules; install esbuild to run preview:widgets."
  );
}

const esbuild = loadEsbuild();
const baseRepo = createInMemoryGridlockRepository();
const healedArgs = HealedWithAmortization.args;
if (healedArgs.changelog?.entries[0] && healedArgs.efficiencyLedger) {
  await baseRepo.promoteConnectorConfig(
    {
      ...DEFAULT_TDLR_CONNECTOR_CONFIG,
      version: 2,
      detailContainerSelector: ".project-details, .tabs-project-details-v2",
    },
    healedArgs.changelog.entries[0],
    { updatedLedger: healedArgs.efficiencyLedger }
  );
}

let force500 = false;
const repository = {
  ...baseRepo,
  async listRepairChangelog(connectorId) {
    return force500
      ? [{ malformedSimulatedCorruption: true }]
      : baseRepo.listRepairChangelog(connectorId);
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

function WorkbenchApp() {
  const [modIdx, setModIdx] = useState(0);
  const activeMod = MODULES[modIdx] ?? MODULES[0];
  const storyKeys = Object.keys(activeMod.exports).filter((k) => k !== "default" && activeMod.exports[k]?.args);
  const [storyKey, setStoryKey] = useState(storyKeys[0] ?? "");
  const [hostDark, setHostDark] = useState(false);
  const [themeOverride, setThemeOverride] = useState("story");
  const [narrow, setNarrow] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const [force500, setForce500] = useState(false);
  const [mountKey, setMountKey] = useState(0);

  useEffect(() => { document.documentElement.classList.toggle("dark", hostDark); }, [hostDark]);

  const Component = activeMod.meta.component;
  const activeStory = activeMod.exports[storyKey] ?? activeMod.exports[storyKeys[0]];
  const effectiveTheme = themeOverride === "story" ? (activeStory?.args?.theme ?? "inherit") : themeOverride;
  const toggle500 = async (next: boolean) => {
    const res = await fetch(\`/__sim/force-500?enable=\${next ? "1" : "0"}\`, { method: "POST" });
    setForce500(((await res.json()) as { force500: boolean }).force500);
  };

  return (
    <div style={{ maxWidth: "1160px", margin: "0 auto", padding: "1.25rem 1.25rem 3rem" }}>
      <header style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "0.75rem", paddingBottom: "0.85rem", marginBottom: "0.85rem", borderBottom: "1px solid var(--border, currentColor)" }}>
        <div>
          <div style={{ fontSize: "0.6875rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.72 }}>CSF3 Widget Workbench · {activeMod.meta.title}</div>
          {MODULES.length > 1 && (
            <select value={modIdx} onChange={(e) => { const idx = Number(e.target.value); setModIdx(idx); setLiveMode(false); setStoryKey(Object.keys(MODULES[idx].exports).find((k) => k !== "default") ?? ""); }} style={{ marginTop: "0.35rem", ...btnStyle }}>
              {MODULES.map((m, i) => <option key={m.file} value={i}>{m.meta.title}</option>)}
            </select>
          )}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem", alignItems: "center" }}>
          <button type="button" onClick={() => setHostDark((d) => !d)} style={btnStyle}>Host: {hostDark ? "Dark (.dark)" : "Light (:root)"}</button>
          <select value={themeOverride} onChange={(e) => setThemeOverride(e.target.value)} style={btnStyle} aria-label="Widget theme">
            <option value="story">Theme: story</option>
            <option value="inherit">Theme: inherit</option>
            <option value="diurnal">Theme: diurnal</option>
            <option value="nocturnal">Theme: nocturnal</option>
          </select>
          <button type="button" onClick={() => setNarrow((n) => !n)} style={btnStyle}>{narrow ? "Mobile 420px" : "Full Width"}</button>
        </div>
      </header>
      <nav aria-label="Stories" style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "1rem" }}>
        {storyKeys.map((k) => (
          <button key={k} type="button" onClick={() => { setLiveMode(false); setStoryKey(k); }} style={{ ...btnStyle, background: !liveMode && storyKey === k ? "var(--foreground, #18181b)" : "transparent", color: !liveMode && storyKey === k ? "var(--background, #f4efe6)" : "inherit" }}>{k}</button>
        ))}
        <button type="button" onClick={() => setLiveMode(true)} style={{ ...btnStyle, background: liveMode ? "var(--foreground, #18181b)" : "transparent", color: liveMode ? "var(--background, #f4efe6)" : "inherit" }}>Live API</button>
        {liveMode && (
          <>
            <label style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.75rem" }}>
              <input type="checkbox" checked={force500} onChange={(e) => void toggle500(e.target.checked)} /> Simulate 500
            </label>
            <button type="button" onClick={() => setMountKey((k) => k + 1)} style={btnStyle}>Remount</button>
          </>
        )}
      </nav>
      <main style={{ maxInlineSize: narrow ? "420px" : "100%" }}>
        {liveMode ? <Component key={mountKey} apiBaseUrl="" theme={effectiveTheme} /> : <Component {...activeStory.args} apiBaseUrl="" theme={effectiveTheme} />}
      </main>
    </div>
  );
}

const btnStyle: React.CSSProperties = { padding: "0.38rem 0.65rem", border: "1px solid currentColor", background: "transparent", color: "inherit", fontFamily: "var(--font-sans)", fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer" };
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
    <link rel="stylesheet" href="/atlas-fonts.css" />
    <link rel="stylesheet" href="/atlas-tokens.css" />
    <style>
      :root {
        --font-display: "Geomanist", "Google Sans Flex", system-ui, sans-serif;
        --font-serif: "Tinos", Georgia, serif;
        --font-sans: "Google Sans Flex", system-ui, -apple-system, sans-serif;
        --font-mono: "Google Sans Code", ui-monospace, SFMono-Regular, monospace;
      }
      *, *::before, *::after { box-sizing: border-box; }
      body { margin: 0; background: var(--background, #f4efe6); color: var(--foreground, #18181b); font-family: var(--font-sans); }
    </style>
  </head>
  <body><div id="root"></div><script type="module" src="/bundle.js"></script></body>
</html>`;

const MIME_BY_EXT = { ".woff2": "font/woff2", ".ttf": "font/ttf" };

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname === "/__sim/force-500" && req.method === "POST") {
      force500 = url.searchParams.get("enable") === "1";
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ force500 }));
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await handleGridlockHttpRequest(req, res, { repository });
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(INDEX_HTML);
      return;
    }
    if (url.pathname === "/atlas-fonts.css" || url.pathname === "/atlas-tokens.css") {
      const target = join(
        PROFILE_SITE_ROOT,
        url.pathname === "/atlas-fonts.css" ? "src/styles/fonts.css" : "src/styles/tokens.css"
      );
      res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
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

server.listen(PORT, "0.0.0.0", async () => {
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : PORT;
  if (IS_SMOKE_CHECK) {
    try {
      for (const path of ["/", "/bundle.js", "/atlas-tokens.css", "/api/repairs/changelog"]) {
        const res = await fetch(`http://127.0.0.1:${actualPort}${path}`);
        if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}`);
      }
      console.log("Widget workbench smoke check OK (/, /bundle.js, /atlas-tokens.css, /api/repairs/changelog)");
      server.close(() => process.exit(0));
    } catch (err) {
      console.error(err);
      server.close(() => process.exit(1));
    }
    return;
  }
  console.log(`Gridlock Widget Workbench listening on http://localhost:${actualPort}`);
});
