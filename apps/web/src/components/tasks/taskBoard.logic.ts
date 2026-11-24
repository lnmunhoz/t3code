/**
 * The task board: a nested list (Dynalist-style). Top-level items are projects, everything under
 * them is a task or a sub-task. It is stored as one JSON file that the Tasks page, agents and the
 * watcher all edit, so parsing is forgiving and every change goes through these pure helpers.
 */

export type TaskStatus = "active" | "waiting" | "review" | "done";
export type TaskAuthor = "you" | "watcher" | "agent";

export interface TaskThreadRef {
  readonly environmentId: string;
  readonly threadId: string;
  readonly title: string;
}

export type MilestoneState = "open" | "closed";

/**
 * A goal inside a project ("SEO v2"), as in Cello: an ordered list per project, each open or
 * closed. Its progress is counted from the project's tasks in it; nobody types it in.
 */
export interface TaskMilestone {
  readonly id: string;
  readonly name: string;
  readonly goal?: string | undefined;
  /** Target day, "YYYY-MM-DD". */
  readonly due?: string | undefined;
  readonly state: MilestoneState;
  readonly closedAt?: string | undefined;
  readonly createdAt: string;
}

export interface TaskItem {
  readonly id: string;
  readonly text: string;
  readonly status: TaskStatus;
  /** One short line of progress, newest wins ("tests pass, waiting on review"). */
  readonly note?: string | undefined;
  readonly threads: ReadonlyArray<TaskThreadRef>;
  readonly children: ReadonlyArray<TaskItem>;
  readonly collapsed?: boolean | undefined;
  readonly by: TaskAuthor;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly doneAt?: string | undefined;
  /** A project's milestones, in order. Only projects (top-level items) have them. */
  readonly milestones?: ReadonlyArray<TaskMilestone> | undefined;
  /** A project's direct task: the id of the project milestone it is in. Sub-tasks follow their task. */
  readonly milestone?: string | undefined;
  /** Short tags like "seo" or "bug", in the order they were added. */
  readonly labels?: ReadonlyArray<string> | undefined;
}

export interface TaskBoard {
  readonly version: 1;
  readonly items: ReadonlyArray<TaskItem>;
}

export const EMPTY_TASK_BOARD: TaskBoard = { version: 1, items: [] };

const STATUSES: ReadonlyArray<TaskStatus> = ["active", "waiting", "review", "done"];
const AUTHORS: ReadonlyArray<TaskAuthor> = ["you", "watcher", "agent"];

let idCounter = 0;
function newTaskId(): string {
  idCounter = (idCounter + 1) % 1296;
  return `t${Date.now().toString(36)}${idCounter.toString(36).padStart(2, "0")}`;
}

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

function parseThreadRef(value: unknown): TaskThreadRef | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const environmentId = asString(record.environmentId);
  const threadId = asString(record.threadId);
  if (!environmentId || !threadId) return null;
  // oxlint-disable-next-line t3code/no-untranslated-copy -- fallback stored in the board's task data, not UI copy
  return { environmentId, threadId, title: asString(record.title) ?? "Thread" };
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseMilestones(value: unknown, now: string): ReadonlyArray<TaskMilestone> | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = new Set<string>();
  const milestones = value.flatMap((entry): TaskMilestone[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const id = asString(record.id);
    const name = asString(record.name)?.trim();
    // Names are unique in a project, ignoring case.
    if (!id || !name || names.has(name.toLowerCase())) return [];
    names.add(name.toLowerCase());
    const due = asString(record.due);
    const state: MilestoneState = record.state === "closed" ? "closed" : "open";
    return [
      {
        id,
        name,
        goal: asString(record.goal)?.trim(),
        due: due && DAY_PATTERN.test(due) ? due : undefined,
        state,
        closedAt: state === "closed" ? (asString(record.closedAt) ?? now) : undefined,
        createdAt: asString(record.createdAt) ?? now,
      },
    ];
  });
  return milestones.length > 0 ? milestones : undefined;
}

/** A stable id for an item an agent wrote without one, so every read of the file agrees. */
function derivedId(path: string, text: string): string {
  let hash = 2166136261;
  for (const char of `${path}|${text}`) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  return `x${(hash >>> 0).toString(36)}`;
}

function parseItem(value: unknown, now: string, seen: Set<string>, path: string): TaskItem | null {
  // An agent may write a bare string for a quick task.
  if (typeof value === "string") value = { text: value };
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const text = asString(record.text) ?? asString(record.title);
  if (!text) return null;
  let id = asString(record.id) ?? derivedId(path, text);
  for (let attempt = 1; seen.has(id); attempt += 1) id = derivedId(`${path}#${attempt}`, text);
  seen.add(id);
  const status = STATUSES.includes(record.status as TaskStatus)
    ? (record.status as TaskStatus)
    : record.done === true
      ? "done"
      : "active";
  const children = Array.isArray(record.children)
    ? record.children.flatMap(
        (child, index) => parseItem(child, now, seen, `${path}.${index}`) ?? [],
      )
    : [];
  const threads = Array.isArray(record.threads)
    ? record.threads.flatMap((thread) => parseThreadRef(thread) ?? [])
    : [];
  const createdAt = asString(record.createdAt) ?? now;
  return {
    id,
    text: text.trim(),
    status,
    note: asString(record.note),
    threads,
    children,
    collapsed: record.collapsed === true ? true : undefined,
    by: AUTHORS.includes(record.by as TaskAuthor) ? (record.by as TaskAuthor) : "agent",
    createdAt,
    updatedAt: asString(record.updatedAt) ?? createdAt,
    doneAt: status === "done" ? (asString(record.doneAt) ?? now) : undefined,
    milestones: parseMilestones(record.milestones, now),
    milestone: asString(record.milestone),
    labels: parseLabels(record.labels),
  };
}

