import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";

export interface WidgetDomContext {
  window: Window;
  container: ReturnType<Window["document"]["createElement"]>;
  root: Root;
  getLastCopiedText: () => string;
}

const DOM_GLOBAL_KEYS = [
  "window",
  "document",
  "Element",
  "HTMLElement",
  "SVGElement",
  "NodeList",
] as const;

const TRACKED_GLOBAL_KEYS = [
  ...DOM_GLOBAL_KEYS,
  "getComputedStyle",
  "IS_REACT_ACT_ENVIRONMENT",
  "navigator",
] as const;

/**
 * Mounts a `react-dom/client` root inside a headless `happy-dom` window with
 * the global constructors (`SVGElement`, `NodeList`, `getComputedStyle`) and
 * configurable `navigator.clipboard` shim required by `motion` / `motion-plus`
 * on Node 24.
 *
 * Pair SSR assertions in the same test file with `renderToStaticMarkup` rather
 * than `renderToReadableStream` so React 19 primary context renderers do not
 * collide on `<MotionConfig>`.
 */
export async function withWidgetDom(
  run: (ctx: WidgetDomContext) => Promise<void> | void
): Promise<void> {
  const win = new Window({ url: "http://localhost:6006" });
  const g = globalThis as Record<string, unknown>;
  const savedDescriptors = new Map<string, PropertyDescriptor | undefined>(
    TRACKED_GLOBAL_KEYS.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)])
  );

  for (const k of DOM_GLOBAL_KEYS) {
    g[k] = k === "window" ? win : (win as unknown as Record<string, unknown>)[k];
  }
  g.getComputedStyle = win.getComputedStyle.bind(win);
  g.IS_REACT_ACT_ENVIRONMENT = true;
  let lastCopiedText = "";
  Object.defineProperty(globalThis, "navigator", {
    value: {
      clipboard: {
        writeText: async (text: string) => {
          lastCopiedText = text;
        },
      },
    },
    configurable: true,
  });

  const container = win.document.createElement("div");
  win.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);

  try {
    await run({
      window: win,
      container,
      root,
      getLastCopiedText: () => lastCopiedText,
    });
  } finally {
    try {
      await act(async () => {
        root.unmount();
      });
    } finally {
      try {
        await win.happyDOM.close();
      } finally {
        for (const [k, desc] of savedDescriptors) {
          if (desc !== undefined) {
            Object.defineProperty(globalThis, k, desc);
          } else {
            Reflect.deleteProperty(globalThis, k);
          }
        }
      }
    }
  }
}
