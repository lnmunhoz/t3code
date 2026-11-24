import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";

import type { AppRouter } from "~/router";
import { buildThreadRouteParams } from "~/threadRoutes";

/**
 * Fork: this page is the Tasks window (opened with the pop-out button on the Tasks page), which
 * shows only the Tasks page. The desktop app loads it with `?popout=tasks`.
 */
export const isTasksPopout =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("popout") === "tasks";

const bridge = () => (typeof window === "undefined" ? undefined : window.desktopBridge?.taskBoard);

/** The Tasks page can open in its own window (desktop app only). */
export function canPopOutTasks(): boolean {
  return !isTasksPopout && typeof bridge()?.openPopout === "function";
}

export function popOutTasks(): void {
  void bridge()
    ?.openPopout()
    .catch(() => false);
}

/**
 * Opens a chat from the Tasks page: here in the main window, or, from the Tasks window, in the
 * main window, which comes forward.
 */
export function useOpenTaskThread(): (environmentId: string, threadId: string) => void {
  const navigate = useNavigate();
  return (environmentId, threadId) => {
    const taskBoard = bridge();
    if (isTasksPopout && taskBoard?.showThread) {
      void taskBoard.showThread({ environmentId, threadId }).catch(() => false);
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId as never, threadId as never)),
    });
  };
}

/** In the main window: show the chats the Tasks window asks for. */
export function startTasksPopoutThreadOpening(router: AppRouter): () => void {
  const onOpenThread = bridge()?.onOpenThread;
  if (isTasksPopout || typeof onOpenThread !== "function") return () => {};
  return onOpenThread(({ environmentId, threadId }) => {
    void router.navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId as never, threadId as never)),
    });
  });
}