function parseLabels(value: unknown): ReadonlyArray<string> | undefined {
  if (!Array.isArray(value)) return undefined;
  const labels = normalizeLabels(value.filter((label) => typeof label === "string"));
  return labels.length > 0 ? labels : undefined;
}

/** Trimmed, lowercase, without blanks or repeats. */
export function normalizeLabels(labels: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(labels.map((label) => label.trim().toLowerCase()).filter(Boolean))];
}

export function setTaskLabels(
  board: TaskBoard,
  id: string,
  labels: ReadonlyArray<string>,
  now: string,
): TaskBoard {
  const next = normalizeLabels(labels);
  return updateTask(board, id, (item) => ({
    ...item,
    labels: next.length > 0 ? next : undefined,
    updatedAt: now,
  }));
}

/** Every label used under `items`, most used first, for a label picker. */
export function labelsIn(items: ReadonlyArray<TaskItem>): ReadonlyArray<string> {
  const counts = new Map<string, number>();
  const visit = (list: ReadonlyArray<TaskItem>) => {
    for (const item of list) {
      for (const label of item.labels ?? []) counts.set(label, (counts.get(label) ?? 0) + 1);
      visit(item.children);
    }
  };
  visit(items);
  return [...counts.entries()]
    .toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label]) => label);
}

/** Reads the board file's text. Unknown fields are dropped, missing ones filled in. */
export function parseTaskBoard(text: string | null, now = new Date().toISOString()): TaskBoard {
  if (!text) return EMPTY_TASK_BOARD;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return EMPTY_TASK_BOARD;
  }
  const items = Array.isArray(value)
    ? value
    : typeof value === "object" &&
        value !== null &&
        Array.isArray((value as { items?: unknown }).items)
      ? (value as { items: unknown[] }).items
      : [];
  const seen = new Set<string>();
  return {
    version: 1,
    items: items.flatMap((item, index) => parseItem(item, now, seen, String(index)) ?? []),
  };
}

export function serializeTaskBoard(board: TaskBoard): string {
  return `${JSON.stringify(board, null, 2)}\n`;
}

// ── Tree helpers ────────────────────────────────────────────────────────────

export function findTask(
  items: ReadonlyArray<TaskItem>,
  id: string,
): { item: TaskItem; parent: TaskItem | null; index: number } | null {
  for (const [index, item] of items.entries()) {
    if (item.id === id) return { item, parent: null, index };
    const inner = findTask(item.children, id);
    if (inner) return inner.parent ? inner : { ...inner, parent: item };
  }
  return null;
}

function mapItems(
  items: ReadonlyArray<TaskItem>,
  visit: (item: TaskItem) => TaskItem | null,
): ReadonlyArray<TaskItem> {
  return items.flatMap((item) => {
    const next = visit(item);
    if (!next) return [];
    const children = mapItems(next.children, visit);
    return [children === next.children ? next : { ...next, children }];
  });
}

export function updateTask(
  board: TaskBoard,
  id: string,
  change: (item: TaskItem) => TaskItem,
): TaskBoard {
  return {
    ...board,
    items: mapItems(board.items, (item) => (item.id === id ? change(item) : item)),
  };
}

export function removeTask(board: TaskBoard, id: string): TaskBoard {
  return { ...board, items: mapItems(board.items, (item) => (item.id === id ? null : item)) };
}

