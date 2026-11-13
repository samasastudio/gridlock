import { useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AnimatePresence, MotionConfigContext, motion } from "motion/react";
import { AnimateNumber, ScrambleText, type AnimateNumberProps } from "motion-plus/react";
import type { ConnectorStatus } from "@samasastudio/gridlock-core/schemas";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const reducedMotionListeners = new Set<() => void>();
let sharedReducedMotionMql: MediaQueryList | null = null;

function notifyReducedMotionListeners(): void {
  for (const listener of reducedMotionListeners) listener();
}

function subscribeReducedMotion(onStoreChange: () => void): () => void {
  if (!sharedReducedMotionMql) sharedReducedMotionMql = globalThis.matchMedia?.(REDUCED_MOTION_QUERY) ?? null;
  if (!sharedReducedMotionMql) return () => {};
  if (reducedMotionListeners.size === 0) sharedReducedMotionMql.addEventListener("change", notifyReducedMotionListeners);
  reducedMotionListeners.add(onStoreChange);
  return () => {
    reducedMotionListeners.delete(onStoreChange);
    if (reducedMotionListeners.size === 0 && sharedReducedMotionMql) {
      sharedReducedMotionMql.removeEventListener("change", notifyReducedMotionListeners);
    }
  };
}

function getReducedMotionSnapshot(): boolean {
  if (!sharedReducedMotionMql) sharedReducedMotionMql = globalThis.matchMedia?.(REDUCED_MOTION_QUERY) ?? null;
  return Boolean(sharedReducedMotionMql?.matches);
}

export function useIsReducedMotion(): boolean {
  const { reducedMotion } = useContext(MotionConfigContext);
  const systemReduced = useSyncExternalStore(subscribeReducedMotion, getReducedMotionSnapshot, () => false);
  if (reducedMotion === "always") return true;
  if (reducedMotion === "never") return false;
  return systemReduced;
}

export type GridlockWidgetTheme = "inherit" | "diurnal" | "nocturnal";

export const EDITORIAL_EASE = [0.16, 1, 0.3, 1] as const;
export const RULE_DRAW_EASE = [0.25, 0.85, 0.35, 1] as const;
const CALM_FADE_TRANSITION = { duration: 0.42, ease: EDITORIAL_EASE } as const;
const NUMBER_TRANSITION = {
  y: { type: "spring" as const, duration: 1.15, bounce: 0 },
  width: { type: "spring" as const, duration: 1.15, bounce: 0 },
  opacity: { duration: 0.75, ease: EDITORIAL_EASE },
};
const SCRAMBLE_CASCADE_DURATION = (index: number) => 0.42 + index * 0.045;

export const RELIEF_RETICLE_ICON = <svg width="20" height="20" viewBox="0 -20 20 20" fill="none" aria-hidden="true"><rect x="1" y="-19" width="18" height="18" stroke="var(--relief-sky-mid, #6e7c87)" strokeWidth="1.5" /><path d="M3 -5 L7.5 -12.5 L12 -9 L17 -16" stroke="var(--relief-coral-mid, #e06d53)" strokeWidth="1.5" /></svg>;
export const EXPORT_ARROW_ICON = <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 11L11 3M11 3H5M11 3V9" stroke="currentColor" strokeWidth="1.5" /></svg>;
export const ALERT_TRIANGLE_ICON = <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M7 1.75L12.75 11.75H1.25L7 1.75Z" stroke="currentColor" strokeWidth="1.5" /><path d="M7 5.5V8.25M7 9.9V10.4" stroke="currentColor" strokeWidth="1.5" /></svg>;
const STATUS_HEALTHY_ICON = <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><circle cx="6" cy="6" r="4.25" stroke="currentColor" strokeWidth="1.5" /><circle cx="6" cy="6" r="1.75" fill="currentColor" /></svg>;
const STATUS_WAF_ICON = <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><rect x="1.75" y="1.75" width="8.5" height="8.5" stroke="currentColor" strokeWidth="1.5" /><path d="M3.75 6H8.25" stroke="currentColor" strokeWidth="1.5" /></svg>;
export const VERIFIED_CHECK_ICON = <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2.5 7.25L5.6 10.35L11.5 3.65" stroke="currentColor" strokeWidth="1.5" /></svg>;
const COPY_SHEET_ICON = <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true"><rect x="4.25" y="4.25" width="7.5" height="7.5" stroke="currentColor" strokeWidth="1.5" /><path d="M2.25 9.75V2.25H9.75" stroke="currentColor" strokeWidth="1.5" /></svg>;

