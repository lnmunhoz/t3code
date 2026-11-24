import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { DesktopTaskClassifyResult } from "@t3tools/contracts";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { AtomRegistry } from "effect/reactivity";
import { useSyncExternalStore } from "react";

import { getClientSettings, subscribeClientSettings } from "~/hooks/useSettings";
import { orchestrationEnvironment } from "~/state/orchestration";
import { environmentProjects } from "~/state/projects";
import { environmentThreadShells } from "~/state/threads";
import {
  applyWatcherOps,
  buildWatcherPrompt,
  parseWatcherOps,
  shortenHome,
  WATCHER_SYSTEM_PROMPT,
  type TurnDecision,
  type WatchedTurn,
} from "./taskBoard.logic";
import { changeTaskBoard, isTaskBoardAvailable, readTaskBoard } from "./taskBoardStore";
import { exchangesFromTranscript, parseWatcherLog, type PastExchange } from "./taskQuestions.logic";
import { readTaskQuestions, recordTaskQuestions } from "./taskQuestionsStore";
import { recordTaskUsage } from "./taskUsageStore";

const WATCHER_MODEL = "haiku";
// Turns that finish close together go out in one call, and calls are at least a minute apart.
const BATCH_DELAY_MS = 20_000;
const MIN_GAP_MS = 60_000;
const MAX_TURNS_PER_CALL = 6;

export interface TaskWatcherStatus {
  readonly running: boolean;
  readonly lastRunAt: number | null;
  readonly lastChanges: number;
  readonly lastFailed: boolean;
  readonly queued: number;
  readonly calls: number;
}

let status: TaskWatcherStatus = {
  running: false,
  lastRunAt: null,
  lastChanges: 0,
  lastFailed: false,
  queued: 0,
  calls: 0,
};
const statusListeners = new Set<() => void>();
function setStatus(next: Partial<TaskWatcherStatus>) {
  status = { ...status, ...next };
  for (const listener of statusListeners) listener();
}

export function useTaskWatcherStatus(): TaskWatcherStatus {
  return useSyncExternalStore(
    (listener) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    () => status,
  );
}

function watchedTurn(
  registry: AtomRegistry.AtomRegistry,
  shell: EnvironmentThreadShell,
  exchange: { prompt: string; decisions: ReadonlyArray<TurnDecision>; reply: string },
): WatchedTurn {
  const project = registry
    .get(environmentProjects.projectsAtom)
    .find((entry) => entry.environmentId === shell.environmentId && entry.id === shell.projectId);
  const root = shell.worktreePath || (project && !project.isScratch ? project.workspaceRoot : null);
  return {
    environmentId: shell.environmentId,
    threadId: shell.id,
    threadTitle: shell.title,
    t3ProjectName: project && !project.isScratch ? project.title : null,
    workspace: root ? shortenHome(root) : null,
    ...exchange,
  };
}

async function readTranscriptItems(
  registry: AtomRegistry.AtomRegistry,
  shell: EnvironmentThreadShell,
) {
  const result = await runAtomCommand(
    registry,
    orchestrationEnvironment.threadTranscript,
    { environmentId: shell.environmentId, input: { threadId: shell.id } },
    { reportFailure: false, reportDefect: false },
  );
  return result._tag === "Success" ? result.value.items : null;
}

// The running watcher's registry, so the Questions view can start a backfill.
let backfillRegistry: AtomRegistry.AtomRegistry | null = null;

export interface BackfillResult {
  /** Chats active in the window, and how many of their transcripts could be read. */
  readonly chats: number;
  readonly read: number;
  /** False when the watcher isn't running in this window. */
  readonly ready: boolean;
  readonly runs: number;
  readonly entries: number;
  readonly calls: number;
  readonly failed: number;
  readonly costUsd: number;
}

/**
 * Logs the questions and decisions of chats' runs from the last `windowMs`, for runs the log
 * doesn't have yet. It only writes the question log; the task board is left alone.
 */
