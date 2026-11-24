import { describe, expect, it } from "vite-plus/test";

import {
  boardProjectKeys,
  kanbanColumns,
  addTask,
  applyWatcherOps,
  buildWatcherPrompt,
  filterTasks,
  filterTasksByWindow,
  findTask,
  indentTask,
  isStaleTask,
  makeTask,
  nowTasks,
  mentionedFolders,
  outdentTask,
  parseTaskBoard,
  labelsIn,
  setTaskLabels,
  parseWatcherOps,
  projectForThread,
  serializeTaskBoard,
  setTaskStatus,
  sortTasks,
  type TaskBoard,
  type WatchedTurn,
  wasUpdatedSinceAdded,
  taskLiveStates,
  tasksDoneSince,
} from "./taskBoard.logic";

const NOW = "2026-11-22T10:00:00.000Z";

const turn = (overrides: Partial<WatchedTurn> = {}): WatchedTurn => ({
  environmentId: "env-1",
  threadId: "thread-aaaaaaaa",
  threadTitle: "Music bars",
  t3ProjectName: "t3code",
  workspace: "~/projects/t3code",
  prompt: "Make the music bars show",
  reply: "Done, the bars show now.",
  ...overrides,
});

function boardWith(): TaskBoard {
  const project = { ...makeTask("t3code", "you", NOW), id: "p1" };
  const task = { ...makeTask("Fix music bars", "you", NOW), id: "t1" };
  return addTask(addTask({ version: 1, items: [] }, null, project), "p1", task);
}

describe("parseTaskBoard", () => {
  it("accepts a hand-written file with bare strings and missing fields", () => {
    const board = parseTaskBoard(
      JSON.stringify({
        items: [{ text: "Home", children: ["Buy milk", { title: "Call mom", done: true }] }],
      }),
      NOW,
    );
    expect(board.items).toHaveLength(1);
    const [home] = board.items;
    expect(home!.children.map((child) => [child.text, child.status])).toEqual([
      ["Buy milk", "active"],
      ["Call mom", "done"],
    ]);
    expect(home!.children[1]!.doneAt).toBe(NOW);
  });

  it("returns an empty board for broken JSON and round-trips its own output", () => {
    expect(parseTaskBoard("{nope").items).toEqual([]);
    const board = boardWith();
    expect(parseTaskBoard(serializeTaskBoard(board), NOW)).toEqual(board);
  });

  it("gives items without an id the same id on every read", () => {
    const text = JSON.stringify([{ text: "Home", children: ["Buy milk"] }]);
    expect(parseTaskBoard(text, NOW)).toEqual(parseTaskBoard(text, NOW));
    expect(parseTaskBoard(text).items[0]!.children[0]!.id).toMatch(/^x/);
  });

  it("gives duplicate ids new ones", () => {
    const board = parseTaskBoard(
      JSON.stringify([
        { id: "a", text: "x" },
        { id: "a", text: "y" },
      ]),
    );
    expect(new Set(board.items.map((item) => item.id)).size).toBe(2);
  });
});

describe("outline edits", () => {
  it("indents under the sibling above and outdents back after the parent", () => {
    let board = boardWith();
    board = addTask(board, "p1", { ...makeTask("Write tests", "you", NOW), id: "t2" });
    board = indentTask(board, "t2");
    expect(findTask(board.items, "t2")!.parent!.id).toBe("t1");
    board = outdentTask(board, "t2");
    expect(findTask(board.items, "t2")!.parent!.id).toBe("p1");
    expect(board.items[0]!.children.map((item) => item.id)).toEqual(["t1", "t2"]);
  });

  it("stamps doneAt when done and clears it when reopened", () => {
    let board = setTaskStatus(boardWith(), "t1", "done", NOW);
    expect(findTask(board.items, "t1")!.item.doneAt).toBe(NOW);
    board = setTaskStatus(board, "t1", "active", NOW);
    expect(findTask(board.items, "t1")!.item.doneAt).toBeUndefined();
  });
});