export function DossierNumber(props: { value: number; format?: AnimateNumberProps["format"]; prefix?: string; suffix?: string }) {
  return (
    <AnimateNumber locales="en-US" format={props.format} prefix={props.prefix} suffix={props.suffix} transition={NUMBER_TRANSITION}>
      {props.value}
    </AnimateNumber>
  );
}

export function DossierStatusBadge(props: { label: string; tone?: "healthy" | "alert"; icon?: ReactNode }) {
  const tone = props.tone ?? "healthy";
  return (
    <motion.span
      key={`${tone}-${props.label}`}
      className="gridlock-status-badge"
      data-tone={tone}
      initial={{ opacity: 0, y: -5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.65, ease: EDITORIAL_EASE }}
    >
      {props.icon ?? (tone === "healthy" ? STATUS_HEALTHY_ICON : ALERT_TRIANGLE_ICON)}
      <span>{props.label}</span>
    </motion.span>
  );
}

export function ConnectorStatusBadge(props: { connectorStatus: ConnectorStatus; activeVersion: number }) {
  const tone = props.connectorStatus === "healthy" ? "healthy" : "alert";
  const icon = props.connectorStatus === "healthy" ? STATUS_HEALTHY_ICON : props.connectorStatus === "selector_anomaly" ? ALERT_TRIANGLE_ICON : STATUS_WAF_ICON;
  return <DossierStatusBadge tone={tone} icon={icon} label={`v${props.activeVersion} · ${props.connectorStatus}`} />;
}

export function CopyCitationButton(props: { value: string; displayLabel: string; citationKind: string }) {
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isReducedMotion = useIsReducedMotion();
  const copied = copiedValue === props.value;

  useEffect(() => {
    setCopiedValue(null);
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [props.value]);

  const handleCopy = async () => {
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard?.writeText) return;
    const targetValue = props.value;
    try {
      await clipboard.writeText(targetValue);
      setCopiedValue(targetValue);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopiedValue((cur) => (cur === targetValue ? null : cur)), 2400);
    } catch {
      setCopiedValue(null);
    }
  };

  return (
    <button
      type="button"
      className="gridlock-copy-chip"
      data-copied={copied ? "true" : "false"}
      data-citation-transition="scramble"
      aria-label={copied ? `Copied ${props.citationKind}` : `Copy ${props.citationKind} ${props.displayLabel}`}
      onClick={() => void handleCopy()}
    >
      <ScrambleText
        as="code"
        active={!isReducedMotion}
        duration={isReducedMotion ? 0 : SCRAMBLE_CASCADE_DURATION}
        interval={0.055}
        chars="0123456789abcdef:_"
      >
        {props.displayLabel}
      </ScrambleText>
      <span className="gridlock-copy-icon" aria-hidden="true">
        <AnimatePresence mode="wait" initial={false}>
          {copied ? (
            <motion.svg key="copied" width="13" height="13" viewBox="0 0 14 14" fill="none">
              <motion.path
                d="M2.25 7.25L5.5 10.5L11.75 3.5"
                stroke="currentColor"
                strokeWidth="1.6"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.58, ease: EDITORIAL_EASE }}
              />
            </motion.svg>
          ) : (
            <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={CALM_FADE_TRANSITION}>
              {COPY_SHEET_ICON}
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </button>
  );
}
