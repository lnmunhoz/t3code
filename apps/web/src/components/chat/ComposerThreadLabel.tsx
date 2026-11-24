import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { ChevronRightIcon, ListTodoIcon } from "lucide-react";

import { useRightPanelStore } from "~/rightPanelStore";

import { ProjectFavicon, type ProjectFaviconProject } from "../ProjectFavicon";
import { projectForThread } from "../tasks/taskBoard.logic";
import { isTaskBoardAvailable, useTaskBoard } from "../tasks/taskBoardStore";

/**
 * Fork: the project and chat this message goes to, just above the composer, so a prompt meant for
 * one chat doesn't land in another. When a Tasks board task links the chat, its board project
 * (the real project, like "ThaiLookup") replaces the T3 project (often a folder like "home").
 * The list button opens that project's tasks in the right panel.
 */
export function ComposerThreadLabel(props: {
  project: ProjectFaviconProject;
  environmentId: EnvironmentId;
  threadId: ThreadId;
  threadTitle: string | null;
}) {
  const gt = useGT();
  const { board } = useTaskBoard();
  const boardProject = projectForThread(board, props.environmentId, props.threadId);
  const threadTitle = props.threadTitle?.trim() || null;
  return (
    <div className="flex min-w-0 px-2 pb-1.5">
      <div
        data-composer-thread-label
        className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md bg-background/85 px-1.5 py-0.5 text-xs backdrop-blur-sm"
      >
        {isTaskBoardAvailable() ? (
          <button
            type="button"
            aria-label={gt("Show this project's tasks")}
            className="-ml-0.5 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() =>
              useRightPanelStore
                .getState()
                .open(scopeThreadRef(props.environmentId, props.threadId), "tasks")
            }
          >
            <ListTodoIcon className="size-3.5" />
          </button>
        ) : null}
        {boardProject ? null : (
          <ProjectFavicon project={props.project} className="size-4 shrink-0" />
        )}
        <span className="shrink-0 font-medium text-foreground/90">
          {boardProject?.text ?? props.project.title}
        </span>
        {threadTitle ? (
          <>
            <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground/60" aria-hidden />
            <span className="min-w-0 truncate text-muted-foreground">{threadTitle}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