describe("projectForThread", () => {
  it("names the board project of the chat's open task, else null", () => {
    let board = applyWatcherOps(
      boardWith(),
      [turn()],
      [{ op: "add", project: "ThaiLookup", parent: null, text: "Phrase pages", turn: 1 }],
      NOW,
    );
    expect(projectForThread(board, "env-1", "thread-aaaaaaaa")?.text).toBe("ThaiLookup");
    expect(projectForThread(board, "env-2", "thread-aaaaaaaa")).toBeNull();
    board = applyWatcherOps(
      board,
      [turn()],
      [{ op: "link", id: "t1", turn: 1 }],
      "2026-11-23T00:00:00.000Z",
    );
    expect(projectForThread(board, "env-1", "thread-aaaaaaaa")?.text).toBe("t3code");
  });
});

describe("freshness", () => {
  it("flags open tasks untouched for 3 days, never done ones", () => {
    const task = makeTask("Old thing", "you", NOW);
    const later = Date.parse(NOW) + 3 * 24 * 60 * 60 * 1000;
    expect(isStaleTask(task, later - 1)).toBe(false);
    expect(isStaleTask(task, later)).toBe(true);
    expect(isStaleTask({ ...task, status: "done" }, later)).toBe(false);
  });

  it("tells a task changed after it was added", () => {
    const task = makeTask("Thing", "you", NOW);
    expect(wasUpdatedSinceAdded(task)).toBe(false);
    expect(wasUpdatedSinceAdded({ ...task, updatedAt: "2026-11-22T12:00:00.000Z" })).toBe(true);
  });
});

