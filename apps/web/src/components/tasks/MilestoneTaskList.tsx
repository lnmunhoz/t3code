import { msg, T, useGT, useMessages } from "gt-react";
import {
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleIcon,
  CirclePauseIcon,
  EyeIcon,
  MessageSquareIcon,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { useNowMinute } from "~/hooks/useNowMinute";
import { cn } from "~/lib/utils";
import { formatRelativeTime } from "~/timestampFormat";

import {
  kanbanColumns,
  labelsIn,
  setTaskStatus,
  type KanbanCard,
  type KanbanColumn,
  type TaskItem,
  type TaskLiveState,
} from "./taskBoard.logic";
import { changeTaskBoard } from "./taskBoardStore";
import { LabelChips, LabelMenu } from "./TaskLabels";
import { TaskWorkingBadge, WorkingGlow } from "./TaskWorking";
import { useOpenTaskThread } from "./tasksPopout";

const GROUPS: ReadonlyArray<{
  id: KanbanColumn;
  title: string;
  Icon: LucideIcon;
  tone: string;
}> = [
  { id: "todo", title: msg("To do"), Icon: CircleIcon, tone: "text-muted-foreground" },
  { id: "progress", title: msg("In progress"), Icon: CircleDotIcon, tone: "text-info" },
  { id: "review", title: msg("In review"), Icon: EyeIcon, tone: "text-primary" },
  { id: "waiting", title: msg("Waiting on you"), Icon: CirclePauseIcon, tone: "text-warning" },
  {
    id: "done",
    title: msg("Done", { $context: "task state" }),
    Icon: CircleCheckIcon,
    tone: "text-success",
  },
];

/**
 * A milestone's tasks as a list grouped by state, after Cello's milestone page: the same groups
 * as the Board, one line per task with its labels. The state icon ticks a task off; the row opens
 * its chat.
 */
export function MilestoneTaskList({
  project,
  tasks,
  live,
}: {
  project: TaskItem;
  tasks: ReadonlyArray<TaskItem>;
  live: ReadonlyMap<string, TaskLiveState>;
}) {
  const m = useMessages();
  const [folded, setFolded] = useState<Readonly<Record<string, boolean>>>({});
  const nowMs = Date.parse(`${useNowMinute()}:00Z`);
  if (tasks.length === 0) {
    return (
      <p className="ps-6 text-muted-foreground text-xs">
        <T>No tasks yet. Put one in from its menu in the List view.</T>
      </p>
    );
  }
  const columns = kanbanColumns([{ ...project, children: [...tasks] }], live, 0);
  const known = labelsIn(project.children);
  return (
    <div className="flex flex-col gap-1">
      {GROUPS.filter((group) => columns[group.id].length > 0).map((group) => {
        const isFolded = folded[group.id] ?? false;
        return (
          <section key={group.id} aria-label={m(group.title)} className="flex flex-col">
            <div className="flex h-8 items-center gap-2 rounded-md bg-muted/60 px-1">
              <button
                type="button"
                aria-expanded={!isFolded}
                onClick={() => setFolded({ ...folded, [group.id]: !isFolded })}
                className="flex h-6 min-w-0 items-center gap-2 rounded-md px-1.5 font-medium text-sm hover:bg-accent/60"
              >
                <ChevronRightIcon
                  aria-hidden
                  className={cn(
                    "size-3 shrink-0 text-muted-foreground transition-transform",
                    !isFolded && "rotate-90",
                  )}
                />
                <group.Icon aria-hidden className={cn("size-3.5 shrink-0", group.tone)} />
                {m(group.title)}
              </button>
              <span className="text-muted-foreground text-sm tabular-nums">
                {columns[group.id].length}
              </span>
            </div>
            {isFolded ? null : (
              <ul className="flex flex-col pt-0.5">
                {columns[group.id].map((card) => (
                  <li key={card.item.id}>
                    <Row card={card} group={group} known={known} nowMs={nowMs} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Row({
  card,
  group,
  known,
  nowMs,
}: {
  card: KanbanCard;
  group: (typeof GROUPS)[number];
  known: ReadonlyArray<string>;
  nowMs: number;
}) {
  const gt = useGT();
  const openThread = useOpenTaskThread();
  const { item } = card;
  const thread = card.working ?? item.threads[0] ?? card.parent?.threads[0] ?? null;
  const done = item.status === "done";
  const relative = formatRelativeTime(done && item.doneAt ? item.doneAt : item.updatedAt, nowMs);
  return (
    <div className="group relative isolate flex h-10 items-center gap-2.5 rounded-md px-2 text-sm hover:bg-accent/60">
      {card.working ? <WorkingGlow /> : null}
      <button
        type="button"
        onClick={() =>
          void changeTaskBoard((current) =>
            setTaskStatus(current, item.id, done ? "active" : "done"),
          )
        }
        aria-label={done ? gt("Mark as not done") : gt("Mark as done")}
        className="flex shrink-0 rounded-full text-muted-foreground hover:text-success"
      >
        <group.Icon aria-hidden className={cn("size-4", group.tone)} />
      </button>
      <button
        type="button"
        disabled={!thread}
        onClick={() => thread && openThread(thread.environmentId, thread.threadId)}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-start"
      >
        <span className={cn("min-w-0 truncate font-medium", done && "text-muted-foreground")}>
          {item.text}
        </span>
        {card.parent ? (
          <>
            <ChevronRightIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
            <span className="min-w-0 shrink-3 truncate text-muted-foreground">
              {card.parent.text}
            </span>
          </>
        ) : null}
        {item.note ? (
          <span className="hidden min-w-0 shrink-4 truncate text-muted-foreground text-xs lg:inline">
            {item.note}
          </span>
        ) : null}
      </button>
      {card.working ? <TaskWorkingBadge working={card.working} /> : null}
      {card.subtasks.total > 0 ? (
        <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
          {card.subtasks.done}/{card.subtasks.total}
        </span>
      ) : null}
      {item.threads.length > 0 ? (
        <span className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs tabular-nums">
          <MessageSquareIcon aria-hidden className="size-3.5" />
          {item.threads.length}
        </span>
      ) : null}
      <LabelChips labels={item.labels} />
      <LabelMenu
        task={item}
        known={known}
        className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 has-data-popup-open:opacity-100"
      />
      {relative ? (
        <span className="w-10 shrink-0 text-end text-muted-foreground text-xs tabular-nums">
          {relative.suffix ? relative.value : "now"}
        </span>
      ) : null}
    </div>
  );
}