export function makeTask(
  text: string,
  by: TaskAuthor,
  now = new Date().toISOString(),
  extra: Partial<TaskItem> = {},
): TaskItem {
  return {
    id: newTaskId(),
    text: text.trim(),
    status: "active",
    threads: [],
    children: [],
    by,
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

/** Adds `task` as the last child of `parentId`, or as a new project when `parentId` is null. */
export function addTask(board: TaskBoard, parentId: string | null, task: TaskItem): TaskBoard {
  if (parentId === null || !findTask(board.items, parentId)) {
    return { ...board, items: [...board.items, task] };
  }
  return updateTask(board, parentId, (parent) => ({
    ...parent,
    collapsed: undefined,
    children: [...parent.children, task],
  }));
}

/** Inserts `task` right after `siblingId`, at the same depth. */
export function addTaskAfter(board: TaskBoard, siblingId: string, task: TaskItem): TaskBoard {
  const insert = (items: ReadonlyArray<TaskItem>): ReadonlyArray<TaskItem> => {
    const index = items.findIndex((item) => item.id === siblingId);
    if (index >= 0) return [...items.slice(0, index + 1), task, ...items.slice(index + 1)];
    return items.map((item) => {
      const children = insert(item.children);
      return children === item.children ? item : { ...item, children };
    });
  };
  return { ...board, items: insert(board.items) };
}

export function setTaskStatus(
  board: TaskBoard,
  id: string,
  status: TaskStatus,
  now = new Date().toISOString(),
): TaskBoard {
  return updateTask(board, id, (item) =>
    item.status === status
      ? item
      : { ...item, status, updatedAt: now, doneAt: status === "done" ? now : undefined },
  );
}

/** Tab: makes the item the last child of the sibling above it. */
export function indentTask(board: TaskBoard, id: string): TaskBoard {
  const move = (items: ReadonlyArray<TaskItem>): ReadonlyArray<TaskItem> => {
    const index = items.findIndex((item) => item.id === id);
    if (index > 0) {
      const above = items[index - 1]!;
      const item = items[index]!;
      return [
        ...items.slice(0, index - 1),
        { ...above, collapsed: undefined, children: [...above.children, item] },
        ...items.slice(index + 1),
      ];
    }
    if (index === 0) return items;
    return items.map((item) => {
      const children = move(item.children);
      return children === item.children ? item : { ...item, children };
    });
  };
  return { ...board, items: move(board.items) };
}

/** Shift+Tab: moves the item out of its parent, right after it. */
export function outdentTask(board: TaskBoard, id: string): TaskBoard {
  const move = (items: ReadonlyArray<TaskItem>): ReadonlyArray<TaskItem> => {
    for (const [index, parent] of items.entries()) {
      const childIndex = parent.children.findIndex((child) => child.id === id);
      if (childIndex >= 0) {
        const child = parent.children[childIndex]!;
        const rest = parent.children.filter((entry) => entry.id !== id);
        return [
          ...items.slice(0, index),
          { ...parent, children: rest },
          child,
          ...items.slice(index + 1),
        ];
      }
      const children = move(parent.children);
      if (children !== parent.children) {
        return [...items.slice(0, index), { ...parent, children }, ...items.slice(index + 1)];
      }
    }
    return items;
  };
  return { ...board, items: move(board.items) };
}

export function moveTask(board: TaskBoard, id: string, direction: -1 | 1): TaskBoard {
  const move = (items: ReadonlyArray<TaskItem>): ReadonlyArray<TaskItem> => {
    const index = items.findIndex((item) => item.id === id);
    if (index >= 0) {
      const target = index + direction;
      if (target < 0 || target >= items.length) return items;
      const next = [...items];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    }
    return items.map((item) => {
      const children = move(item.children);
      return children === item.children ? item : { ...item, children };
    });
  };
  return { ...board, items: move(board.items) };
}

/** Items done longer ago than `keepMs` are hidden unless "Show done" is on. */
/**
 * The board project item a chat's work is filed under: the project of the most recently updated task
 * linked to the chat, preferring open tasks. Null when no task links the chat.
 */
export function projectForThread(
  board: TaskBoard,
  environmentId: string,
  threadId: string,
): TaskItem | null {
  let best: { project: TaskItem; open: boolean; updated: number } | null = null;
  const visit = (items: ReadonlyArray<TaskItem>, project: TaskItem) => {
    for (const item of items) {
      if (
        item.threads.some(
          (thread) => thread.threadId === threadId && thread.environmentId === environmentId,
        )
      ) {
        const candidate = {
          project,
          open: item.status !== "done",
          updated: Date.parse(item.updatedAt) || 0,
        };
        if (
          !best ||
          (candidate.open && !best.open) ||
          (candidate.open === best.open && candidate.updated > best.updated)
        ) {
          best = candidate;
        }
      }
      visit(item.children, project);
    }
  };
  for (const project of board.items) visit(project.children, project);
  return (best as { project: TaskItem } | null)?.project ?? null;
}

// An open task nobody touched for this long is shown as going stale.
const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

/** True when an open task hasn't changed (status, note, chat, text) for `STALE_AFTER_MS`. */
export function isStaleTask(item: TaskItem, nowMs: number): boolean {
  if (item.status === "done") return false;
  const updated = Date.parse(item.updatedAt);
  return Number.isFinite(updated) && nowMs - updated >= STALE_AFTER_MS;
}

/** True when the task changed after it was added (more than a minute later). */
export function wasUpdatedSinceAdded(item: TaskItem): boolean {
  return Date.parse(item.updatedAt) - Date.parse(item.createdAt) > 60_000;
}

export function isRecentlyDone(item: TaskItem, nowMs: number, keepMs: number): boolean {
  if (item.status !== "done") return true;
  const doneAt = item.doneAt ? Date.parse(item.doneAt) : Number.NaN;
  return Number.isFinite(doneAt) && nowMs - doneAt < keepMs;
}

/** When a task last moved: when it was ticked done, else when it last changed. */
export function taskActivityAt(item: TaskItem): number {
  return Date.parse(item.status === "done" && item.doneAt ? item.doneAt : item.updatedAt);
}

/**
 * The projects pruned to the tasks `keep` accepts. A kept task keeps its parents, and a parent
 * keeps only its kept branches. Projects with nothing left drop out. `matches` counts kept tasks.
 */
export function filterTasks(
  projects: ReadonlyArray<TaskItem>,
  keep: (item: TaskItem) => boolean,
): { items: TaskItem[]; matches: number } {
  let matches = 0;
  const prune = (items: ReadonlyArray<TaskItem>): TaskItem[] =>
    items.flatMap((item) => {
      const children = prune(item.children);
      const kept = keep(item);
      if (kept) matches += 1;
      return kept || children.length > 0 ? [{ ...item, children, collapsed: undefined }] : [];
    });
  const items = projects.flatMap((project) => {
    const children = prune(project.children);
    return children.length > 0 ? [{ ...project, children }] : [];
  });
  return { items, matches };
}

/** The tasks that moved inside the window (from inclusive, to exclusive); see `filterTasks`. */
export function filterTasksByWindow(
  projects: ReadonlyArray<TaskItem>,
  window: { readonly from: number; readonly to: number },
): { items: TaskItem[]; matches: number } {
  return filterTasks(projects, (item) => {
    const at = taskActivityAt(item);
    return at >= window.from && at < window.to;
  });
}

/** The List view's order: the board's own, or newest first by last change or by when added. */
export type TaskSort = "board" | "updated" | "created";

/**
 * The projects and every level of tasks in `sort` order, newest first. A task or project counts
 * as new as the newest task inside it, so a fresh sub-task brings its parent up with it.
 */
export function sortTasks(projects: ReadonlyArray<TaskItem>, sort: TaskSort): TaskItem[] {
  if (sort === "board") return [...projects];
  const own = (item: TaskItem) =>
    sort === "updated" ? taskActivityAt(item) : Date.parse(item.createdAt);
  const order = (items: ReadonlyArray<TaskItem>): Array<{ item: TaskItem; key: number }> =>
    items
      .map((item) => {
        const children = order(item.children);
        const key = Math.max(own(item) || 0, ...children.map((child) => child.key));
        return { item: { ...item, children: children.map((child) => child.item) }, key };
      })
      .toSorted((a, b) => b.key - a.key);
  return projects
    .map((project) => {
      const children = order(project.children);
      // A project's own dates are when it was named; its tasks say how fresh it is.
      const key = Math.max(0, ...children.map((child) => child.key));
      return { item: { ...project, children: children.map((child) => child.item) }, key };
    })
    .toSorted((a, b) => b.key - a.key)
    .map((entry) => entry.item);
}

export function countOpenTasks(items: ReadonlyArray<TaskItem>): number {
  return items.reduce(
    (sum, item) => sum + (item.status === "done" ? 0 : 1) + countOpenTasks(item.children),
    0,
  );
}

// ── Watcher ─────────────────────────────────────────────────────────────────

/** One finished agent turn, as the watcher sees it. */
export interface WatchedTurn {
  readonly environmentId: string;
  readonly threadId: string;
  readonly threadTitle: string;
  /**
   * The T3 project the chat was started in. Only a hint: a T3 project is often a folder that holds
   * several real projects (like ~/home), so the watcher works out the real project itself.
   */
  readonly t3ProjectName: string | null;
  /** The folder the chat runs in, with the home folder shown as ~. */
  readonly workspace: string | null;
  readonly prompt: string;
  readonly reply: string;
  /** Answers the user gave to the agent's questions during the turn. */
  readonly decisions?: ReadonlyArray<TurnDecision> | undefined;
}

/** A choice made in a chat: the agent's question and the user's answer. */
export interface TurnDecision {
  readonly question: string;
  readonly answer: string;
}

/** The project item for work the watcher can't place. */
export const OTHER_PROJECT = "Other";

export type WatcherOp =
  | {
      readonly op: "add";
      /** The real project's name: an existing project item's title, or a new one. */
      readonly project: string | null;
      /** An existing task to nest under, when the new task is a sub-step of it. */
      readonly parent: string | null;
      readonly text: string;
      readonly turn: number;
      /** "waiting" when the turn already ends blocked on the user. */
      readonly status?: TaskStatus | undefined;
    }
  | { readonly op: "link"; readonly id: string; readonly turn: number }
  | {
      readonly op: "status";
      readonly id: string;
      readonly status: TaskStatus;
      readonly turn?: number | undefined;
    }
  | {
      readonly op: "note";
      readonly id: string;
      readonly text: string;
      readonly turn?: number | undefined;
    }
  | { readonly op: "move"; readonly id: string; readonly project: string };

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

export const WATCHER_SYSTEM_PROMPT = `You keep a short task list for one developer who has ADHD and runs many AI coding chats at once. You see the current list and a few chat turns that just finished. Reply with JSON only: {"ops":[...],"log":[...]}. The ops update the list:
- {"op":"add","project":"<project name>","parent":"<task id or null>","text":"<task, 3-8 words, imperative>","turn":<turn number>,"status":"waiting"?}: only when the user's prompt starts a NEW piece of work not already on the list. Set parent to an existing task's id only when the new task is clearly a sub-step of it; otherwise null. Add "status":"waiting" when the turn already ends blocked on the user.
- {"op":"link","id":"<task id>","turn":<n>}: the turn continues an existing task from a chat not yet linked to it.
- {"op":"status","id":"<task id>","status":"active"|"waiting"|"review"|"done","turn":<n>}: "review" when the reply says the work is finished and ready for the developer to look at (built, fixed, PR open); "done" only when it is merged or shipped and nothing is left for them to check; "waiting" when the agent is blocked on the user (a question, an approval, a decision).
- {"op":"note","id":"<task id>","text":"<what happened, max 12 words>","turn":<n>}: progress worth remembering.
- {"op":"move","id":"<task id>","project":"<project name>"}: a task sits under the wrong project.
Status and note ops link the turn's chat to the task, so no separate link op is needed for them.
Projects: the top-level items are projects, meaning the product, app, codebase or effort the work is for (for example an app, a website, a fork of a tool, a server, the developer's computer setup). Work out the project from what the chat is actually about: the app or repo it changes, the folders and files it mentions, the chat title. The chat's "T3 folder" is only where the chat was started and is often a parent folder that holds many projects (like "home" or a dotfiles or ops repo); never use such a container folder as the project name unless the work really is about that folder itself. A path like ~/home/ThaiLookup/... means the project is ThaiLookup. Reuse an existing project's exact name when it fits; otherwise give a short, plain name (1-3 words, like "ThaiLookup", "T3 Code fork", "Home server", "Mac setup").
Rules: follow-ups, side questions, small fixes and chit-chat belong to the existing task (link or note, never add). Never add duplicates. Never touch items you weren't told about. Prefer few ops; "ops":[] is fine. Never mark a project done.
The log is a history of what the developer asked and decided, so they can find it later. Add {"turn":<n>,"project":"<project name>","kind":"question"|"request"|"decision","q":"<max 20 words>","a":"<max 30 words>"} once for each turn's prompt, and once for each "Decided" line under a turn. kind: "question" when the user asks for information, an explanation or an opinion; "request" when they ask for work to be done; "decision" when they choose between options or settle how something should be (a "Decided" line is a decision when its answer picks or settles something; when the answer is itself a question or a request, use that kind instead; a prompt that mainly picks an approach is a decision too). q: what was asked, requested or decided, plainly, in the user's own voice, never "Asked …" or "The user …" ("Why is the watcher filing work under home?", "Use the board project in the label"). a: the agent's answer or what came of it, with the key fact or number; for a decision, what it means going forward. If the agent's reply is missing, set a to "" rather than saying so. project: the same real project the work belongs to (as for the ops). Leave out prompts that are only thanks, ok or a nudge to continue.`;

function describeItems(items: ReadonlyArray<TaskItem>, depth: number, lines: string[]): void {
  for (const item of items) {
    const threads = item.threads.map((thread) => thread.threadId.slice(0, 8)).join(",");
    lines.push(
      `${"  ".repeat(depth)}- [${item.id}] ${clip(item.text, 80)} (${item.status}${threads ? `; chats ${threads}` : ""})`,
    );
    describeItems(
      item.children.filter((child) => child.status !== "done"),
      depth + 1,
      lines,
    );
  }
}

const HOME_PREFIX = /^(?:\/Users|\/home)\/[^/\s]+(?=\/|$)/;

/** A path with the user's home folder shown as ~. */
export function shortenHome(path: string): string {
  return path.replace(HOME_PREFIX, "~");
}

/**
 * The project-level folders a text mentions, most mentioned first: `~/home/ThaiLookup/src/a.ts`
 * counts as `~/home/ThaiLookup`. Under a few well-known parents it keeps one more level.
 */
export function mentionedFolders(text: string, limit = 4): string[] {
  const counts = new Map<string, number>();
  for (const match of text.matchAll(/(?:~|\/Users\/[^/\s]+|\/home\/[^/\s]+)(?:\/[\w.@-]+)+/g)) {
    const parts = shortenHome(match[0]).split("/").filter(Boolean);
    if (parts.length < 2) continue;
    const depth = ["home", "projects", "code", "src", "dev", "repos", "work", ".config"].includes(
      parts[1]!,
    )
      ? 3
      : 2;
    const folder = parts.slice(0, depth).join("/");
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  return [...counts.entries()]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([folder]) => folder);
}

/** The watcher's user message: open items only, and each turn clipped, to keep it cheap. */
export function buildWatcherPrompt(board: TaskBoard, turns: ReadonlyArray<WatchedTurn>): string {
  const lines: string[] = ["Current list (done items left out; top-level items are projects):"];
  describeItems(board.items, 0, lines);
  if (board.items.length === 0) lines.push("(empty)");
  lines.push("", "Finished turns:");
  for (const [index, turn] of turns.entries()) {
    const folders = mentionedFolders(`${turn.prompt}\n${turn.reply}`);
    lines.push(
      `Turn ${index + 1}: chat ${turn.threadId.slice(0, 8)} "${clip(turn.threadTitle, 60)}"; T3 folder "${turn.t3ProjectName ?? "none"}"${turn.workspace ? ` (${turn.workspace})` : ""}${folders.length > 0 ? `; paths mentioned: ${folders.join(", ")}` : ""}`,
      `  User: ${clip(turn.prompt, 700)}`,
      ...(turn.decisions ?? [])
        .slice(0, 6)
        .map(
          (decision) =>
            `  Decided: ${clip(decision.question, 160)} → ${clip(decision.answer, 200)}`,
        ),
      `  Agent: ${clip(turn.reply, 700)}`,
    );
  }
  return lines.join("\n");
}

/** Pulls `{"ops":[...]}` out of the model's reply, dropping anything malformed. */
export function parseWatcherOps(reply: string | null): ReadonlyArray<WatcherOp> {
  if (!reply) return [];
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let value: unknown;
  try {
    value = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return [];
  }
  const ops = (value as { ops?: unknown })?.ops;
  if (!Array.isArray(ops)) return [];
  return ops.flatMap((raw): WatcherOp[] => {
    if (typeof raw !== "object" || raw === null) return [];
    const op = raw as Record<string, unknown>;
    const turn = typeof op.turn === "number" ? op.turn : Number.NaN;
    switch (op.op) {
      case "add": {
        const text = asString(op.text);
        if (!text || !Number.isInteger(turn)) return [];
        return [
          {
            op: "add",
            project: asString(op.project) ? clip(asString(op.project)!, 60) : null,
            parent: asString(op.parent) ?? null,
            text: clip(text, 120),
            turn,
            ...(op.status === "waiting" ? { status: "waiting" as const } : {}),
          },
        ];
      }
      case "move": {
        const id = asString(op.id);
        const project = asString(op.project);
        return id && project ? [{ op: "move", id, project: clip(project, 60) }] : [];
      }
      case "link": {
        const id = asString(op.id);
        return id && Number.isInteger(turn) ? [{ op: "link", id, turn }] : [];
      }
      case "status": {
        const id = asString(op.id);
        const status = op.status as TaskStatus;
        if (!id || !STATUSES.includes(status)) return [];
        return [{ op: "status", id, status, turn: Number.isInteger(turn) ? turn : undefined }];
      }
      case "note": {
        const id = asString(op.id);
        const text = asString(op.text);
        if (!id || !text) return [];
        return [
          {
            op: "note",
            id,
            text: clip(text, 140),
            turn: Number.isInteger(turn) ? turn : undefined,
          },
        ];
      }
      default:
        return [];
    }
  });
}

const refFor = (turn: WatchedTurn): TaskThreadRef => ({
  environmentId: turn.environmentId,
  threadId: turn.threadId,
  title: turn.threadTitle,
});

function withThread(item: TaskItem, ref: TaskThreadRef): TaskItem {
  const others = item.threads.filter(
    (thread) => !(thread.environmentId === ref.environmentId && thread.threadId === ref.threadId),
  );
  return { ...item, threads: [...others, ref] };
}

function linkTurn(board: TaskBoard, id: string, turn: WatchedTurn | undefined, now: string) {
  if (!turn) return board;
  const ref = refFor(turn);
  const found = findTask(board.items, id);
  // Projects collect tasks, not chats.
  if (!found || found.parent === null) return board;
  if (found.item.threads.some((thread) => thread.threadId === ref.threadId)) return board;
  return updateTask(board, id, (item) => ({ ...withThread(item, ref), updatedAt: now }));
}

export const projectKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** The project item with this name (ignoring case, spaces and punctuation), made if missing. */
function ensureProject(board: TaskBoard, name: string, now: string): [TaskBoard, string] {
  const key = projectKey(name) || projectKey(OTHER_PROJECT);
  const project = board.items.find((item) => projectKey(item.text) === key);
  if (project) return [board, project.id];
  const created = makeTask(name.trim() || OTHER_PROJECT, "watcher", now);
  return [addTask(board, null, created), created.id];
}

/**
 * Applies the watcher's ops. It may add, link, note, move and change status, but never deletes,
 * never reopens or moves a done item, and never marks a project (top-level item) done.
 */
export function applyWatcherOps(
  board: TaskBoard,
  turns: ReadonlyArray<WatchedTurn>,
  ops: ReadonlyArray<WatcherOp>,
  now = new Date().toISOString(),
): TaskBoard {
  let next = board;
  const turnAt = (index: number) => turns[index - 1];
  for (const op of ops) {
    switch (op.op) {
      case "add": {
        const turn = turnAt(op.turn);
        if (!turn) break;
        let parentId = op.parent && findTask(next.items, op.parent) ? op.parent : null;
        if (parentId === null) {
          [next, parentId] = ensureProject(next, op.project ?? OTHER_PROJECT, now);
        }
        const siblings = findTask(next.items, parentId)?.item.children ?? [];
        if (siblings.some((item) => item.text.toLowerCase() === op.text.toLowerCase())) break;
        next = addTask(
          next,
          parentId,
          makeTask(op.text, "watcher", now, {
            threads: [refFor(turn)],
            ...(op.status ? { status: op.status } : {}),
          }),
        );
        break;
      }
      case "link": {
        const turn = turnAt(op.turn);
        if (!turn || !findTask(next.items, op.id)) break;
        next = updateTask(next, op.id, (item) => ({
          ...withThread(item, refFor(turn)),
          updatedAt: now,
        }));
        break;
      }
      case "status": {
        const found = findTask(next.items, op.id);
        if (!found) break;
        next = linkTurn(next, op.id, op.turn === undefined ? undefined : turnAt(op.turn), now);
        if (op.status === "done" && found.parent === null) break;
        // Only you reopen a done item.
        if (found.item.status === "done") break;
        next = setTaskStatus(next, op.id, op.status, now);
        break;
      }
      case "note": {
        if (!findTask(next.items, op.id)) break;
        next = linkTurn(next, op.id, op.turn === undefined ? undefined : turnAt(op.turn), now);
        next = updateTask(next, op.id, (item) => ({ ...item, note: op.text, updatedAt: now }));
        break;
      }
      case "move": {
        const found = findTask(next.items, op.id);
        // Projects and finished work stay where they are.
        if (!found || found.parent === null || found.item.status === "done") break;
        const [withProject, projectId] = ensureProject(next, op.project, now);
        if (found.parent.id === projectId) break;
        // Milestones belong to a project, so the task leaves its old one behind.
        next = addTask(removeTask(withProject, op.id), projectId, {
          ...found.item,
          milestone: undefined,
        });
        break;
      }
    }
  }
  return next;
}

/** A task a running chat is working on now, and when that run started (null when unknown). */
export interface WorkingTask {
  readonly environmentId: string;
  readonly threadId: string;
  readonly startedAt: string | null;
}

/** What a chat is doing right now, from its live state, keyed `${environmentId}:${threadId}`. */
export interface ChatLiveState {
  readonly working: boolean;
  readonly startedAt: string | null;
  /** The chat is asking you something: a question card, an approval. */
  readonly needsYou: boolean;
  /** When you last wrote in the chat. */
  readonly lastUserAt: string | null;
}

/** An open task's live state: the chat working on it, and whether it is really waiting on you. */
export interface TaskLiveState {
  readonly working: WorkingTask | null;
  readonly waiting: boolean;
}

const chatKey = (thread: { environmentId: string; threadId: string }) =>
  `${thread.environmentId}:${thread.threadId}`;

/**
 * Every open task's live state, by task id. A chat linked to several open tasks is on the one
 * changed last. "Waiting on you" is what the watcher set when the chat's last turn ended, so the
 * live chat wins: a task isn't waiting while its chat works or after you wrote in the chat, and is
 * waiting whenever its chat asks you something.
 */
export function taskLiveStates(
  projects: ReadonlyArray<TaskItem>,
  chats: ReadonlyMap<string, ChatLiveState>,
): Map<string, TaskLiveState> {
  const open: TaskItem[] = [];
  const collect = (item: TaskItem) => {
    if (item.status !== "done") open.push(item);
    item.children.forEach(collect);
  };
  for (const project of projects) project.children.forEach(collect);

  // Each chat counts for one task: the open one linked to it that changed last.
  const owner = new Map<string, TaskItem>();
  for (const item of open) {
    for (const thread of item.threads) {
      const key = chatKey(thread);
      if (!chats.has(key)) continue;
      const current = owner.get(key);
      if (!current || Date.parse(item.updatedAt) > Date.parse(current.updatedAt)) {
        owner.set(key, item);
      }
    }
  }

  const result = new Map<string, TaskLiveState>();
  for (const item of open) {
    let working: WorkingTask | null = null;
    let needsYou = false;
    let answered = false;
    for (const thread of item.threads) {
      const chat = chats.get(chatKey(thread));
      if (!chat) continue;
      if (chat.lastUserAt && Date.parse(chat.lastUserAt) > Date.parse(item.updatedAt)) {
        answered = true;
      }
      if (owner.get(chatKey(thread)) !== item) continue;
      if (chat.needsYou) needsYou = true;
      // Two chats on one task: show the run that started first.
      if (
        chat.working &&
        (!working ||
          (chat.startedAt !== null &&
            (working.startedAt === null || chat.startedAt < working.startedAt)))
      ) {
        working = {
          environmentId: thread.environmentId,
          threadId: thread.threadId,
          startedAt: chat.startedAt,
        };
      }
    }
    // A chat asking you something is stopped on you, like the sidebar shows it, not working.
    if (needsYou) result.set(item.id, { working: null, waiting: true });
    else
      result.set(item.id, { working, waiting: !working && item.status === "waiting" && !answered });
  }
  return result;
}

/** One row of the Tasks page's Now strip. */
export interface NowTask {
  readonly project: string;
  readonly item: TaskItem;
  readonly state: TaskLiveState;
}

/**
 * Every task a chat is working on or waiting on you for, across projects: waiting first (newest
 * first), then working (the run started last first).
 */
export function nowTasks(
  projects: ReadonlyArray<TaskItem>,
  live: ReadonlyMap<string, TaskLiveState>,
): NowTask[] {
  const rows: NowTask[] = [];
  const visit = (project: string, item: TaskItem) => {
    const state = live.get(item.id);
    if (state && (state.waiting || state.working)) rows.push({ project, item, state });
    for (const child of item.children) visit(project, child);
  };
  for (const project of projects) for (const child of project.children) visit(project.text, child);
  const startedMs = (row: NowTask) => Date.parse(row.state.working?.startedAt ?? "") || 0;
  return rows.toSorted((a, b) => {
    if (a.state.waiting !== b.state.waiting) return a.state.waiting ? -1 : 1;
    if (a.state.waiting) return Date.parse(b.item.updatedAt) - Date.parse(a.item.updatedAt);
    return startedMs(b) - startedMs(a);
  });
}

/** Tasks ticked off at or after `fromMs`, with their project, newest first. */
export function tasksDoneSince(
  projects: ReadonlyArray<TaskItem>,
  fromMs: number,
): Array<{ readonly project: string; readonly item: TaskItem }> {
  const rows: Array<{ project: string; item: TaskItem }> = [];
  const visit = (project: string, item: TaskItem) => {
    if (item.status === "done" && item.doneAt && Date.parse(item.doneAt) >= fromMs) {
      rows.push({ project, item });
    }
    for (const child of item.children) visit(project, child);
  };
  for (const project of projects) for (const child of project.children) visit(project.text, child);
  return rows.toSorted((a, b) => Date.parse(b.item.doneAt ?? "") - Date.parse(a.item.doneAt ?? ""));
}

export type KanbanColumn = "todo" | "progress" | "review" | "waiting" | "done";

export interface KanbanCard {
  readonly project: string;
  readonly item: TaskItem;
  /** The chat working on it or one of its subtasks. */
  readonly working: WorkingTask | null;
  readonly subtasks: { readonly done: number; readonly total: number };
  /** A subtask's card (Done column only): the task it's under. */
  readonly parent?: TaskItem | undefined;
}

/**
 * The Board's columns. Waiting when the task or a subtask is; in progress while a chat works on
 * it; In review when an agent finished it for you to check; otherwise in progress once started (a
 * chat is linked to it or a subtask, or a subtask is done); Done since
 * `doneSinceMs`. Newest first, with the ones working now on top of In progress.
 */
export function kanbanColumns(
  projects: ReadonlyArray<TaskItem>,
  live: ReadonlyMap<string, TaskLiveState>,
  doneSinceMs: number,
): Record<KanbanColumn, KanbanCard[]> {
  const columns: Record<KanbanColumn, KanbanCard[]> = {
    todo: [],
    progress: [],
    review: [],
    waiting: [],
    done: [],
  };
  for (const project of projects) {
    for (const item of project.children) {
      const subtasks = {
        done: item.children.filter((child) => child.status === "done").length,
        total: item.children.length,
      };
      if (item.status === "done") {
        if (!item.doneAt || Date.parse(item.doneAt) >= doneSinceMs) {
          columns.done.push({ project: project.text, item, working: null, subtasks });
        }
        continue;
      }
      let waiting = false;
      let working: WorkingTask | null = null;
      let started = subtasks.done > 0;
      const visit = (task: TaskItem) => {
        const state = live.get(task.id);
        if (state?.waiting) waiting = true;
        if (state?.working && !working) working = state.working;
        if (task.threads.length > 0) started = true;
        task.children.forEach(visit);
      };
      visit(item);
      const card = { project: project.text, item, working, subtasks };
      columns[
        waiting
          ? "waiting"
          : working
            ? "progress"
            : item.status === "review"
              ? "review"
              : started
                ? "progress"
                : "todo"
      ].push(card);
      // Subtasks ticked off lately show in Done too, under their task's name; a done subtask's
      // own subtasks go with it.
      const doneUnder = (parent: TaskItem) => {
        for (const child of parent.children) {
          if (child.status !== "done") doneUnder(child);
          else if (!child.doneAt || Date.parse(child.doneAt) >= doneSinceMs) {
            columns.done.push({
              project: project.text,
              item: child,
              working: null,
              subtasks: {
                done: child.children.filter((sub) => sub.status === "done").length,
                total: child.children.length,
              },
              parent,
            });
          }
        }
      };
      doneUnder(item);
    }
  }
  const newest =
    (key: (card: KanbanCard) => string | undefined) => (a: KanbanCard, b: KanbanCard) =>
      (Date.parse(key(b) ?? "") || 0) - (Date.parse(key(a) ?? "") || 0);
  return {
    todo: columns.todo.toSorted(newest((card) => card.item.updatedAt)),
    progress: columns.progress.toSorted(
      (a, b) =>
        Number(b.working !== null) - Number(a.working !== null) ||
        newest((card) => card.working?.startedAt ?? card.item.updatedAt)(a, b),
    ),
    review: columns.review.toSorted(newest((card) => card.item.updatedAt)),
    waiting: columns.waiting.toSorted(newest((card) => card.item.updatedAt)),
    done: columns.done.toSorted(newest((card) => card.item.doneAt ?? card.item.updatedAt)),
  };
}

/**
 * The app project each board project belongs to, for its icon: the app project with the same
 * name, or else the one most of its chats (and its tasks' chats) run in. A name match wins
 * because chats often run in a broader project (such as home). Keyed by the board project's
 * text, as the views show it. Values are the `projectKey` the caller gave.
 */
export function boardProjectKeys(
  projects: ReadonlyArray<TaskItem>,
  projectOfChat: ReadonlyMap<string, string>,
  projectByName: ReadonlyMap<string, string>,
): Map<string, string> {
  const result = new Map<string, string>();
  for (const project of projects) {
    const named = projectByName.get(project.text.trim().toLowerCase());
    if (named) {
      result.set(project.text, named);
      continue;
    }
    const votes = new Map<string, number>();
    const visit = (item: TaskItem) => {
      for (const thread of item.threads) {
        const key = projectOfChat.get(`${thread.environmentId}:${thread.threadId}`);
        if (key) votes.set(key, (votes.get(key) ?? 0) + 1);
      }
      item.children.forEach(visit);
    };
    visit(project);
    let best: string | null = null;
    let bestVotes = 0;
    for (const [key, count] of votes) {
      if (count > bestVotes) {
        best = key;
        bestVotes = count;
      }
    }
    if (best) result.set(project.text, best);
  }
  return result;
}
