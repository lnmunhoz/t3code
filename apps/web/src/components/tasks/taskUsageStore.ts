import { useSyncExternalStore } from "react";

import { parseTaskUsage, serializeTaskUsage, type TaskUsageRecord } from "./taskUsage.logic";

/** The watcher's call log for this window: loaded from disk once, then added to as calls finish. */
interface TaskUsageState {
  readonly records: ReadonlyArray<TaskUsageRecord>;
  readonly loaded: boolean;
}

let state: TaskUsageState = { records: [], loaded: false };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

const bridge = () => (typeof window === "undefined" ? undefined : window.desktopBridge?.taskBoard);

function publish(next: TaskUsageState) {
  state = next;
  for (const listener of listeners) listener();
}

function load(): Promise<void> {
  const taskBoard = bridge();
  if (!taskBoard) return Promise.resolve();
  loading ??= taskBoard
    .readUsage()
    .then((text) => publish({ records: parseTaskUsage(text), loaded: true }))
    .catch(() => publish({ records: [], loaded: true }));
  return loading;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  void load();
  return () => listeners.delete(listener);
}

export function useTaskUsage(): TaskUsageState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Saves one watcher call to the log and shows it at once. */
export async function recordTaskUsage(record: TaskUsageRecord): Promise<void> {
  const taskBoard = bridge();
  if (!taskBoard) return;
  await load();
  publish({ records: [record, ...state.records], loaded: true });
  await taskBoard.appendUsage(serializeTaskUsage(record)).catch(() => false);
}