export async function backfillQuestions(
  windowMs: number,
  onProgress?: (done: number, total: number) => void,
): Promise<BackfillResult> {
  const registry = backfillRegistry;
  const result = {
    chats: 0,
    read: 0,
    ready: false,
    runs: 0,
    entries: 0,
    calls: 0,
    failed: 0,
    costUsd: 0,
  };
  if (!registry || !isTaskBoardAvailable()) return result;
  result.ready = true;
  const sinceMs = Date.now() - windowMs;
  const logged = await readTaskQuestions();
  const shells = registry
    .get(environmentThreadShells.threadShellsAtom)
    .filter(
      (shell) =>
        !shell.archivedAt && !shell.delegatedFrom && Date.parse(shell.updatedAt) >= sinceMs,
    );
  result.chats = shells.length;
  const pending: Array<{ turn: WatchedTurn; exchange: PastExchange }> = [];
  for (const shell of shells) {
    const items = await readTranscriptItems(registry, shell).catch(() => null);
    if (!items) continue;
    result.read += 1;
    // A run is already logged when the log has an entry for the chat from after the run ended.
    const loggedAt = logged
      .filter((entry) => entry.threadId === shell.id && entry.environmentId === shell.environmentId)
      .map((entry) => Date.parse(entry.at));
    const exchanges = exchangesFromTranscript(items, sinceMs);
    // A chat still working on its last prompt gets that prompt from the live watcher later.
    if (shell.latestRun && shell.latestRun.status !== "completed") exchanges.pop();
    for (const exchange of exchanges) {
      if (loggedAt.some((at) => at >= exchange.endedAt)) continue;
      pending.push({ turn: watchedTurn(registry, shell, exchange), exchange });
    }
  }
  pending.sort((a, b) => a.exchange.endedAt - b.exchange.endedAt);
  result.runs = pending.length;
  onProgress?.(0, pending.length);
  for (let start = 0; start < pending.length; start += MAX_TURNS_PER_CALL) {
    const batch = pending.slice(start, start + MAX_TURNS_PER_CALL);
    const turns = batch.map((entry) => entry.turn);
    const startedAt = Date.now();
    let call: DesktopTaskClassifyResult | null = null;
    let entries = 0;
    let error: string | undefined;
    try {
      const board = await readTaskBoard();
      call = await window.desktopBridge!.taskBoard!.classify({
        system: WATCHER_SYSTEM_PROMPT,
        prompt: `${buildWatcherPrompt(board, turns)}\n\nThese are past turns, for the log only: reply with "ops":[] and fill in the log.`,
        model: WATCHER_MODEL,
      });
      if (call.error) error = call.error;
      const logEntries = parseWatcherLog(call.text, turns, board, (turn) =>
        new Date(batch[turn - 1]?.exchange.endedAt ?? startedAt).toISOString(),
      );
      entries = logEntries.length;
      await recordTaskQuestions(logEntries);
    } catch (cause) {
      error ??= cause instanceof Error ? cause.message : "The backfill call failed";
    }
    const ok = call?.text != null && !error;
    result.calls += 1;
    result.entries += entries;
    result.costUsd += call?.costUsd ?? 0;
    if (!ok) result.failed += 1;
    void recordTaskUsage({
      at: new Date(startedAt).toISOString(),
      model: call?.model ?? WATCHER_MODEL,
      ok,
      turns: batch.length,
      chats: [...new Set(turns.map((turn) => turn.threadTitle))],
      changes: entries,
      inputTokens: call?.inputTokens ?? 0,
      outputTokens: call?.outputTokens ?? 0,
      cacheReadTokens: call?.cacheReadTokens ?? 0,
      cacheWriteTokens: call?.cacheWriteTokens ?? 0,
      costUsd: call?.costUsd ?? 0,
      durationMs: call?.durationMs || Date.now() - startedAt,
      // oxlint-disable-next-line t3code/no-untranslated-copy -- usage log record, not UI copy
      ...(error ? { error: `Backfill: ${error}` } : {}),
    });
    onProgress?.(Math.min(start + batch.length, pending.length), pending.length);
  }
  return result;
}

interface PendingTurn {
  readonly key: string;
  readonly shell: EnvironmentThreadShell;
  readonly reply: string;
}

/**
 * Watches every chat on every connected environment while "Watch my chats" is on. When a prompt's
 * turn finishes, it batches the prompt and the final reply, and one cheap model call updates the
 * task board. Wakes from background work, delegated child threads and archived threads are left
 * out, and a thread's turns from before the watcher started never count.
 */
