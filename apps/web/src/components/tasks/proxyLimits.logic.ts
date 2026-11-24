import type { DesktopProxyLimitsAccount } from "@t3tools/contracts";

/** Limit data older than this is from before the account's last request: shown greyed. */
const STALE_AFTER_MS = 30 * 60_000;

export type LimitTone = "ok" | "warn" | "high";

/** Bar colour: fine below 70%, amber to 90%, red above. */
export function limitTone(pct: number): LimitTone {
  if (pct >= 90) return "high";
  if (pct >= 70) return "warn";
  return "ok";
}

/** "2h 14m", "3d 4h", "12m"; null once it has passed or when unknown. */
export function formatTimeLeft(at: string | null, nowMs: number): string | null {
  if (!at) return null;
  const left = Date.parse(at) - nowMs;
  if (!Number.isFinite(left) || left <= 0) return null;
  const minutes = Math.ceil(left / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

/** "4m ago", "2h ago", "just now". */
export function formatAgo(at: string | null, nowMs: number): string | null {
  if (!at) return null;
  const ago = nowMs - Date.parse(at);
  if (!Number.isFinite(ago)) return null;
  const minutes = Math.floor(ago / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function isStale(account: DesktopProxyLimitsAccount, nowMs: number): boolean {
  if (!account.observedAt) return true;
  return nowMs - Date.parse(account.observedAt) > STALE_AFTER_MS;
}

export type AccountState = "disabled" | "cooldown" | "limited" | "unavailable" | "ok";

/** What the account can do right now, worst first. */
export function accountState(account: DesktopProxyLimitsAccount, nowMs: number): AccountState {
  if (account.disabled) return "disabled";
  if (account.cooldownUntil && Date.parse(account.cooldownUntil) > nowMs) return "cooldown";
  const rejected = [account.fiveHour, account.sevenDay].some(
    (window) =>
      window?.status === "rejected" &&
      // A window that has since reset no longer blocks.
      (!window.resetsAt || Date.parse(window.resetsAt) > nowMs),
  );
  if (rejected) return "limited";
  if (account.unavailable) return "unavailable";
  return "ok";
}

/** The window an account will run out of first, by the higher use. */
export function tightestPct(account: DesktopProxyLimitsAccount): number | null {
  const values = [account.fiveHour?.pct, account.sevenDay?.pct].filter(
    (value): value is number => typeof value === "number",
  );
  return values.length > 0 ? Math.max(...values) : null;
}

export type ClaudePlan = "pro" | "max" | "ultra";

export const PLAN_LABEL: Record<ClaudePlan, string> = {
  pro: "Pro",
  max: "Max",
  ultra: "Ultra",
};

/**
 * Each plan's room relative to Pro, per window, from claude.com/pricing (checked 2026-11-22):
 * Max is "5x Pro usage" every 5 hours and every week; Ultra is "10x Pro usage" every week with
 * "No 5-hour limit" (null: it isn't part of the 5-hour pool).
 */
const PLAN_SIZE: Record<ClaudePlan, { fiveHour: number | null; sevenDay: number }> = {
  pro: { fiveHour: 1, sevenDay: 1 },
  max: { fiveHour: 5, sevenDay: 5 },
  ultra: { fiveHour: null, sevenDay: 10 },
};

/**
 * Each account's size in one window from the plans you set. An account without one counts as the
 * average of those set, so with none set every account weighs the same.
 */
export function planWeights(
  accounts: ReadonlyArray<DesktopProxyLimitsAccount>,
  plans: Readonly<Record<string, ClaudePlan>>,
  key: "fiveHour" | "sevenDay",
): ReadonlyMap<string, number> {
  const sizeOf = (account: DesktopProxyLimitsAccount) => {
    const plan = plans[account.label];
    return plan ? PLAN_SIZE[plan][key] : undefined;
  };
  const known = accounts.flatMap((account) => {
    const size = sizeOf(account);
    return typeof size === "number" ? [size] : [];
  });
  const fallback = known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : 1;
  return new Map(
    accounts.map((account) => {
      const size = sizeOf(account);
      // A plan with no limit in this window weighs nothing in its pool.
      return [account.id, size === undefined ? fallback : (size ?? 0)];
    }),
  );
}

export interface CombinedWindow {
  /** Use across the accounts counted, 0–100, as if they were one big account. */
  readonly pct: number;
  readonly counted: number;
  /** The soonest reset among accounts with some use. */
  readonly nextResetAt: string | null;
}

/**
 * All accounts as one: the proxy spreads requests over them, so their room adds up. Each
 * account's use counts by its plan's size (equal when no weights are given). Accounts that are
 * off, or have no data for this window, aren't counted. A window that has reset since the proxy
 * last looked counts as empty.
 */
export function combinedWindow(
  accounts: ReadonlyArray<DesktopProxyLimitsAccount>,
  key: "fiveHour" | "sevenDay",
  nowMs: number,
  weights: ReadonlyMap<string, number> = new Map(),
): CombinedWindow | null {
  const counted = accounts.flatMap((account) => {
    const window = account[key];
    const weight = weights.get(account.id) ?? 1;
    return !account.disabled && window && weight > 0 ? [{ window, weight }] : [];
  });
  if (counted.length === 0) return null;
  let used = 0;
  let total = 0;
  let nextResetMs = Number.POSITIVE_INFINITY;
  for (const { window, weight } of counted) {
    const resetMs = window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN;
    const hasReset = Number.isFinite(resetMs) && resetMs <= nowMs;
    const pct = hasReset ? 0 : Math.min(100, window.pct);
    used += pct * weight;
    total += weight;
    if (pct > 0 && Number.isFinite(resetMs) && !hasReset) {
      nextResetMs = Math.min(nextResetMs, resetMs);
    }
  }
  return {
    pct: total > 0 ? used / total : 0,
    counted: counted.length,
    nextResetAt: Number.isFinite(nextResetMs) ? new Date(nextResetMs).toISOString() : null,
  };
}
