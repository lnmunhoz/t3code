import { describe, expect, it } from "vite-plus/test";

import {
  addMilestone,
  dueWords,
  editMilestone,
  filterByMilestones,
  milestoneGroups,
  milestoneProgress,
  moveMilestone,
  NO_MILESTONE,
  readyToClose,
  removeMilestone,
  setMilestoneState,
  setTaskMilestone,
  tasksInMilestone,
} from "./milestones.logic";
import {
  addTask,
  applyWatcherOps,
  makeTask,
  parseTaskBoard,
  serializeTaskBoard,
  type TaskBoard,
  type TaskLiveState,
} from "./taskBoard.logic";

const NOW = "2026-11-22T10:00:00.000Z";

function board(): TaskBoard {
  let next: TaskBoard = { version: 1, items: [] };
  next = addTask(next, null, { ...makeTask("ThaiLookup", "you", NOW), id: "p1" });
  next = addTask(next, "p1", { ...makeTask("Phrase pages", "you", NOW), id: "a" });
  next = addTask(next, "p1", { ...makeTask("Sitemap", "you", NOW), id: "b" });
  next = addTask(next, "p1", { ...makeTask("Hero", "you", NOW), id: "c" });
  next = addTask(next, "a", { ...makeTask("Sub", "you", NOW), id: "a1" });
  next = addTask(next, null, { ...makeTask("RentaBus", "you", NOW), id: "p2" });
  next = addTask(next, "p2", { ...makeTask("Heroku", "you", NOW), id: "r" });
  return next;
}

const project = (next: TaskBoard, id = "p1") => next.items.find((item) => item.id === id)!;

describe("milestones on the board", () => {
  it("adds, renames, orders, closes and removes, keeping names unique per project", () => {
    let next = board();
    const seo = addMilestone(
      next,
      "p1",
      { name: "SEO v2", goal: "Phrase pages", due: "2026-12-01" },
      NOW,
    );
    next = seo.board;
    const again = addMilestone(next, "p1", { name: "seo V2 " }, NOW);
    expect(again.milestone?.id).toBe(seo.milestone?.id);
    expect(again.board).toBe(next);
    next = addMilestone(next, "p1", { name: "Launch" }, NOW).board;
    expect(project(next).milestones?.map((m) => m.name)).toEqual(["SEO v2", "Launch"]);

    const launchId = project(next).milestones![1]!.id;
    next = moveMilestone(next, "p1", launchId, -1);
    expect(project(next).milestones?.map((m) => m.name)).toEqual(["Launch", "SEO v2"]);
    // Renaming to a name another milestone has keeps the old name.
    next = editMilestone(next, "p1", launchId, { name: "SEO V2", goal: " Ship it " });
    expect(project(next).milestones![0]).toMatchObject({ name: "Launch", goal: "Ship it" });

    next = setMilestoneState(next, "p1", launchId, "closed", NOW);
    expect(project(next).milestones![0]).toMatchObject({ state: "closed", closedAt: NOW });
    next = setMilestoneState(next, "p1", launchId, "open", NOW);
    expect(project(next).milestones![0]!.closedAt).toBeUndefined();

    next = setTaskMilestone(next, "a", launchId, NOW);
    next = removeMilestone(next, "p1", launchId);
    expect(project(next).milestones?.map((m) => m.name)).toEqual(["SEO v2"]);
    expect(project(next).children.find((task) => task.id === "a")?.milestone).toBeUndefined();
  });

  it("puts only a project's own tasks in its open milestones", () => {
    let next = addMilestone(board(), "p1", { name: "SEO" }, NOW).board;
    const seoId = project(next).milestones![0]!.id;
    next = setTaskMilestone(next, "a", seoId, NOW);
    expect(tasksInMilestone(project(next), seoId).map((task) => task.id)).toEqual(["a"]);
    // Another project's task, or a sub-task, can't join it.
    expect(setTaskMilestone(next, "r", seoId, NOW)).toBe(next);
    expect(setTaskMilestone(next, "a1", seoId, NOW)).toBe(next);
    // A closed milestone takes no new tasks.
    next = setMilestoneState(next, "p1", seoId, "closed", NOW);
    expect(setTaskMilestone(next, "b", seoId, NOW)).toBe(next);
    next = setTaskMilestone(next, "a", null, NOW);
    expect(tasksInMilestone(project(next), seoId)).toEqual([]);
  });

  it("survives a save and a read of the file, and the watcher moving a task away", () => {
    let next = addMilestone(board(), "p1", { name: "SEO", due: "2026-12-01" }, NOW).board;
    const seoId = project(next).milestones![0]!.id;
    next = setTaskMilestone(next, "a", seoId, NOW);
    const read = parseTaskBoard(serializeTaskBoard(next), NOW);
    expect(project(read).milestones).toEqual(project(next).milestones);
    expect(project(read).children[0]!.milestone).toBe(seoId);
    const moved = applyWatcherOps(read, [], [{ op: "move", id: "a", project: "RentaBus" }], NOW);
    expect(
      project(moved, "p2").children.find((task) => task.id === "a")?.milestone,
    ).toBeUndefined();
  });

  it("drops a bad date and a repeated name when reading", () => {
    const read = parseTaskBoard(
      JSON.stringify({
        items: [
          {
            id: "p",
            text: "P",
            milestones: [
              { id: "m1", name: "One", due: "soon" },
              { id: "m2", name: "one" },
              { id: "m3", name: "Two", state: "closed" },
            ],
          },
        ],
      }),
      NOW,
    );
    expect(read.items[0]!.milestones).toEqual([
      {
        id: "m1",
        name: "One",
        goal: undefined,
        due: undefined,
        state: "open",
        closedAt: undefined,
        createdAt: NOW,
      },
      {
        id: "m3",
        name: "Two",
        goal: undefined,
        due: undefined,
        state: "closed",
        closedAt: NOW,
        createdAt: NOW,
      },
    ]);
  });
});