export function startTaskWatcher(registry: AtomRegistry.AtomRegistry): () => void {
  if (!isTaskBoardAvailable()) return () => undefined;
  backfillRegistry = registry;
  const seen = new Map<string, string | null>();
  const pending = new Map<string, PendingTurn>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastCallAt = 0;
  let busy = false;
  let stopShells: (() => void) | null = null;

  /** The chat's latest prompt, the answers given during it, and the agent's last reply. */
  const latestExchange = async (shell: EnvironmentThreadShell) => {
    const items = await readTranscriptItems(registry, shell);
    const last = items ? exchangesFromTranscript(items).at(-1) : undefined;
    return {
      prompt: last?.prompt ?? "",
      decisions: last?.decisions ?? [],
      reply: last?.reply ?? "",
    };
  };

  const schedule = (delay: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), delay);
  };

  async function flush(): Promise<void> {
    if (busy || pending.size === 0) return;
    const wait = lastCallAt + MIN_GAP_MS - Date.now();
    if (wait > 0) return schedule(wait);
    busy = true;
    const batch = [...pending.values()].slice(0, MAX_TURNS_PER_CALL);
    for (const entry of batch) pending.delete(entry.key);
    setStatus({ running: true, queued: pending.size });
    lastCallAt = Date.now();
    let changes = 0;
    let failed = false;
    const turns: WatchedTurn[] = [];
    let result: DesktopTaskClassifyResult | null = null;
    let error: string | undefined;
    try {
      for (const { shell, reply } of batch) {
        const exchange = await latestExchange(shell).catch(() => null);
        turns.push(
          watchedTurn(registry, shell, {
            prompt: exchange?.prompt ?? "",
            decisions: exchange?.decisions ?? [],
            // The shell's latest message can be a tool card; the transcript has the real reply.
            reply: exchange?.reply || reply,
          }),
        );
      }
      const board = await readTaskBoard();
      result = await window.desktopBridge!.taskBoard!.classify({
        system: WATCHER_SYSTEM_PROMPT,
        prompt: buildWatcherPrompt(board, turns),
        model: WATCHER_MODEL,
      });
      failed = result.text === null;
      if (result.error) error = result.error;
      const ops = parseWatcherOps(result.text);
      changes = ops.length;
      if (ops.length > 0) await changeTaskBoard((current) => applyWatcherOps(current, turns, ops));
      // After the ops, so a new project's log entries match the board's spelling.
      const after = ops.length > 0 ? await readTaskBoard().catch(() => board) : board;
      await recordTaskQuestions(
        parseWatcherLog(result.text, turns, after, new Date(lastCallAt).toISOString()),
      );
    } catch (cause) {
      failed = true;
      error ??= cause instanceof Error ? cause.message : "The watcher call failed";
    } finally {
      void recordTaskUsage({
        at: new Date(lastCallAt).toISOString(),
        model: result?.model ?? WATCHER_MODEL,
        ok: !failed,
        turns: batch.length,
        chats: [...new Set(batch.map((entry) => entry.shell.title))],
        changes,
        inputTokens: result?.inputTokens ?? 0,
        outputTokens: result?.outputTokens ?? 0,
        cacheReadTokens: result?.cacheReadTokens ?? 0,
        cacheWriteTokens: result?.cacheWriteTokens ?? 0,
        costUsd: result?.costUsd ?? 0,
        durationMs: result?.durationMs || Date.now() - lastCallAt,
        ...(error ? { error } : {}),
      });
      busy = false;
      setStatus({
        running: false,
        lastRunAt: Date.now(),
        lastChanges: changes,
        lastFailed: failed,
        queued: pending.size,
        calls: status.calls + 1,
      });
      if (pending.size > 0) schedule(BATCH_DELAY_MS);
    }
  }

  const observe = (shells: ReadonlyArray<EnvironmentThreadShell>) => {
    let added = false;
    for (const shell of shells) {
      const key = `${shell.environmentId}:${shell.id}`;
      const completedAt =
        shell.latestRun?.status === "completed" ? (shell.latestRun.completedAt ?? null) : null;
      const previous = seen.get(key);
      seen.set(key, completedAt);
      // The first look at a thread is its baseline; only turns that finish later count.
      if (previous === undefined || completedAt === null || completedAt === previous) continue;
      if (shell.archivedAt || shell.delegatedFrom || shell.source.latestRunFromNotification) {
        continue;
      }
      const message = shell.source.latestVisibleMessage;
      pending.set(key, { key, shell, reply: message?.role === "assistant" ? message.text : "" });
      added = true;
    }
    if (added) {
      setStatus({ queued: pending.size });
      schedule(BATCH_DELAY_MS);
    }
  };

  const sync = () => {
    const enabled = getClientSettings().taskWatcherEnabled;
    if (enabled && !stopShells) {
      seen.clear();
      observe(registry.get(environmentThreadShells.threadShellsAtom));
      stopShells = registry.subscribe(environmentThreadShells.threadShellsAtom, observe);
    } else if (!enabled && stopShells) {
      stopShells();
      stopShells = null;
      pending.clear();
      clearTimeout(timer);
      setStatus({ queued: 0 });
    }
  };

  sync();
  const stopSettings = subscribeClientSettings(sync);
  return () => {
    backfillRegistry = null;
    stopSettings();
    stopShells?.();
    clearTimeout(timer);
  };
}
