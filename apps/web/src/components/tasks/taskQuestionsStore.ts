import { useSyncExternalStore } from "react";

import {
  parseQuestionLog,
  serializeQuestionEntries,
  type QuestionEntry,
} from "./taskQuestions.logic";
import { isTasksPopout } from "./tasksPopout";

/** The question log for this window: loaded from disk once, then added to as the watcher runs. */
interface TaskQuestionsState {
  readonly entries: ReadonlyArray<QuestionEntry>;
  readonly loaded: boolean;
}

let state: TaskQuestionsState = { entries: [], loaded: false };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

const bridge = () => (typeof window === "undefined" ? undefined : window.desktopBridge?.taskBoard);

function publish(next: TaskQuestionsState) {
  state = next;
  for (const listener of listeners) listener();
}

function load(): Promise<void> {
  const taskBoard = bridge();
  if (!taskBoard) return Promise.resolve();
  loading ??= taskBoard
    .readQuestions()
    .then((text) => publish({ entries: parseQuestionLog(text), loaded: true }))
    .catch(() => publish({ entries: [], loaded: true }));
  return loading;
}

// The Tasks window doesn't run the watcher, so it re-reads the log the main window writes.
const POPOUT_RELOAD_MS = 20_000;
let stopReloading: (() => void) | null = null;

function reload() {
  const taskBoard = bridge();
  if (!taskBoard) return;
  void taskBoard
    .readQuestions()
    .then((text) => {
      const entries = parseQuestionLog(text);
      if (entries.length !== state.entries.length || entries[0]?.at !== state.entries[0]?.at) {
        publish({ entries, loaded: true });
      }
    })
    .catch(() => undefined);
}

function startReloading() {
  if (!isTasksPopout || stopReloading) return;
  const timer = window.setInterval(reload, POPOUT_RELOAD_MS);
  window.addEventListener("focus", reload);
  stopReloading = () => {
    window.clearInterval(timer);
    window.removeEventListener("focus", reload);
    stopReloading = null;
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  void load();
  startReloading();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopReloading?.();
  };
}

export function useTaskQuestions(): TaskQuestionsState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Saves the watcher's new entries to the log and shows them at once. */
export async function recordTaskQuestions(entries: ReadonlyArray<QuestionEntry>): Promise<void> {
  const taskBoard = bridge();
  if (!taskBoard || entries.length === 0) return;
  await load();
  publish({ entries: [...entries, ...state.entries], loaded: true });
  await taskBoard.appendQuestions(serializeQuestionEntries(entries)).catch(() => false);
}

/** Every entry so far, newest first. */
export async function readTaskQuestions(): Promise<ReadonlyArray<QuestionEntry>> {
  await load();
  return state.entries;
}