describe("watcher", () => {
  it("parses ops from a reply with extra text and drops bad ones", () => {
    const ops = parseWatcherOps(
      'Sure:\n{"ops":[{"op":"add","parent":"p1","text":"Ship it","turn":1},{"op":"status","id":"t1","status":"finished"},{"op":"note","id":"t1","text":"bars work"}]}',
    );
    expect(ops).toEqual([
      { op: "add", project: null, parent: "p1", text: "Ship it", turn: 1 },
      { op: "note", id: "t1", text: "bars work", turn: undefined },
    ]);
    expect(parseWatcherOps(null)).toEqual([]);
  });

  it("adds a task under the project the model names, matched loosely, with the chat linked", () => {
    const board = applyWatcherOps(
      boardWith(),
      [turn()],
      [{ op: "add", project: "T3 Code", parent: null, text: "Task tracker page", turn: 1 }],
      NOW,
    );
    expect(board.items).toHaveLength(1);
    const project = board.items[0]!;
    expect(project.children.map((item) => item.text)).toEqual([
      "Fix music bars",
      "Task tracker page",
    ]);
    expect(project.children[1]!.threads).toEqual([
      { environmentId: "env-1", threadId: "thread-aaaaaaaa", title: "Music bars" },
    ]);
  });

  it("makes a new project rather than using the T3 folder, and skips duplicates", () => {
    const add = { op: "add", project: "ThaiLookup", parent: null, turn: 1 } as const;
    let board = applyWatcherOps(
      boardWith(),
      [turn({ t3ProjectName: "home" })],
      [{ ...add, text: "Phrase pages" }],
      NOW,
    );
    board = applyWatcherOps(board, [turn()], [{ ...add, text: "phrase pages" }], NOW);
    expect(board.items.map((item) => item.text)).toEqual(["t3code", "ThaiLookup"]);
    expect(board.items[1]!.children.map((item) => item.text)).toEqual(["Phrase pages"]);
  });

  it("files work with no project under Other", () => {
    const board = applyWatcherOps(
      boardWith(),
      [turn()],
      [{ op: "add", project: null, parent: null, text: "Book flights", turn: 1 }],
      NOW,
    );
    expect(board.items.find((item) => item.text === "Other")!.children).toHaveLength(1);
  });

  it("moves an open task to another project, but never a done one or a project", () => {
    let board = applyWatcherOps(
      boardWith(),
      [turn()],
      [
        { op: "move", id: "t1", project: "Music app" },
        { op: "move", id: "p1", project: "Music app" },
      ],
      NOW,
    );
    expect(board.items.map((item) => [item.text, item.children.length])).toEqual([
      ["t3code", 0],
      ["Music app", 1],
    ]);
    board = setTaskStatus(board, "t1", "done", NOW);
    board = applyWatcherOps(board, [turn()], [{ op: "move", id: "t1", project: "t3code" }], NOW);
    expect(findTask(board.items, "t1")!.parent!.text).toBe("Music app");
  });

  it("links the chat when it marks a task done", () => {
    const board = applyWatcherOps(
      boardWith(),
      [turn()],
      [{ op: "status", id: "t1", status: "done", turn: 1 }],
      NOW,
    );
    const task = findTask(board.items, "t1")!.item;
    expect(task.status).toBe("done");
    expect(task.threads.map((thread) => thread.threadId)).toEqual(["thread-aaaaaaaa"]);
  });

  it("never marks a project done or reopens a done task", () => {
    let board = setTaskStatus(boardWith(), "t1", "done", NOW);
    board = applyWatcherOps(
      board,
      [turn()],
      [
        { op: "status", id: "p1", status: "done" },
        { op: "status", id: "t1", status: "active" },
      ],
      NOW,
    );
    expect(board.items[0]!.status).toBe("active");
    expect(findTask(board.items, "t1")!.item.status).toBe("done");
  });

  it("links a chat once and keeps the prompt small", () => {
    let board = applyWatcherOps(boardWith(), [turn()], [{ op: "link", id: "t1", turn: 1 }], NOW);
    board = applyWatcherOps(board, [turn()], [{ op: "link", id: "t1", turn: 1 }], NOW);
    expect(findTask(board.items, "t1")!.item.threads).toHaveLength(1);
    const prompt = buildWatcherPrompt(board, [turn({ reply: "x".repeat(5_000) })]);
    expect(prompt).toContain("[t1] Fix music bars (active; chats thread-a)");
    expect(prompt.length).toBeLessThan(1_500);
  });

  it("finds the project folders a turn mentions", () => {
    expect(
      mentionedFolders(
        "Edited /Users/lucas/home/ThaiLookup/src/a.ts and ~/home/ThaiLookup/b.ts, see ~/.config/t3code-tasks/tasks.json and ~/projects/t3code-nightly/apps",
      ),
    ).toEqual(["~/home/ThaiLookup", "~/.config/t3code-tasks", "~/projects/t3code-nightly"]);
    expect(mentionedFolders("no paths here")).toEqual([]);
  });
});

describe("filterTasksByWindow", () => {
  it("keeps tasks that moved in the window, with their parents, and drops empty projects", () => {
    const at = (iso: string) => ({ createdAt: iso, updatedAt: iso });
    let board: TaskBoard = { version: 1, items: [] };
    board = addTask(board, null, { ...makeTask("RentaBus", "you", NOW), id: "p1" });
    board = addTask(board, null, { ...makeTask("ThaiLookup", "you", NOW), id: "p2" });
    board = addTask(board, "p1", {
      ...makeTask("Heroku move", "you", NOW),
      id: "t1",
      ...at("2026-11-10T00:00:00.000Z"),
    });
    board = addTask(board, "t1", {
      ...makeTask("DNS record", "you", NOW),
      id: "t2",
      ...at("2026-11-22T09:00:00.000Z"),
    });
    board = addTask(board, "p1", {
      ...makeTask("Old thing", "you", NOW),
      id: "t3",
      ...at("2026-11-01T00:00:00.000Z"),
    });
    board = addTask(board, "p2", {
      ...makeTask("Phrase pages", "you", NOW),
      id: "t4",
      ...at("2026-11-01T00:00:00.000Z"),
      status: "done",
      doneAt: "2026-11-21T12:00:00.000Z",
    });
    const window = {
      from: Date.parse("2026-11-21T00:00:00.000Z"),
      to: Date.parse("2026-11-22T00:00:00.000Z"),
    };
    const day21 = filterTasksByWindow(board.items, window);
    expect(day21.matches).toBe(1);
    expect(day21.items.map((project) => project.text)).toEqual(["ThaiLookup"]);
    const recent = filterTasksByWindow(board.items, {
      from: window.from,
      to: Number.POSITIVE_INFINITY,
    });
    expect(recent.matches).toBe(2);
    expect(
      recent.items[0]!.children.map((item) => [item.id, item.children.map((child) => child.id)]),
    ).toEqual([["t1", ["t2"]]]);
  });
});

