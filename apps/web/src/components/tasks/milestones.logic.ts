/**
 * Milestones on the task board, after Cello's (CEL-113, CEL-132): each project has its own
 * ordered milestones, each of the project's tasks is in at most one, and a milestone's progress
 * is counted from those tasks. Sub-tasks follow their task, so only a project's direct tasks
 * count. Pure helpers; the views and the `tasks` command go through them.
 */
import { msg } from "gt-react";

import { m, type MessageResolver } from "~/i18n/messages";

import {
  updateTask,
  type MilestoneState,
  type TaskBoard,
  type TaskItem,
  type TaskLiveState,
  type TaskMilestone,
} from "./taskBoard.logic";

let idCounter = 0;
function newMilestoneId(): string {
  idCounter = (idCounter + 1) % 1296;
  return `m${Date.now().toString(36)}${idCounter.toString(36).padStart(2, "0")}`;
}

export function projectMilestones(project: TaskItem): ReadonlyArray<TaskMilestone> {
  return project.milestones ?? [];
}

/** The milestone a project's task is in; null when none, or the id isn't one of the project's. */
export function milestoneOf(project: TaskItem, task: TaskItem): TaskMilestone | null {
  if (!task.milestone) return null;
  return projectMilestones(project).find((milestone) => milestone.id === task.milestone) ?? null;
}

function findMilestoneByName(project: TaskItem, name: string): TaskMilestone | null {
  const wanted = name.trim().toLowerCase();
  return (
    projectMilestones(project).find((milestone) => milestone.name.toLowerCase() === wanted) ?? null
  );
}

function changeMilestones(
  board: TaskBoard,
  projectId: string,
  change: (milestones: ReadonlyArray<TaskMilestone>) => ReadonlyArray<TaskMilestone>,
): TaskBoard {
  return updateTask(board, projectId, (project) => {
    const next = change(projectMilestones(project));
    return { ...project, milestones: next.length > 0 ? next : undefined };
  });
}

export interface MilestoneDraft {
  readonly name: string;
  readonly goal?: string | undefined;
  readonly due?: string | undefined;
}

const clean = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * Adds a milestone at the end of the project's order. A name the project already uses (any
 * case) returns that milestone instead, so a retry doesn't make a second one.
 */
export function addMilestone(
  board: TaskBoard,
  projectId: string,
  draft: MilestoneDraft,
  now = new Date().toISOString(),
): { board: TaskBoard; milestone: TaskMilestone | null } {
  const project = board.items.find((item) => item.id === projectId);
  const name = draft.name.trim();
  if (!project || !name) return { board, milestone: null };
  const existing = findMilestoneByName(project, name);
  if (existing) return { board, milestone: existing };
  const milestone: TaskMilestone = {
    id: newMilestoneId(),
    name,
    goal: clean(draft.goal),
    due: clean(draft.due),
    state: "open",
    createdAt: now,
  };
  return {
    board: changeMilestones(board, projectId, (milestones) => [...milestones, milestone]),
    milestone,
  };
}

/** Renames or changes the goal or date. A name another milestone of the project has is kept out. */
export function editMilestone(
  board: TaskBoard,
  projectId: string,
  milestoneId: string,
  draft: MilestoneDraft,
): TaskBoard {
  const name = draft.name.trim();
  return changeMilestones(board, projectId, (milestones) => {
    const taken = milestones.some(
      (milestone) =>
        milestone.id !== milestoneId && milestone.name.toLowerCase() === name.toLowerCase(),
    );
    return milestones.map((milestone) =>
      milestone.id === milestoneId
        ? {
            ...milestone,
            name: name && !taken ? name : milestone.name,
            goal: clean(draft.goal),
            due: clean(draft.due),
          }
        : milestone,
    );
  });
}

/** Close or reopen. Tasks stay in it either way. */
export function setMilestoneState(
  board: TaskBoard,
  projectId: string,
  milestoneId: string,
  state: MilestoneState,
  now = new Date().toISOString(),
): TaskBoard {
  return changeMilestones(board, projectId, (milestones) =>
    milestones.map((milestone) =>
      milestone.id === milestoneId && milestone.state !== state
        ? { ...milestone, state, closedAt: state === "closed" ? now : undefined }
        : milestone,
    ),
  );
}

/** Moves a milestone one place up or down in the project's order. */
export function moveMilestone(
  board: TaskBoard,
  projectId: string,
  milestoneId: string,
  direction: -1 | 1,
): TaskBoard {
  return changeMilestones(board, projectId, (milestones) => {
    const index = milestones.findIndex((milestone) => milestone.id === milestoneId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= milestones.length) return milestones;
    const next = [...milestones];
    [next[index], next[target]] = [next[target]!, next[index]!];
    return next;
  });
}

/** Deletes the milestone; its tasks go to No milestone. */
export function removeMilestone(
  board: TaskBoard,
  projectId: string,
  milestoneId: string,
): TaskBoard {
  const withoutIt = changeMilestones(board, projectId, (milestones) =>
    milestones.filter((milestone) => milestone.id !== milestoneId),
  );
  return updateTask(withoutIt, projectId, (project) => ({
    ...project,
    children: project.children.map((task) =>
      task.milestone === milestoneId ? { ...task, milestone: undefined } : task,
    ),
  }));
}

