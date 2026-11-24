import { T, useGT, Var } from "gt-react";
import { CircleCheckIcon, MessageSquareIcon, PinIcon, PinOffIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useNowMinute } from "~/hooks/useNowMinute";
import { cn } from "~/lib/utils";

import {
  nowTasks,
  tasksDoneSince,
  type NowTask,
  type TaskBoard,
  type TaskLiveState,
} from "./taskBoard.logic";
import { periodWindow } from "./taskQuestions.logic";
import { TaskProjectIcon } from "./TaskProjectIcon";
import { TaskWorkingBadge, WorkingGlow } from "./TaskWorking";
import { useOpenTaskThread } from "./tasksPopout";

// A task that just turned to waiting on you stays highlighted this long.
const FRESH_WAITING_MS = 30_000;

/**
 * The top of the List view: every task a chat is working on or waiting on you for, across
 * projects, each with its latest note. A click opens the chat.
 */
export function NowStrip({
  board,
  live,
}: {
  board: TaskBoard;
  live: ReadonlyMap<string, TaskLiveState>;
}) {
  const rows = nowTasks(board.items, live);
  const fresh = useFreshWaiting(rows.filter((row) => row.state.waiting).map((row) => row.item.id));
  const gt = useGT();
  if (rows.length === 0) return null;
  return (
    <section
      aria-label={gt("Now", { $context: "heading for tasks in progress right now" })}
      className="flex flex-col gap-0.5 rounded-lg border p-1.5"
    >
      <h2 className="px-1.5 pt-0.5 pb-1 font-medium text-muted-foreground text-xs">
        <T context="heading for tasks in progress right now">Now</T>
      </h2>
      {rows.map((row) => (
        <NowRow key={row.item.id} row={row} fresh={fresh.has(row.item.id)} />
      ))}
    </section>
  );
}

function NowRow({ row, fresh }: { row: NowTask; fresh: boolean }) {
  const openThread = useOpenTaskThread();
  const { item, state } = row;
  const thread = state.working ?? item.threads[0] ?? null;
  return (
    <button
      type="button"
      disabled={!thread}
      onClick={() => thread && openThread(thread.environmentId, thread.threadId)}
      className={cn(
        "relative isolate flex min-w-0 items-start gap-2 rounded-md px-1.5 py-1 text-start hover:bg-accent/60",
        // A task that just turned to waiting on you.
        fresh && "animate-pulse bg-warning-surface",
      )}
    >
      {state.working && !state.waiting ? <WorkingGlow /> : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm">{item.text}</span>
          <span className="flex shrink-0 items-center gap-1 self-center text-muted-foreground text-xs">
            <TaskProjectIcon name={row.project} className="size-3" />
            {row.project}
          </span>
        </span>
        {item.note ? (
          <span className="truncate text-muted-foreground text-xs">{item.note}</span>
        ) : null}
      </div>
      {state.waiting ? (
        <span className="mt-0.5 shrink-0 rounded-full bg-warning-surface px-2 py-0.5 text-2xs text-warning-foreground">
          <T>Waiting on you</T>
        </span>
      ) : state.working ? (
        <TaskWorkingBadge working={state.working} />
      ) : null}
      {thread ? (
        <MessageSquareIcon aria-hidden className="mt-1 size-3 shrink-0 text-muted-foreground" />
      ) : null}
    </button>
  );
}

/** Ids that joined the list since the last render, for a short while. */
function useFreshWaiting(ids: ReadonlyArray<string>): ReadonlySet<string> {
  const seen = useRef<ReadonlySet<string> | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const key = ids.join(",");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- starts a timer per newly waiting task that ends its highlight
  useEffect(() => {
    const current = new Set(key ? key.split(",") : []);
    const previous = seen.current;
    seen.current = current;
    // Tasks already waiting when the page opens aren't news.
    if (!previous) return;
    const added = [...current].filter((id) => !previous.has(id));
    if (added.length === 0) return;
    setFresh((value) => new Set([...value, ...added]));
    window.setTimeout(
      () => setFresh((value) => new Set([...value].filter((id) => !added.includes(id)))),
      FRESH_WAITING_MS,
    );
  }, [key]);
  return fresh;
}

/** "5 done today" in the header; opens the list of what you ticked off today. */
export function DoneTodayButton({ board }: { board: TaskBoard }) {
  // The minute clock is UTC without a zone mark ("2026-11-22T08:52").
  const nowMs = Date.parse(`${useNowMinute()}:00Z`);
  const today = periodWindow("today", nowMs);
  const rows = today ? tasksDoneSince(board.items, today.from) : [];
  const gt = useGT();
  if (rows.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger
        render={<Button size="compact" variant="ghost" aria-label={gt("Done today")} />}
      >
        <CircleCheckIcon />
        <T>
          <span className="tabular-nums">
            <Var>{rows.length}</Var>
          </span>{" "}
          done today
        </T>
      </PopoverTrigger>
      <PopoverPopup align="end" aria-label={gt("Done today")} className="w-80">
        <div className="flex max-h-96 flex-col gap-1 overflow-y-auto">
          {rows.map(({ project, item }) => (
            <div key={item.id} className="flex items-start gap-2 py-0.5 text-sm">
              <CircleCheckIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-success" />
              <span className="min-w-0 flex-1">
                {item.text}
                <span className="ms-2 inline-flex items-center gap-1 align-middle text-muted-foreground text-xs">
                  <TaskProjectIcon name={project} className="size-3" />
                  {project}
                </span>
              </span>
              <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                {item.doneAt
                  ? new Date(item.doneAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : ""}
              </span>
            </div>
          ))}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

/** In the Tasks window: keep it above other apps. */
export function PinWindowButton() {
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge?.taskBoard;
  const [pinned, setPinned] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the native window's always-on-top state over IPC once mounted
  useEffect(() => {
    void bridge
      ?.pinPopout(null)
      .then(setPinned)
      .catch(() => undefined);
  }, [bridge]);
  const gt = useGT();
  if (!bridge?.pinPopout) return null;
  const label = pinned ? gt("Stop keeping on top") : gt("Keep on top of other apps");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-sm"
            variant={pinned ? "secondary" : "ghost"}
            aria-label={label}
            aria-pressed={pinned}
            onClick={() =>
              void bridge
                .pinPopout(!pinned)
                .then(setPinned)
                .catch(() => undefined)
            }
          />
        }
      >
        {pinned ? <PinOffIcon /> : <PinIcon />}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}
