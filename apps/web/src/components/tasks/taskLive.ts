import {
  resolveThreadWorkingStartedAt,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import type { AtomRegistry } from "effect/reactivity";

import { environmentThreadShells } from "~/state/threads";

import { taskLiveStates, type ChatLiveState, type TaskBoard } from "./taskBoard.logic";
import { isTaskBoardAvailable, subscribeTaskBoard } from "./taskBoardStore";

/** The sidebar's "Working": a run going, or the chat getting one ready. */
function isWorking(shell: EnvironmentThreadShell): boolean {
  const status = shell.runtime?.status;
  return (
    (status === "running" && shell.blockedOnThreadWait !== true) ||
    status === "waiting" ||
    status === "preparing" ||
    status === "starting" ||
    status === "queued"
  );
}

/** Each chat's live state, by `${environmentId}:${threadId}`. */
export function chatLiveStates(
  shells: ReadonlyArray<EnvironmentThreadShell>,
): Map<string, ChatLiveState> {
  const chats = new Map<string, ChatLiveState>();
  for (const shell of shells) {
    const working = isWorking(shell);
    chats.set(`${shell.environmentId}:${shell.id}`, {
      working,
      startedAt: working ? resolveThreadWorkingStartedAt(shell) : null,
      needsYou:
        shell.hasPendingApprovals ||
        shell.hasPendingUserInput ||
        shell.asksUserQuestion === true ||
        shell.pendingSubagentRequest === "approval" ||
        shell.pendingSubagentRequest === "user_input",
      lastUserAt: shell.latestUserAuthoredMessageAt ?? shell.latestUserMessageAt,
    });
  }
  return chats;
}

/**
 * In the main window: when a task turns to "Waiting on you", the desktop app bounces its Dock
 * icon (once per task, only while you're in another app). The Tasks page highlights the row.
 */
export function startWaitingAlerts(registry: AtomRegistry.AtomRegistry): () => void {
  const alert = window.desktopBridge?.taskBoard?.alertWaiting;
  if (!isTaskBoardAvailable() || typeof alert !== "function") return () => {};
  let board: TaskBoard | null = null;
  let shells: ReadonlyArray<EnvironmentThreadShell> = registry.get(
    environmentThreadShells.threadShellsAtom,
  );
  // Null until the first look, so tasks already waiting at startup don't alert.
  let waiting: Set<string> | null = null;
  const check = () => {
    if (!board) return;
    const next = new Set<string>();
    for (const [id, state] of taskLiveStates(board.items, chatLiveStates(shells))) {
      if (state.waiting) next.add(id);
    }
    const fresh = waiting ? [...next].filter((id) => !waiting!.has(id)) : [];
    waiting = next;
    if (fresh.length > 0) void alert().catch(() => false);
  };
  const stopBoard = subscribeTaskBoard((next) => {
    // The first notice is the empty board before the file is read.
    if (next.items.length === 0 && board === null) return;
    board = next;
    check();
  });
  const stopShells = registry.subscribe(environmentThreadShells.threadShellsAtom, (next) => {
    shells = next;
    check();
  });
  return () => {
    stopBoard();
    stopShells();
  };
}