describe("taskLiveStates", () => {
  const chat = { environmentId: "env-1", threadId: "thread-a", title: "Chat" };
  const idle = { working: false, startedAt: null, needsYou: false, lastUserAt: null };
  const boardWithChat = () => {
    let board: TaskBoard = { version: 1, items: [] };
    board = addTask(board, null, {
      ...makeTask("RentaBus", "you", NOW),
      id: "p1",
      threads: [chat],
    });
    board = addTask(board, "p1", {
      ...makeTask("Older task", "you", NOW),
      id: "t1",
      threads: [chat],
      status: "waiting",
      updatedAt: "2026-11-22T08:00:00.000Z",
    });
    board = addTask(board, "p1", {
      ...makeTask("Newer task", "you", NOW),
      id: "t2",
      threads: [chat],
      status: "waiting",
      updatedAt: "2026-11-22T09:00:00.000Z",
    });
    return addTask(board, "p1", {
      ...makeTask("Done task", "you", NOW),
      id: "t3",
      threads: [chat],
      status: "done",
      updatedAt: "2026-11-22T09:30:00.000Z",
    });
  };

  it("puts a running chat on the open task it changed last, and that task isn't waiting", () => {
    const live = taskLiveStates(
      boardWithChat().items,
      new Map([
        ["env-1:thread-a", { ...idle, working: true, startedAt: "2026-11-22T09:50:00.000Z" }],
      ]),
    );
    expect(live.get("t2")).toEqual({
      working: {
        environmentId: "env-1",
        threadId: "thread-a",
        startedAt: "2026-11-22T09:50:00.000Z",
      },
      waiting: false,
    });
    expect(live.get("t1")?.working).toBeNull();
    expect(live.has("t3")).toBe(false);
  });

  it("keeps the watcher's waiting until you write in the chat, and shows a live question", () => {
    expect(taskLiveStates(boardWithChat().items, new Map()).get("t2")?.waiting).toBe(true);
    const replied = taskLiveStates(
      boardWithChat().items,
      new Map([["env-1:thread-a", { ...idle, lastUserAt: "2026-11-22T09:10:00.000Z" }]]),
    );
    expect(replied.get("t2")?.waiting).toBe(false);
    expect(replied.get("t1")?.waiting).toBe(false);
    const asking = taskLiveStates(
      boardWithChat().items,
      new Map([
        ["env-1:thread-a", { ...idle, needsYou: true, lastUserAt: "2026-11-22T09:10:00.000Z" }],
      ]),
    );
    expect(asking.get("t2")?.waiting).toBe(true);
  });
});

