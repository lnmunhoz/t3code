import { msg, T, useGT, useMessages, Var } from "gt-react";
import {
  ChevronRightIcon,
  CircleCheckIcon,
  EllipsisIcon,
  MilestoneIcon,
  PlusIcon,
} from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { useNowMinute } from "~/hooks/useNowMinute";
import type { MessageResolver } from "~/i18n/messages";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import {
  addMilestone,
  dueWords,
  editMilestone,
  milestoneOf,
  milestoneProgress,
  moveMilestone,
  NO_MILESTONE,
  projectMilestones,
  readyToClose,
  removeMilestone,
  setMilestoneState,
  setTaskMilestone,
  tasksInMilestone,
  type MilestoneDraft,
  type MilestoneProgress,
} from "./milestones.logic";
import {
  kanbanColumns,
  type TaskBoard,
  type TaskItem,
  type TaskLiveState,
  type TaskMilestone,
} from "./taskBoard.logic";
import { changeTaskBoard } from "./taskBoardStore";
import { TaskProjectIcon } from "./TaskProjectIcon";
import { MilestoneTaskList } from "./MilestoneTaskList";

const nowFromMinute = (minute: string) => Date.parse(`${minute}:00Z`);

// ── Pieces ──────────────────────────────────────────────────────────────────

/** Done, working, waiting on you, then the rest, as one bar. */
function MilestoneBar({
  progress,
  className,
}: {
  progress: MilestoneProgress;
  className?: string;
}) {
  const gt = useGT();
  const share = (count: number) => (progress.total > 0 ? (count / progress.total) * 100 : 0);
  const parts = [
    { key: "done", count: progress.done, className: "bg-success" },
    { key: "working", count: progress.working, className: "bg-info" },
    { key: "review", count: progress.review, className: "bg-primary" },
    { key: "waiting", count: progress.waiting, className: "bg-warning" },
    { key: "todo", count: progress.todo, className: "bg-muted-foreground/30" },
  ];
  return (
    <div
      role="meter"
      aria-label={gt("Done", { $context: "share of tasks finished" })}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress.pct}
      className={cn("flex h-1.5 overflow-hidden rounded-full bg-muted", className)}
    >
      {parts.map((part) =>
        part.count > 0 ? (
          <div
            key={part.key}
            className={cn("h-full", part.className)}
            style={{ width: `${share(part.count)}%` }}
          />
        ) : null,
      )}
    </div>
  );
}

/** "2 of 5 done · 40%". */
function progressWords(progress: MilestoneProgress, resolve: MessageResolver): string {
  if (progress.total === 0) return resolve(msg("No tasks yet"));
  return resolve(
    msg("{done} of {total} done · {pct}%", {
      done: progress.done,
      total: progress.total,
      pct: progress.pct,
    }),
  );
}

function DueWords({ due, className }: { due: string | undefined; className?: string }) {
  const m = useMessages();
  const nowMs = nowFromMinute(useNowMinute());
  const words = dueWords(due, nowMs, m);
  if (!words) return null;
  return (
    <span
      className={cn(
        "tabular-nums",
        words.tone === "late" && "text-destructive",
        words.tone === "soon" && "text-warning-foreground",
        className,
      )}
    >
      {words.text}
    </span>
  );
}

/** Edit, move, close or reopen, delete. Closing is yours: agents can't close a milestone. */
function MilestoneMenu({
  projectId,
  milestone,
  index,
  count,
}: {
  projectId: string;
  milestone: TaskMilestone;
  index: number;
  count: number;
}) {
  const gt = useGT();
  const [editing, setEditing] = useState(false);
  return (
    <>
      <Menu>
        <MenuTrigger
          render={<Button size="icon-xs" variant="ghost" aria-label={gt("Milestone options")} />}
        >
          <EllipsisIcon />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem onClick={() => setEditing(true)}>
            <T>Edit…</T>
          </MenuItem>
          <MenuItem
            disabled={index <= 0}
            onClick={() =>
              void changeTaskBoard((current) => moveMilestone(current, projectId, milestone.id, -1))
            }
          >
            <T>Move up</T>
          </MenuItem>
          <MenuItem
            disabled={index >= count - 1}
            onClick={() =>
              void changeTaskBoard((current) => moveMilestone(current, projectId, milestone.id, 1))
            }
          >
            <T>Move down</T>
          </MenuItem>
          <MenuItem
            onClick={() =>
              void changeTaskBoard((current) =>
                setMilestoneState(
                  current,
                  projectId,
                  milestone.id,
                  milestone.state === "open" ? "closed" : "open",
                ),
              )
            }
          >
            {milestone.state === "open" ? gt("Close milestone") : gt("Reopen milestone")}
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            variant="destructive"
            onClick={() =>
              void changeTaskBoard((current) => removeMilestone(current, projectId, milestone.id))
            }
          >
            <T>Delete (its tasks stay)</T>
          </MenuItem>
        </MenuPopup>
      </Menu>
      <MilestoneDialog
        open={editing}
        onOpenChange={setEditing}
        initial={milestone}
        onSave={(draft) =>
          void changeTaskBoard((current) => editMilestone(current, projectId, milestone.id, draft))
        }
      />
    </>
  );
}