describe("milestoneProgress", () => {
  it("counts done, working, waiting, in review and the rest", () => {
    let next = board();
    next = { ...next };
    const open = project(next).children.map((task, index) =>
      index === 0 ? { ...task, status: "done" as const } : task,
    );
    const tasks = [...open, { ...open[1]!, id: "r", status: "review" as const }];
    const live = new Map<string, TaskLiveState>([
      [
        "b",
        {
          working: { environmentId: "e", threadId: "t", startedAt: NOW },
          waiting: false,
        },
      ],
      ["c", { working: null, waiting: true }],
    ]);
    expect(milestoneProgress(tasks, live)).toEqual({
      total: 4,
      done: 1,
      working: 1,
      waiting: 1,
      review: 1,
      todo: 0,
      pct: 25,
    });
    expect(milestoneProgress([], live).pct).toBe(0);
  });

  it("asks to close an open milestone only when all its tasks are done", () => {
    const milestone = { id: "m", name: "M", state: "open" as const, createdAt: NOW };
    const all = { total: 2, done: 2, working: 0, waiting: 0, review: 0, todo: 0, pct: 100 };
    expect(readyToClose(milestone, all)).toBe(true);
    expect(readyToClose(milestone, { ...all, done: 1, todo: 1, pct: 50 })).toBe(false);
    expect(readyToClose(milestone, { ...all, total: 0, done: 0, pct: 0 })).toBe(false);
    expect(readyToClose({ ...milestone, state: "closed" }, all)).toBe(false);
  });
});

describe("dueWords", () => {
  // Noon local time, so the day doesn't shift with the zone the test runs in.
  const noon = new Date(2026, 10, 22, 12).getTime();
  it("says days left, due today, or days late", () => {
    expect(dueWords("2026-11-22", noon)).toEqual({ text: "due today", tone: "soon" });
    expect(dueWords("2026-11-23", noon)).toEqual({ text: "1 day left", tone: "soon" });
    expect(dueWords("2026-11-30", noon)).toEqual({ text: "8 days left", tone: "later" });
    expect(dueWords("2026-11-18", noon)).toEqual({ text: "4 days late", tone: "late" });
    expect(dueWords(undefined, noon)).toBeNull();
  });
});

describe("milestoneGroups and filterByMilestones", () => {
  it("groups by open milestone in order, then closed ones with tasks, then No milestone", () => {
    let next = board();
    next = addMilestone(next, "p1", { name: "One" }, NOW).board;
    next = addMilestone(next, "p1", { name: "Two" }, NOW).board;
    next = addMilestone(next, "p1", { name: "Old" }, NOW).board;
    const [one, two, old] = project(next).milestones!;
    next = setTaskMilestone(next, "b", two!.id, NOW);
    next = setTaskMilestone(next, "c", old!.id, NOW);
    next = setMilestoneState(next, "p1", old!.id, "closed", NOW);
    const groups = milestoneGroups(project(next), project(next).children);
    expect(
      groups.map((group) => [group.milestone?.name ?? null, group.tasks.map((t) => t.id)]),
    ).toEqual([
      ["One", []],
      ["Two", ["b"]],
      ["Old", ["c"]],
      [null, ["a"]],
    ]);
    expect(milestoneGroups(project(next, "p2"), project(next, "p2").children)).toEqual([
      { milestone: null, tasks: project(next, "p2").children },
    ]);

    const filtered = filterByMilestones(next.items, new Set([two!.id, NO_MILESTONE]));
    expect(filtered.map((p) => [p.id, p.children.map((t) => t.id)])).toEqual([
      ["p1", ["a", "b"]],
      ["p2", ["r"]],
    ]);
    expect(filtered[0]!.children[0]!.children.map((t) => t.id)).toEqual(["a1"]);
    expect(filterByMilestones(next.items, new Set([one!.id]))).toEqual([]);
  });
});