describe("filterTasks and sortTasks", () => {
  const at = (created: string, updated: string) => ({ createdAt: created, updatedAt: updated });
  const board = () => {
    let next: TaskBoard = { version: 1, items: [] };
    next = addTask(next, null, { ...makeTask("Old project", "you", NOW), id: "p1" });
    next = addTask(next, null, { ...makeTask("New project", "you", NOW), id: "p2" });
    next = addTask(next, "p1", {
      ...makeTask("A", "you", NOW),
      id: "a",
      ...at("2026-11-01T00:00:00.000Z", "2026-11-22T09:00:00.000Z"),
    });
    next = addTask(next, "p1", {
      ...makeTask("B", "you", NOW),
      id: "b",
      ...at("2026-11-20T00:00:00.000Z", "2026-11-20T00:00:00.000Z"),
    });
    next = addTask(next, "p2", {
      ...makeTask("C", "you", NOW),
      id: "c",
      ...at("2026-11-21T00:00:00.000Z", "2026-11-21T00:00:00.000Z"),
    });
    return next.items;
  };

  it("keeps only the tasks asked for, with their projects", () => {
    const kept = filterTasks(board(), (item) => item.id === "c");
    expect(kept.matches).toBe(1);
    expect(kept.items.map((project) => project.id)).toEqual(["p2"]);
  });

  it("orders projects and tasks newest first by last change or by when added", () => {
    const ids = (items: ReadonlyArray<{ id: string; children: ReadonlyArray<{ id: string }> }>) =>
      items.map((item) => [item.id, item.children.map((child) => child.id)]);
    expect(ids(sortTasks(board(), "board"))).toEqual([
      ["p1", ["a", "b"]],
      ["p2", ["c"]],
    ]);
    expect(ids(sortTasks(board(), "updated"))).toEqual([
      ["p1", ["a", "b"]],
      ["p2", ["c"]],
    ]);
    expect(ids(sortTasks(board(), "created"))).toEqual([
      ["p2", ["c"]],
      ["p1", ["b", "a"]],
    ]);
  });
});

describe("nowTasks and tasksDoneSince", () => {
  it("lists waiting tasks first, then working ones, and today's done tasks newest first", () => {
    let board: TaskBoard = { version: 1, items: [] };
    board = addTask(board, null, { ...makeTask("RentaBus", "you", NOW), id: "p1" });
    board = addTask(board, "p1", { ...makeTask("Working one", "you", NOW), id: "w" });
    board = addTask(board, "p1", { ...makeTask("Waiting one", "you", NOW), id: "q" });
    board = addTask(board, "p1", { ...makeTask("Idle", "you", NOW), id: "i" });
    board = addTask(board, "p1", {
      ...makeTask("Done early", "you", NOW),
      id: "d1",
      status: "done",
      doneAt: "2026-11-22T08:00:00.000Z",
    });
    board = addTask(board, "p1", {
      ...makeTask("Done late", "you", NOW),
      id: "d2",
      status: "done",
      doneAt: "2026-11-22T09:00:00.000Z",
    });
    board = addTask(board, "p1", {
      ...makeTask("Done yesterday", "you", NOW),
      id: "d3",
      status: "done",
      doneAt: "2026-11-21T09:00:00.000Z",
    });
    const live = new Map([
      ["w", { working: { environmentId: "e", threadId: "t", startedAt: NOW }, waiting: false }],
      ["q", { working: null, waiting: true }],
      ["i", { working: null, waiting: false }],
    ]);
    expect(nowTasks(board.items, live).map((row) => [row.item.id, row.project])).toEqual([
      ["q", "RentaBus"],
      ["w", "RentaBus"],
    ]);
    expect(
      tasksDoneSince(board.items, Date.parse("2026-11-22T00:00:00.000Z")).map((row) => row.item.id),
    ).toEqual(["d2", "d1"]);
  });
});

