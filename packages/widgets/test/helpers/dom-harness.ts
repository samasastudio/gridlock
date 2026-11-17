import assert from "node:assert/strict";
import { act } from "react";
import type { Root } from "react-dom/client";
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

export async function waitForDom(
  predicate: () => boolean,
  timeoutMs = 1500
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  const poll = async (): Promise<void> => {
    if (predicate()) {
      return;
    }

    if (Date.now() >= deadline) {
      assert.fail(`Timed out after ${timeoutMs}ms waiting for widget DOM condition`);
    }

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    return poll();
  };

  await poll();
}

export function setTextareaValue(
  win: Window,
  el: InstanceType<Window["HTMLTextAreaElement"]>,
  value: string
): void {
  const setter = Object.getOwnPropertyDescriptor(
    win.HTMLTextAreaElement.prototype,
    "value"
  )?.set;

  setter?.call(el, value);
  el.dispatchEvent(new win.Event("input", { bubbles: true }));
}

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
    TRACKED_GLOBAL_KEYS.map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ])
  );

  Object.assign(
    g,
    Object.fromEntries(
      DOM_GLOBAL_KEYS.map((key) => [
        key,
        key === "window" ? win : (win as unknown as Record<string, unknown>)[key],
      ])
    )
  );
  g.getComputedStyle = win.getComputedStyle.bind(win);
  g.IS_REACT_ACT_ENVIRONMENT = true;

  const clipboardState = { lastCopiedText: "" };
  Object.defineProperty(globalThis, "navigator", {
    value: {
      userAgent: win.navigator.userAgent,
      clipboard: {
        writeText: async (text: string) => {
          clipboardState.lastCopiedText = text;
        },
      },
    },
    configurable: true,
  });

  const restoreGlobals = () => {
    Array.from(savedDescriptors.entries()).map(([key, desc]) =>
      desc !== undefined
        ? Object.defineProperty(globalThis, key, desc)
        : Reflect.deleteProperty(globalThis, key)
    );
  };

  try {
    const { createRoot } = await import("react-dom/client");
    const container = win.document.createElement("div");
    win.document.body.appendChild(container);
    const root = createRoot(container as unknown as Element);

    try {
      await run({
        window: win,
        container,
        root,
        getLastCopiedText: () => clipboardState.lastCopiedText,
      });
    } finally {
      await act(async () => {
        root.unmount();
      });
    }
  } finally {
    try {
      await win.happyDOM.close();
    } finally {
      restoreGlobals();
    }
  }
}
