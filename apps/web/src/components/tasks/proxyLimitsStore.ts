import type { DesktopProxyLimits } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useSyncExternalStore } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";

import type { ClaudePlan } from "./proxyLimits.logic";

/**
 * Fork: the Limits view's data, read from the local Claude proxy through the desktop app every
 * five minutes while the view is open, when the window comes back into focus, and on Refresh.
 * A failed read keeps the last good accounts on screen and says why it failed.
 */
const REFRESH_MS = 5 * 60_000;
// Coming back to the window re-reads only when the data is at least this old.
const FOCUS_REFRESH_AFTER_MS = 60_000;

export interface ProxyLimitsState {
  /** The last read that reached the proxy. */
  readonly last: DesktopProxyLimits | null;
  readonly error: DesktopProxyLimits["error"];
  readonly loading: boolean;
  readonly lastTriedAt: number | null;
}

let state: ProxyLimitsState = { last: null, error: null, loading: false, lastTriedAt: null };
const listeners = new Set<() => void>();
let timer: number | undefined;

const bridge = () => (typeof window === "undefined" ? undefined : window.desktopBridge?.taskBoard);

export const canReadProxyLimits = (): boolean => typeof bridge()?.readProxyLimits === "function";

function set(next: Partial<ProxyLimitsState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export async function refreshProxyLimits(): Promise<void> {
  const read = bridge()?.readProxyLimits;
  if (!read || state.loading) return;
  set({ loading: true, lastTriedAt: Date.now() });
  try {
    const snapshot = await read();
    set(
      snapshot.error
        ? { loading: false, error: snapshot.error }
        : { loading: false, error: null, last: snapshot },
    );
  } catch {
    set({ loading: false, error: "proxy_down" });
  }
}

const onFocus = () => {
  if (document.visibilityState === "hidden") return;
  if (state.lastTriedAt === null || Date.now() - state.lastTriedAt >= FOCUS_REFRESH_AFTER_MS) {
    void refreshProxyLimits();
  }
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    onFocus();
    timer = window.setInterval(() => void refreshProxyLimits(), REFRESH_MS);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    window.clearInterval(timer);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onFocus);
  };
}

const getSnapshot = () => state;

export function useProxyLimits(): ProxyLimitsState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

const PLANS_KEY = "t3code:tasks:claude-plans";
// "max5" and "max20" are the plan names before Anthropic renamed them Max and Ultra.
const PlansSchema = Schema.Record(
  Schema.String,
  Schema.Literals(["pro", "max", "ultra", "max5", "max20"]),
);
const RENAMED: Record<string, ClaudePlan> = { max5: "max", max20: "ultra" };
const NO_PLANS: Readonly<Record<string, ClaudePlan>> = {};

/**
 * Which plan each account is on, by email, set on the Limits cards. The proxy doesn't know, and
 * the total needs it to weigh a Max 20x account above a Pro one. Shared with the Tasks window.
 */
export function useClaudePlans(): [
  Readonly<Record<string, ClaudePlan>>,
  (email: string, plan: ClaudePlan | null) => void,
] {
  const [stored, setPlans] = useLocalStorage(PLANS_KEY, NO_PLANS, PlansSchema);
  const plans: Record<string, ClaudePlan> = {};
  for (const [email, plan] of Object.entries(stored))
    plans[email] = RENAMED[plan] ?? (plan as ClaudePlan);
  const setPlan = (email: string, plan: ClaudePlan | null) =>
    setPlans((current) => {
      const rest = Object.fromEntries(Object.entries(current).filter(([key]) => key !== email));
      return plan ? { ...rest, [email]: plan } : rest;
    });
  return [plans, setPlan];
}