describe("kanbanColumns", () => {
  it("puts each task in a column by what it and its chats are doing", () => {
    let board: TaskBoard = { version: 1, items: [] };
    board = addTask(board, null, { ...makeTask("RentaBus", "you", NOW), id: "p1" });
    board = addTask(board, "p1", { ...makeTask("Idle", "you", NOW), id: "i" });
    board = addTask(board, "p1", { ...makeTask("Parent", "you", NOW), id: "parent" });
    // A subtask's chat is working: the card counts as working.
    board = addTask(board, "parent", { ...makeTask("Sub", "you", NOW), id: "sub" });
    board = addTask(board, "parent", {
      ...makeTask("Sub done", "you", NOW),
      id: "sub2",
      status: "done",
      doneAt: NOW,
    });
    board = addTask(board, "p1", { ...makeTask("Asks", "you", NOW), id: "q" });
    board = addTask(board, "p1", { ...makeTask("Built", "you", NOW), id: "r", status: "review" });
    // A chat back at work on a reviewed task takes it out of review.
    board = addTask(board, "p1", {
      ...makeTask("Fixing", "you", NOW),
      id: "r2",
      status: "review",
    });
    board = addTask(board, "p1", {
      ...makeTask("Done today", "you", NOW),
      id: "d1",
      status: "done",
      doneAt: "2026-11-22T09:00:00.000Z",
    });
    board = addTask(board, "p1", {
      ...makeTask("Done long ago", "you", NOW),
      id: "d0",
      status: "done",
      doneAt: "2026-11-01T09:00:00.000Z",
    });
    const working = { environmentId: "e", threadId: "t", startedAt: NOW };
    const live = new Map([
      ["sub", { working, waiting: false }],
      ["q", { working: null, waiting: true }],
      ["r2", { working, waiting: false }],
    ]);
    const columns = kanbanColumns(board.items, live, Date.parse("2026-11-20T00:00:00.000Z"));
    const ids = (column: keyof typeof columns) => columns[column].map((card) => card.item.id);
    expect(ids("todo")).toEqual(["i"]);
    expect(ids("progress").toSorted()).toEqual(["parent", "r2"]);
    expect(ids("review")).toEqual(["r"]);
    expect(columns.progress.find((card) => card.item.id === "parent")).toMatchObject({
      working,
      subtasks: { done: 1, total: 2 },
    });
    expect(ids("waiting")).toEqual(["q"]);
    // A subtask ticked off lately shows in Done under its task's name.
    expect(ids("done")).toEqual(["sub2", "d1"]);
    expect(columns.done[0]?.parent?.id).toBe("parent");
  });

  it("counts a task in progress once a chat or a done subtask shows it started", () => {
    const chat = { environmentId: "e", threadId: "t1", title: "Chat" };
    let board: TaskBoard = { version: 1, items: [] };
    board = addTask(board, null, { ...makeTask("P", "you", NOW), id: "p" });
    board = addTask(board, "p", { ...makeTask("Fresh", "you", NOW), id: "fresh" });
    board = addTask(board, "p", {
      ...makeTask("Has chat", "you", "2026-11-22T08:00:00.000Z"),
      id: "chat",
      threads: [chat],
    });
    board = addTask(board, "p", { ...makeTask("Sub chat", "you", NOW), id: "subchat" });
    board = addTask(board, "subchat", { ...makeTask("S", "you", NOW), id: "s", threads: [chat] });
    board = addTask(board, "p", { ...makeTask("Half", "you", NOW), id: "half" });
    board = addTask(board, "half", {
      ...makeTask("H", "you", NOW),
      id: "h",
      status: "done",
      doneAt: "2026-11-01T00:00:00.000Z",
    });
    board = addTask(board, "p", {
      ...makeTask("Running", "you", "2026-11-01T00:00:00.000Z"),
      id: "run",
    });
    const working = { environmentId: "e", threadId: "t2", startedAt: NOW };
    const live = new Map([["run", { working, waiting: false }]]);
    const columns = kanbanColumns(board.items, live, Date.parse("2026-11-20T00:00:00.000Z"));
    expect(columns.todo.map((card) => card.item.id)).toEqual(["fresh"]);
    // Working now first, then newest.
    expect(columns.progress.map((card) => card.item.id)).toEqual([
      "run",
      "subchat",
      "half",
      "chat",
    ]);
  });

  it("leaves out subtasks done long ago and those under a done task", () => {
    let board: TaskBoard = { version: 1, items: [] };
    board = addTask(board, null, { ...makeTask("P", "you", NOW), id: "p" });
    board = addTask(board, "p", { ...makeTask("Open", "you", NOW), id: "o" });
    board = addTask(board, "o", {
      ...makeTask("Old", "you", NOW),
      id: "old",
      status: "done",
      doneAt: "2026-11-01T09:00:00.000Z",
    });
    board = addTask(board, "o", { ...makeTask("Mid", "you", NOW), id: "mid" });
    board = addTask(board, "mid", {
      ...makeTask("Deep", "you", NOW),
      id: "deep",
      status: "done",
      doneAt: NOW,
    });
    board = addTask(board, "p", {
      ...makeTask("Closed", "you", NOW),
      id: "c",
      status: "done",
      doneAt: NOW,
    });
    board = addTask(board, "c", {
      ...makeTask("Under", "you", NOW),
      id: "u",
      status: "done",
      doneAt: NOW,
    });
    const columns = kanbanColumns(board.items, new Map(), Date.parse("2026-11-20T00:00:00.000Z"));
    expect(columns.done.map((card) => [card.item.id, card.parent?.id ?? null])).toEqual([
      ["deep", "mid"],
      ["c", null],
    ]);
  });
});

