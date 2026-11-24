import { msg, T, useGT, useMessages, Var } from "gt-react";
import { ListChecksIcon, MessageSquareIcon } from "lucide-react";

import { Checkbox } from "~/components/ui/checkbox";
import { useNowMinute } from "~/hooks/useNowMinute";
import { cn } from "~/lib/utils";
import { formatRelativeTime } from "~/timestampFormat";

import {
  kanbanColumns,
  setTaskStatus,
  type KanbanCard,
  type KanbanColumn,
  type TaskBoard,
  type TaskItem,
  type TaskLiveState,
} from "./taskBoard.logic";
import { MilestoneChip } from "./Milestones";
import { LabelChips } from "./TaskLabels";
import { changeTaskBoard } from "./taskBoardStore";
import { TaskProjectIcon } from "./TaskProjectIcon";
import { TaskWorkingBadge, WorkingGlow } from "./TaskWorking";
import { useOpenTaskThread } from "./tasksPopout";

// Done shows the last week; older finished tasks are in the List view.
const DONE_DAYS = 7;

const COLUMNS: ReadonlyArray<{ id: KanbanColumn; title: string; empty: string }> = [
  { id: "todo", title: msg("To do"), empty: msg("Nothing queued") },
  { id: "progress", title: msg("In progress"), empty: msg("Nothing started") },
  { id: "review", title: msg("In review"), empty: msg("Nothing to check") },
  { id: "waiting", title: msg("Waiting on you"), empty: msg("Nothing needs you") },
  { id: "done", title: msg("Done this week"), empty: msg("Nothing finished yet") },
];

/**
 * The Tasks page's Board view: every project's tasks as cards by state. Only agents move them,
 * by changing a task's status or by working on it, so there is no dragging. A click opens the chat.
 */
export function KanbanView({
  board,
  live,
}: {
  board: TaskBoard;
  live: ReadonlyMap<string, TaskLiveState>;
}) {
  // The minute clock is UTC without a zone mark ("2026-11-22T08:52").
  const m = useMessages();
  const nowMs = Date.parse(`${useNowMinute()}:00Z`);
  const columns = kanbanColumns(board.items, live, nowMs - DONE_DAYS * 86_400_000);
  const workingNow = columns.progress.filter((card) => card.working !== null).length;
  return (
    <div className="flex min-h-0 gap-3 overflow-x-auto pb-2">
      {COLUMNS.map((column) => (
        <section
          key={column.id}
          aria-label={m(column.title)}
          className="flex min-w-60 flex-1 flex-col gap-2 rounded-lg bg-muted/40 p-2"
        >
          <h2 className="flex items-center gap-2 px-1 font-medium text-muted-foreground text-xs">
            {m(column.title)}
            <span className="tabular-nums opacity-70">{columns[column.id].length}</span>
            {column.id === "progress" && workingNow > 0 ? (
              <T>
                <span className="text-info tabular-nums">
                  <Var>{workingNow}</Var> working now
                </span>
              </T>
            ) : null}
          </h2>
          {columns[column.id].length === 0 ? (
            <p className="px-1 py-2 text-muted-foreground text-xs">{m(column.empty)}</p>
          ) : (
            columns[column.id].map((card) => (
              <Card
                key={card.item.id}
                card={card}
                column={column.id}
                nowMs={nowMs}
                project={board.items.find((project) =>
                  project.children.some((task) => task.id === card.item.id),
                )}
              />
            ))
          )}
        </section>
      ))}
    </div>
  );
}

function Card({
  card,
  column,
  nowMs,
  project,
}: {
  card: KanbanCard;
  column: KanbanColumn;
  nowMs: number;
  /** The board project the card's task is in, for its milestone. */
  project: TaskItem | undefined;
}) {
  const gt = useGT();
  const openThread = useOpenTaskThread();
  const { item } = card;
  const thread = card.working ?? item.threads[0] ?? card.parent?.threads[0] ?? null;
  const at = column === "done" && item.doneAt ? item.doneAt : item.updatedAt;
  const relative = formatRelativeTime(at, nowMs);
  const done = item.status === "done";
  return (
    <div
      className={cn(
        "relative isolate flex items-start gap-2 rounded-md border bg-background p-2",
        thread && "hover:bg-accent/60",
        done && "opacity-70",
      )}
    >
      {card.working ? <WorkingGlow /> : null}
      {/* Ticking a card off moves it to Done; unticking one there opens it again. */}
      <Checkbox
        className="mt-0.5"
        checked={done}
        onCheckedChange={(checked) =>
          void changeTaskBoard((current) =>
            setTaskStatus(current, item.id, checked ? "done" : "active"),
          )
        }
        aria-label={done ? gt("Mark as not done") : gt("Mark as done")}
      />
      <button
        type="button"
        disabled={!thread}
        onClick={() => thread && openThread(thread.environmentId, thread.threadId)}
        className="flex min-w-0 flex-1 flex-col gap-1.5 text-start"
      >
        <span className={cn("text-sm", done && "line-through")}>{item.text}</span>
        {item.note ? (
          <span className="line-clamp-2 text-muted-foreground text-xs">{item.note}</span>
        ) : null}
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
          <span className="flex min-w-0 items-center gap-1">
            <TaskProjectIcon name={card.project} className="size-3" />
            <span className="truncate">{card.project}</span>
          </span>
          {card.parent ? <span className="min-w-0 truncate">› {card.parent.text}</span> : null}
          {project ? <MilestoneChip project={project} task={item} /> : null}
          <LabelChips labels={item.labels} />
          {card.subtasks.total > 0 ? (
            <span className="flex items-center gap-0.5 tabular-nums">
              <ListChecksIcon aria-hidden className="size-3" />
              {card.subtasks.done}/{card.subtasks.total}
            </span>
          ) : null}
          {thread ? <MessageSquareIcon aria-hidden className="size-3" /> : null}
          <span className="ms-auto flex items-center gap-2">
            {card.working ? <TaskWorkingBadge working={card.working} /> : null}
            {relative ? (
              <span className="tabular-nums">{relative.suffix ? relative.value : "now"}</span>
            ) : null}
          </span>
        </span>
      </button>
    </div>
  );
}
