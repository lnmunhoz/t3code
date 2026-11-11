import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  threadRuntimeCanArchive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";

import { resolveSidebarThreadStatus } from "../Sidebar.logic";

const HOUR_MS = 60 * 60 * 1000;

/** Threads the user chose to keep, by thread key, with when they chose. */
export type KeptIdleThreads = Readonly<Record<string, string>>;

export interface IdleArchiveCandidate {
  readonly key: string;
  readonly thread: EnvironmentThreadShell;
  readonly idleSinceMs: number;
}

/** The latest message, run, un-settle, or snooze wake; a thread with none counts from creation. */
function threadIdleSinceMs(thread: EnvironmentThreadShell, nowMs: number): number {
  const snoozeWakeMs = thread.snoozedUntil == null ? NaN : Date.parse(thread.snoozedUntil);
  const candidates = [
    thread.latestUserMessageAt,
    thread.latestRun?.requestedAt,
    thread.latestRun?.startedAt,
    thread.latestRun?.completedAt,
    thread.unsettledAt,
  ].map((value) => (value == null ? NaN : Date.parse(value)));
  if (snoozeWakeMs <= nowMs) candidates.push(snoozeWakeMs);
  const latest = Math.max(...candidates.filter((value) => !Number.isNaN(value)));
  return Number.isFinite(latest) ? latest : Date.parse(thread.createdAt);
}

/**
 * Threads idle for at least `idleHours` that nothing is waiting on, most idle first.
 * Pinned, snoozed, and auto-settle-disabled threads count as deliberately kept.
 */
export function resolveIdleArchiveCandidates(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly idleHours: number;
  readonly nowMs: number;
  readonly kept: KeptIdleThreads;
  readonly excludedKeys: ReadonlySet<string>;
}): IdleArchiveCandidate[] {
  const cutoffMs = input.nowMs - input.idleHours * HOUR_MS;
  const now = new Date(input.nowMs).toISOString();
  const candidates: IdleArchiveCandidate[] = [];
  for (const thread of input.threads) {
    const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    if (input.excludedKeys.has(key)) continue;
    if (thread.archivedAt !== null || thread.deletedAt !== null) continue;
    if (thread.pinnedAt != null || thread.autoSettleDisabledAt != null) continue;
    if (effectiveSnoozed(thread, { now })) continue;
    if (!threadRuntimeCanArchive(thread.runtime)) continue;
    const status = resolveSidebarThreadStatus(thread);
    if (status !== "ready" && status !== "failed") continue;
    const idleSinceMs = threadIdleSinceMs(thread, input.nowMs);
    if (Number.isNaN(idleSinceMs) || idleSinceMs > cutoffMs) continue;
    const keptAt = input.kept[key];
    if (keptAt !== undefined && Date.parse(keptAt) >= idleSinceMs) continue;
    candidates.push({ key, thread, idleSinceMs });
  }
  return candidates.toSorted((left, right) => left.idleSinceMs - right.idleSinceMs);
}

/** Records `keys` as kept at `now`, dropping entries for threads that no longer exist. */
export function keepIdleThreads(
  kept: KeptIdleThreads,
  keys: ReadonlyArray<string>,
  now: string,
  liveKeys: ReadonlySet<string>,
): KeptIdleThreads {
  const next: Record<string, string> = {};
  for (const [key, keptAt] of Object.entries(kept)) {
    if (liveKeys.has(key)) next[key] = keptAt;
  }
  for (const key of keys) next[key] = now;
  return next;
}

export function formatIdleHours(hours: number): string {
  if (hours >= 24 && hours % 24 === 0) {
    const days = hours / 24;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}