describe("boardProjectKeys", () => {
  it("picks the project with the same name, else the one most of the chats run in", () => {
    const chat = (threadId: string) => ({ environmentId: "e", threadId, title: threadId });
    let board: TaskBoard = { version: 1, items: [] };
    board = addTask(board, null, { ...makeTask("ThaiLookup", "you", NOW), id: "p1" });
    board = addTask(board, "p1", { ...makeTask("A", "you", NOW), id: "a", threads: [chat("t1")] });
    board = addTask(board, "p1", { ...makeTask("B", "you", NOW), id: "b", threads: [chat("t2")] });
    board = addTask(board, "p1", { ...makeTask("C", "you", NOW), id: "c", threads: [chat("t3")] });
    board = addTask(board, null, { ...makeTask("RentaBus", "you", NOW), id: "p2" });
    board = addTask(board, null, { ...makeTask("Unknown", "you", NOW), id: "p3" });
    board = addTask(board, null, { ...makeTask("Cello", "you", NOW), id: "p4" });
    board = addTask(board, "p4", { ...makeTask("D", "you", NOW), id: "d", threads: [chat("t1")] });
    const projectOfChat = new Map([
      ["e:t1", "e:thai"],
      ["e:t2", "e:thai"],
      ["e:t3", "e:home"],
    ]);
    const byName = new Map([
      ["rentabus", "e:rentabus"],
      ["thailookup", "e:other"],
    ]);
    expect(boardProjectKeys(board.items, projectOfChat, byName)).toEqual(
      new Map([
        ["ThaiLookup", "e:other"],
        ["RentaBus", "e:rentabus"],
        ["Cello", "e:thai"],
      ]),
    );
  });
});

describe("labels", () => {
  it("keeps labels through a save, tidied, and drops them when emptied", () => {
    const board = parseTaskBoard(
      JSON.stringify({
        items: [
          {
            id: "p",
            text: "ThaiLookup",
            children: [{ id: "a", text: "Sitemap", labels: [" SEO", "seo", "", 3, "bug"] }],
          },
        ],
      }),
      NOW,
    );
    expect(board.items[0]!.children[0]!.labels).toEqual(["seo", "bug"]);
    const again = parseTaskBoard(serializeTaskBoard(board), NOW);
    expect(again.items[0]!.children[0]!.labels).toEqual(["seo", "bug"]);
    const cleared = setTaskLabels(board, "a", [], NOW);
    expect(cleared.items[0]!.children[0]!.labels).toBeUndefined();
  });

  it("lists the labels in use, most used first", () => {
    const board = parseTaskBoard(
      JSON.stringify({
        items: [
          {
            text: "P",
            children: [
              { text: "a", labels: ["ui"] },
              { text: "b", labels: ["seo", "ui"], children: [{ text: "c", labels: ["bug"] }] },
            ],
          },
        ],
      }),
      NOW,
    );
    expect(labelsIn(board.items)).toEqual(["ui", "bug", "seo"]);
  });
});
