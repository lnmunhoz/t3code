import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { PreviewSessionSnapshot, ThreadId } from "@t3tools/contracts";

type ThreadPlace = Pick<EnvironmentThreadShell, "environmentId" | "id" | "projectId">;

export interface PinnedTab {
  readonly ownerThreadId: ThreadId;
  readonly tabId: string;
  readonly snapshot: PreviewSessionSnapshot;
}

/** The tabs pinned in `thread`'s project by its other threads; its own pins are already its tabs. */
export function pinnedTabsForThread(
  sessions: ReadonlyArray<PreviewSessionSnapshot>,
  shells: ReadonlyArray<ThreadPlace>,
  thread: ThreadPlace,
): ReadonlyArray<PinnedTab> {
  const projectByThread = new Map<string, string>();
  for (const shell of shells) {
    if (shell.environmentId === thread.environmentId)
      projectByThread.set(shell.id, shell.projectId);
  }
  return sessions
    .filter(
      (session) =>
        session.pinned === true &&
        session.threadId !== thread.id &&
        projectByThread.get(session.threadId) === thread.projectId,
    )
    .map((session) => ({
      ownerThreadId: session.threadId as ThreadId,
      tabId: session.tabId,
      snapshot: session,
    }));
}
