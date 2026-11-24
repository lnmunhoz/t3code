import { useSyncExternalStore } from "react";

import {
  EMPTY_TASK_BOARD,
  parseTaskBoard,
  serializeTaskBoard,
  type TaskBoard,
} from "./taskBoard.logic";

/**
 * One copy of the board for the whole window, shared by the Tasks page and the watcher. Every
 * change re-reads the file first, so an agent's edit made a moment ago is kept, and changes run
 * one at a time.
 */
interface TaskBoardState {
  readonly board: TaskBoard;
  readonly loaded: boolean;
  readonly filePath: string | null;
}

let state: TaskBoardState = { board: EMPTY_TASK_BOARD, loaded: false, filePath: null };
const listeners = new Set<() => void>();
let queue: Promise<unknown> = Promise.resolve();
let started = false;
let stopExternal: (() => void) | null = null;

const bridge = () => (typeof window === "undefined" ? undefined : window.desktopBridge?.taskBoard);

function publish(next: Partial<TaskBoardState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function start() {
  const taskBoard = bridge();
  if (started || !taskBoard) return;
  started = true;
  void taskBoard.filePath().then((filePath) => publish({ filePath }));
  queue = queue.then(async () => {
    publish({ board: parseTaskBoard(await taskBoard.read()), loaded: true });
  });
  stopExternal = taskBoard.subscribe((text) => publish({ board: parseTaskBoard(text) }));
}

function subscribe(listener: () => void) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && stopExternal) {
      stopExternal();
      stopExternal = null;
      started = false;
    }
  };
}

export function isTaskBoardAvailable(): boolean {
  return bridge() !== undefined;
}

export function useTaskBoard(): TaskBoardState {
  return useSyncExternalStore(subscribe, () => state);
}

const IDLE: TaskBoardState = { board: EMPTY_TASK_BOARD, loaded: false, filePath: null };
const subscribeNothing = () => () => {};

/** The board only while `enabled`, so a hook in every composer doesn't watch the file. */
export function useTaskBoardWhen(enabled: boolean): TaskBoardState {
  return useSyncExternalStore(enabled ? subscribe : subscribeNothing, () =>
    enabled ? state : IDLE,
  );
}

/** Applies `change` to the newest board on disk and saves it. */
export function changeTaskBoard(change: (board: TaskBoard) => TaskBoard): Promise<void> {
  const taskBoard = bridge();
  if (!taskBoard) return Promise.resolve();
  // Show the change at once; the queued write below re-applies it to the file's newest copy.
  publish({ board: change(state.board) });
  const run = queue.then(async () => {
    const current = parseTaskBoard(await taskBoard.read());
    const next = change(current);
    const text = serializeTaskBoard(next);
    if (text !== serializeTaskBoard(current)) await taskBoard.write(text);
    publish({ board: next, loaded: true });
  });
  queue = run.catch(() => undefined);
  return run;
}

/** The newest board on disk, read in turn with pending changes. */
export function readTaskBoard(): Promise<TaskBoard> {
  const taskBoard = bridge();
  if (!taskBoard) return Promise.resolve(EMPTY_TASK_BOARD);
  const run = queue.then(async () => parseTaskBoard(await taskBoard.read()));
  queue = run.catch(() => undefined);
  return run;
}

/** Calls `listener` with the board now and on every change; the watcher and alerts use it. */
export function subscribeTaskBoard(listener: (board: TaskBoard) => void): () => void {
  const notify = () => listener(state.board);
  const stop = subscribe(notify);
  notify();
  return stop;
}