/** "All done: close SEO v2?" Only you answer it. */
function CloseSuggestion({
  projectId,
  milestone,
}: {
  projectId: string;
  milestone: TaskMilestone;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-success/8 px-2 py-1 text-xs">
      <CircleCheckIcon className="size-3.5 text-success" />
      <span>
        <T>
          All done: close <Var>{milestone.name}</Var>?
        </T>
      </span>
      <Button
        size="micro"
        variant="outline"
        onClick={() =>
          void changeTaskBoard((current) =>
            setMilestoneState(current, projectId, milestone.id, "closed"),
          )
        }
      >
        <T>Close it</T>
      </Button>
    </div>
  );
}

/**
 * A milestone's heading in the List view: name, goal, a small bar, progress and the date. Its
 * progress counts all the project's tasks in it, whatever the filters hide.
 */
export function MilestoneGroupHeader({
  project,
  milestone,
  live,
}: {
  /** The project as saved, not filtered. */
  project: TaskItem;
  milestone: TaskMilestone | null;
  live: ReadonlyMap<string, TaskLiveState>;
}) {
  const gt = useGT();
  if (!milestone) {
    return (
      <div className="flex items-center gap-2 ps-1 pt-2 pb-0.5 text-muted-foreground text-xs">
        <T>No milestone</T>
      </div>
    );
  }
  const milestones = projectMilestones(project);
  const index = milestones.findIndex((entry) => entry.id === milestone.id);
  const progress = milestoneProgress(tasksInMilestone(project, milestone.id), live);
  return (
    <div className="flex flex-col gap-1 pt-2 pb-0.5">
      <div className="group flex min-w-0 items-center gap-2 ps-1 text-xs">
        <MilestoneIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className={cn("font-medium text-sm", milestone.state === "closed" && "opacity-60")}>
          {milestone.name}
        </span>
        {milestone.state === "closed" ? (
          <span className="rounded-full bg-muted px-1.5 text-2xs text-muted-foreground">
            <T>closed</T>
          </span>
        ) : null}
        {milestone.goal ? (
          <span className="min-w-0 truncate text-muted-foreground">{milestone.goal}</span>
        ) : null}
        <div className="min-w-0 flex-1" />
        <MilestoneBar progress={progress} className="w-20 shrink-0" />
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {progress.total > 0
            ? `${progress.done}/${progress.total}`
            : gt("empty", { $context: "milestone with no tasks" })}
        </span>
        <DueWords due={milestone.due} className="shrink-0 text-muted-foreground" />
        <span className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 has-data-popup-open:opacity-100">
          <MilestoneMenu
            projectId={project.id}
            milestone={milestone}
            index={index}
            count={milestones.length}
          />
        </span>
      </div>
      {readyToClose(milestone, progress) ? (
        <div className="ps-6">
          <CloseSuggestion projectId={project.id} milestone={milestone} />
        </div>
      ) : null}
    </div>
  );
}

/** The milestone a Board card is in, next to its project. */
export function MilestoneChip({ project, task }: { project: TaskItem; task: TaskItem }) {
  const milestone = milestoneOf(project, task);
  if (!milestone) return null;
  return (
    <span className="flex min-w-0 items-center gap-1">
      <MilestoneIcon aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{milestone.name}</span>
    </span>
  );
}

// ── Picking and making milestones ───────────────────────────────────────────

/**
 * Name, goal and an optional date, for a new milestone or an edit. `onSave` gets the trimmed
 * draft; an empty name can't be saved.
 */