/** Puts a project's task in a milestone (null takes it out). Only open milestones take tasks. */
export function setTaskMilestone(
  board: TaskBoard,
  taskId: string,
  milestoneId: string | null,
  now = new Date().toISOString(),
): TaskBoard {
  const project = board.items.find((item) => item.children.some((task) => task.id === taskId));
  if (!project) return board;
  if (milestoneId !== null) {
    const target = projectMilestones(project).find((milestone) => milestone.id === milestoneId);
    if (!target || target.state !== "open") return board;
  }
  return updateTask(board, taskId, (task) =>
    (task.milestone ?? null) === milestoneId
      ? task
      : { ...task, milestone: milestoneId ?? undefined, updatedAt: now },
  );
}

export interface MilestoneProgress {
  readonly total: number;
  readonly done: number;
  readonly working: number;
  readonly waiting: number;
  /** Finished by an agent, for you to check. */
  readonly review: number;
  /** Open and neither working, waiting nor in review. */
  readonly todo: number;
  /** Done of total, 0–100; 0 when it has no tasks. */
  readonly pct: number;
}

/** Counts the tasks: done, then working, waiting on you, and the rest, from their live state. */
export function milestoneProgress(
  tasks: ReadonlyArray<TaskItem>,
  live: ReadonlyMap<string, TaskLiveState>,
): MilestoneProgress {
  let done = 0;
  let working = 0;
  let waiting = 0;
  let review = 0;
  for (const task of tasks) {
    const state = live.get(task.id);
    if (task.status === "done") done += 1;
    else if (state?.working) working += 1;
    else if (state ? state.waiting : task.status === "waiting") waiting += 1;
    else if (task.status === "review") review += 1;
  }
  const total = tasks.length;
  return {
    total,
    done,
    working,
    waiting,
    review,
    todo: total - done - working - waiting - review,
    pct: total > 0 ? Math.round((done / total) * 100) : 0,
  };
}

export type DueTone = "late" | "soon" | "later";

/** "3 days left", "due today", "4 days late"; days count in the viewer's own calendar. */
export function dueWords(
  due: string | undefined,
  nowMs: number,
  resolve: MessageResolver = m,
): { text: string; tone: DueTone } | null {
  if (!due) return null;
  const [year, month, day] = due.split("-").map(Number);
  if (!year || !month || !day) return null;
  const now = new Date(nowMs);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((Date.UTC(year, month - 1, day) - today) / 86_400_000);
  if (days === 0) return { text: resolve(msg("due today")), tone: "soon" };
  if (days < 0) {
    return {
      text: resolve(
        msg("{count, plural, one {{count} day late} other {{count} days late}}", {
          count: -days,
        }),
      ),
      tone: "late",
    };
  }
  return {
    text: resolve(
      msg("{count, plural, one {{count} day left} other {{count} days left}}", { count: days }),
    ),
    tone: days <= 2 ? "soon" : "later",
  };
}

/** True when an open milestone has tasks and every one is done: time to ask about closing it. */
export function readyToClose(milestone: TaskMilestone, progress: MilestoneProgress): boolean {
  return milestone.state === "open" && progress.total > 0 && progress.done === progress.total;
}

export interface MilestoneGroup {
  /** Null for the project's tasks in no milestone. */
  readonly milestone: TaskMilestone | null;
  readonly tasks: ReadonlyArray<TaskItem>;
}

/**
 * A project's tasks by milestone for the List view: its open milestones in order (empty ones
 * too, so you can add to them), closed ones that still show tasks, then No milestone. A project
 * without milestones is one group, `milestone: null`.
 */
export function milestoneGroups(
  project: TaskItem,
  tasks: ReadonlyArray<TaskItem>,
): ReadonlyArray<MilestoneGroup> {
  const milestones = projectMilestones(project);
  if (milestones.length === 0) return [{ milestone: null, tasks }];
  const byMilestone = new Map<string, TaskItem[]>();
  const none: TaskItem[] = [];
  for (const task of tasks) {
    const milestone = milestoneOf(project, task);
    if (milestone) byMilestone.set(milestone.id, [...(byMilestone.get(milestone.id) ?? []), task]);
    else none.push(task);
  }
  const groups: MilestoneGroup[] = [];
  for (const milestone of milestones) {
    const inIt = byMilestone.get(milestone.id) ?? [];
    if (milestone.state === "open" || inIt.length > 0) groups.push({ milestone, tasks: inIt });
  }
  if (none.length > 0) groups.push({ milestone: null, tasks: none });
  return groups;
}

/** The project's direct tasks in one milestone (all of them, done ones too). */
export function tasksInMilestone(project: TaskItem, milestoneId: string): ReadonlyArray<TaskItem> {
  return project.children.filter((task) => milestoneOf(project, task)?.id === milestoneId);
}

/** Matches tasks in no milestone, in the milestone filter. */
export const NO_MILESTONE = "none";

/**
 * The projects pruned to the direct tasks in one of `selected` (milestone ids, or `NO_MILESTONE`).
 * Sub-tasks come with their task. Projects with nothing left drop out.
 */
export function filterByMilestones(
  projects: ReadonlyArray<TaskItem>,
  selected: ReadonlySet<string>,
): TaskItem[] {
  return projects.flatMap((project) => {
    const children = project.children.filter((task) =>
      selected.has(milestoneOf(project, task)?.id ?? NO_MILESTONE),
    );
    return children.length > 0 ? [{ ...project, children }] : [];
  });
}