export function MilestoneDialog({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: TaskMilestone | undefined;
  onSave: (draft: MilestoneDraft) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-sm">
        {/* Mounted per opening, so the fields start from the milestone as it is now. */}
        {open ? (
          <MilestoneForm initial={initial} onSave={onSave} onClose={() => onOpenChange(false)} />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

function MilestoneForm({
  initial,
  onSave,
  onClose,
}: {
  initial: TaskMilestone | undefined;
  onSave: (draft: MilestoneDraft) => void;
  onClose: () => void;
}) {
  const gt = useGT();
  const formId = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [goal, setGoal] = useState(initial?.goal ?? "");
  const [due, setDue] = useState(initial?.due ?? "");
  return (
    <>
      <DialogHeader>
        <DialogTitle>{initial ? gt("Edit milestone") : gt("New milestone")}</DialogTitle>
        <DialogDescription>
          <T>A goal for this project. Its progress counts itself from the tasks you put in it.</T>
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <form
          id={formId}
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            onSave({ name: name.trim(), goal, due });
            onClose();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor={`${formId}-name`}>
              <T>Name</T>
            </Label>
            <Input
              id={`${formId}-name`}
              // oxlint-disable-next-line t3code/no-untranslated-copy -- a sample milestone name
              placeholder="SEO v2"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${formId}-goal`}>
              <T>Goal (optional)</T>
            </Label>
            <Input
              id={`${formId}-goal`}
              placeholder={gt("Phrase pages live and indexed")}
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${formId}-due`}>
              <T>Target date (optional)</T>
            </Label>
            <Input
              id={`${formId}-due`}
              type="date"
              value={due}
              onChange={(event) => setDue(event.target.value)}
            />
          </div>
        </form>
      </DialogPanel>
      <DialogFooter variant="bare">
        <Button variant="outline" onClick={onClose}>
          <T>Cancel</T>
        </Button>
        <Button type="submit" form={formId} disabled={!name.trim()}>
          {initial ? gt("Save") : gt("Add milestone")}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Makes a milestone in `projectId`, and puts `taskId` in it when given. */
export function createMilestone(projectId: string, draft: MilestoneDraft, taskId?: string) {
  void changeTaskBoard((current) => {
    const { board, milestone } = addMilestone(current, projectId, draft);
    return taskId && milestone ? setTaskMilestone(board, taskId, milestone.id) : board;
  });
}

/** The task menu's Milestone submenu: the project's open milestones, none, or a new one. */
export function TaskMilestoneSubmenu({
  project,
  task,
  onNew,
}: {
  project: TaskItem;
  task: TaskItem;
  onNew: () => void;
}) {
  const current = milestoneOf(project, task);
  const open = projectMilestones(project).filter((milestone) => milestone.state === "open");
  return (
    <MenuSub>
      <MenuSubTrigger>
        <MilestoneIcon />
        <T>Milestone</T>
        {current ? (
          <span className="ms-auto ps-3 text-muted-foreground">{current.name}</span>
        ) : null}
      </MenuSubTrigger>
      <MenuSubPopup>
        <MenuRadioGroup
          value={current?.id ?? NO_MILESTONE}
          onValueChange={(value) =>
            void changeTaskBoard((board) =>
              setTaskMilestone(board, task.id, value === NO_MILESTONE ? null : String(value)),
            )
          }
        >
          {open.map((milestone) => (
            <MenuRadioItem key={milestone.id} value={milestone.id} closeOnClick>
              {milestone.name}
            </MenuRadioItem>
          ))}
          <MenuRadioItem value={NO_MILESTONE} closeOnClick>
            <T>No milestone</T>
          </MenuRadioItem>
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem onClick={onNew}>
          <PlusIcon />
          <T>New milestone…</T>
        </MenuItem>
      </MenuSubPopup>
    </MenuSub>
  );
}

/** Shows only tasks in the ticked milestones (any project's), or in none. Nothing ticked: all. */
export function MilestoneFilterMenu({
  board,
  selected,
  onChange,
}: {
  board: TaskBoard;
  selected: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
}) {
  const gt = useGT();
  const projects = board.items.filter((project) =>
    projectMilestones(project).some((milestone) => milestone.state === "open"),
  );
  if (projects.length === 0) return null;
  const names = new Map(
    board.items.flatMap((project) =>
      projectMilestones(project).map((milestone) => [milestone.id, milestone.name] as const),
    ),
  );
  const label =
    selected.size === 0
      ? gt("All milestones")
      : selected.size === 1
        ? ([...selected].map((id) =>
            id === NO_MILESTONE ? gt("No milestone") : names.get(id),
          )[0] ??
          gt("{count, plural, one {{count} milestone} other {{count} milestones}}", { count: 1 }))
        : gt("{count, plural, one {{count} milestone} other {{count} milestones}}", {
            count: selected.size,
          });
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onChange(next);
  };
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="compact"
            variant={selected.size > 0 ? "secondary" : "ghost"}
            aria-label={gt("Filter by milestone")}
          />
        }
      >
        <MilestoneIcon />
        {label}
      </MenuTrigger>
      <MenuPopup align="end">
        {projects.map((project) => (
          <MenuGroup key={project.id}>
            <MenuGroupLabel>{project.text}</MenuGroupLabel>
            {projectMilestones(project)
              .filter((milestone) => milestone.state === "open")
              .map((milestone) => (
                <MenuCheckboxItem
                  key={milestone.id}
                  checked={selected.has(milestone.id)}
                  closeOnClick={false}
                  onCheckedChange={(on) => toggle(milestone.id, Boolean(on))}
                >
                  {milestone.name}
                </MenuCheckboxItem>
              ))}
          </MenuGroup>
        ))}
        <MenuSeparator />
        <MenuCheckboxItem
          checked={selected.has(NO_MILESTONE)}
          closeOnClick={false}
          onCheckedChange={(on) => toggle(NO_MILESTONE, Boolean(on))}
        >
          <T>No milestone</T>
        </MenuCheckboxItem>
        {selected.size > 0 ? (
          <MenuItem onClick={() => onChange(new Set())}>
            <T>Show all milestones</T>
          </MenuItem>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

// ── The Milestones view ─────────────────────────────────────────────────────

/**
 * Every project's milestones: open ones in order with their bar, progress and date, the close
 * prompt when all their tasks are done, then No milestone, then the closed ones, folded. A row
 * opens to list its tasks.
 */
/** Only projects that have milestones show; "New milestone" starts one in any project. */
export function MilestonesView({
  board,
  live,
  hiddenProjects,
  projectFilter,
}: {
  board: TaskBoard;
  live: ReadonlyMap<string, TaskLiveState>;
  /** Board projects the Tasks page's project filter leaves out. */
  hiddenProjects: ReadonlySet<string>;
  projectFilter: ReactNode;
}) {
  const gt = useGT();
  const [creatingIn, setCreatingIn] = useState<TaskItem | null>(null);
  const withMilestones = board.items.filter((project) => projectMilestones(project).length > 0);
  const shown = withMilestones.filter((project) => !hiddenProjects.has(project.id));
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-muted-foreground text-xs">
          {withMilestones.length === 0
            ? gt("No milestones yet. Start one for a project to group its tasks toward a goal.")
            : shown.length === 0
              ? gt("No milestones in the projects you picked.")
              : null}
        </p>
        {withMilestones.length > 0 ? projectFilter : null}
        {board.items.length > 0 ? (
          <Menu>
            <MenuTrigger render={<Button size="compact" variant="outline" />}>
              <PlusIcon />
              <T>New milestone</T>
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuGroup>
                <MenuGroupLabel>
                  <T>In project</T>
                </MenuGroupLabel>
                {board.items.map((project) => (
                  <MenuItem key={project.id} onClick={() => setCreatingIn(project)}>
                    <TaskProjectIcon name={project.text} className="size-4" />
                    {project.text}
                  </MenuItem>
                ))}
              </MenuGroup>
            </MenuPopup>
          </Menu>
        ) : null}
      </div>
      {shown.map((project) => (
        <ProjectMilestones key={project.id} project={project} live={live} />
      ))}
      <MilestoneDialog
        open={creatingIn !== null}
        onOpenChange={(open) => {
          if (!open) setCreatingIn(null);
        }}
        onSave={(draft) => {
          if (creatingIn) createMilestone(creatingIn.id, draft);
        }}
      />
    </div>
  );
}

function ProjectMilestones({
  project,
  live,
}: {
  project: TaskItem;
  live: ReadonlyMap<string, TaskLiveState>;
}) {
  const gt = useGT();
  const [showClosed, setShowClosed] = useState(false);
  const milestones = projectMilestones(project);
  const open = milestones.filter((milestone) => milestone.state === "open");
  const closed = milestones.filter((milestone) => milestone.state === "closed");
  const unplaced = project.children.filter(
    (task) => task.status !== "done" && !milestoneOf(project, task),
  ).length;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <TaskProjectIcon name={project.text} className="size-4" />
        <h2 className="min-w-0 flex-1 truncate font-semibold text-base">{project.text}</h2>
      </div>
      {open.length === 0 ? (
        <p className="ps-6 text-muted-foreground text-xs">
          <T>No open milestones.</T>
          {unplaced > 0
            ? ` ${gt("{count, plural, one {{count} open task.} other {{count} open tasks.}}", { count: unplaced })}`
            : ""}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {open.map((milestone) => (
            <MilestoneRow
              key={milestone.id}
              project={project}
              milestone={milestone}
              index={milestones.indexOf(milestone)}
              count={milestones.length}
              live={live}
            />
          ))}
          <p className="ps-1 text-muted-foreground text-xs">
            {gt(
              "{count, plural, one {No milestone: {count} open task} other {No milestone: {count} open tasks}}",
              { count: unplaced },
            )}
          </p>
        </div>
      )}
      {closed.length > 0 ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="flex items-center gap-1 self-start text-muted-foreground text-xs hover:text-foreground"
            onClick={() => setShowClosed((value) => !value)}
          >
            <ChevronRightIcon
              className={cn("size-3.5 transition-transform", showClosed && "rotate-90")}
            />
            <T>
              Closed (<Var>{closed.length}</Var>)
            </T>
          </button>
          {showClosed
            ? closed.map((milestone) => (
                <MilestoneRow
                  key={milestone.id}
                  project={project}
                  milestone={milestone}
                  index={milestones.indexOf(milestone)}
                  count={milestones.length}
                  live={live}
                />
              ))
            : null}
        </div>
      ) : null}
    </section>
  );
}

function MilestoneRow({
  project,
  milestone,
  index,
  count,
  live,
}: {
  project: TaskItem;
  milestone: TaskMilestone;
  index: number;
  count: number;
  live: ReadonlyMap<string, TaskLiveState>;
}) {
  const gt = useGT();
  const m = useMessages();
  const [expanded, setExpanded] = useState(milestone.state === "open");
  const nowMs = nowFromMinute(useNowMinute());
  const tasks = tasksInMilestone(project, milestone.id);
  const progress = milestoneProgress(tasks, live);
  // The counts under the bar match the columns below it.
  const columns = kanbanColumns([{ ...project, children: [...tasks] }], live, 0);
  const isClosed = milestone.state === "closed";
  return (
    <div
      className={cn("flex flex-col gap-2 rounded-lg border bg-card p-3", isClosed && "opacity-70")}
    >
      <div className="flex min-w-0 items-start gap-2">
        <button
          type="button"
          className="mt-0.5 text-muted-foreground"
          aria-label={expanded ? gt("Hide its tasks") : gt("Show its tasks")}
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronRightIcon
            className={cn("size-4 transition-transform", expanded && "rotate-90")}
          />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate font-medium text-sm">{milestone.name}</span>
            {isClosed && milestone.closedAt ? (
              <span className="shrink-0 text-muted-foreground text-xs">
                <T>
                  closed <Var>{formatRelativeTimeLabel(milestone.closedAt, nowMs)}</Var>
                </T>
              </span>
            ) : (
              <DueWords due={milestone.due} className="shrink-0 text-xs" />
            )}
          </div>
          {milestone.goal ? (
            <span className="truncate text-muted-foreground text-xs">{milestone.goal}</span>
          ) : null}
        </div>
        <MilestoneMenu projectId={project.id} milestone={milestone} index={index} count={count} />
      </div>
      <MilestoneBar progress={progress} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs tabular-nums">
        <span className="text-foreground">{progressWords(progress, m)}</span>
        {columns.progress.length > 0 ? (
          <span className="text-info-foreground">
            {progress.working > 0
              ? gt("{count} in progress ({working} working)", {
                  count: columns.progress.length,
                  working: progress.working,
                })
              : gt("{count} in progress", { count: columns.progress.length })}
          </span>
        ) : null}
        {columns.review.length > 0 ? (
          <span>{gt("{count} in review", { count: columns.review.length })}</span>
        ) : null}
        {columns.waiting.length > 0 ? (
          <span className="text-warning-foreground">
            {gt("{count} waiting on you", { count: columns.waiting.length })}
          </span>
        ) : null}
        {columns.todo.length > 0 ? (
          <span>{gt("{count} to do", { count: columns.todo.length })}</span>
        ) : null}
      </div>
      {readyToClose(milestone, progress) ? (
        <CloseSuggestion projectId={project.id} milestone={milestone} />
      ) : null}
      {expanded ? <MilestoneTaskList project={project} tasks={tasks} live={live} /> : null}
    </div>
  );
}
