import { describe, expect, it } from "vite-plus/test";

import {
  addTask,
  buildWatcherPrompt,
  makeTask,
  type TaskBoard,
  type WatchedTurn,
} from "./taskBoard.logic";
import {
  answerText,
  decisionsFromAnswer,
  exchangesFromTranscript,
  dayRangeWindow,
  filterQuestions,
  groupQuestions,
  parseQuestionLog,
  parseWatcherLog,
  periodWindow,
  serializeQuestionEntries,
  timeMs,
  type QuestionEntry,
} from "./taskQuestions.logic";

const NOW = "2026-11-22T10:00:00.000Z";

const turn = (overrides: Partial<WatchedTurn> = {}): WatchedTurn => ({
  environmentId: "env-1",
  threadId: "thread-a",
  threadTitle: "Label above chat",
  t3ProjectName: "home",
  workspace: "~/home",
  prompt: "Why does the watcher put work under home?",
  reply: "It used the T3 folder; now it works out the real project.",
  ...overrides,
});

function board(): TaskBoard {
  return addTask({ version: 1, items: [] }, null, {
    ...makeTask("T3 Code fork", "you", NOW),
    id: "p1",
  });
}

const entry = (overrides: Partial<QuestionEntry> = {}): QuestionEntry => ({
  at: NOW,
  environmentId: "env-1",
  threadId: "thread-a",
  threadTitle: "Label above chat",
  project: "T3 Code fork",
  kind: "question",
  question: "Why home?",
  answer: "It used the T3 folder.",
  ...overrides,
});

describe("answers", () => {
  it("reads answers stored as strings, lists or objects", () => {
    expect(answerText("Use the board project")).toBe("Use the board project");
    expect(answerText(["A", "B"])).toBe("A, B");
    expect(answerText({ answers: ["Leave it as is"] })).toBe("Leave it as is");
    expect(answerText({ label: "Dev app" })).toBe("Dev app");
  });

  it("pairs each answered question with its text and skips empty answers", () => {
    expect(
      decisionsFromAnswer({
        answers: { q1: "Use T3 Code (Dev) for now", q2: "" },
        questionTextById: { q1: "Which app?" },
      }),
    ).toEqual([{ question: "Which app?", answer: "Use T3 Code (Dev) for now" }]);
  });

  it("shows decisions to the watcher under their turn", () => {
    const prompt = buildWatcherPrompt(board(), [
      turn({ decisions: [{ question: "Which app?", answer: "Dev" }] }),
    ]);
    expect(prompt).toContain("  Decided: Which app? → Dev");
  });
});

describe("parseWatcherLog", () => {
  it("ties entries to their chat and matches the board's project spelling", () => {
    const reply = `{"ops":[],"log":[{"turn":1,"project":"t3 code FORK","kind":"question","q":"Why home?","a":"It used the T3 folder."},{"turn":1,"project":"ThaiLookup","kind":"decision","q":"Use phrase pages","a":"Next SEO build."},{"turn":2,"q":"no such turn"},{"turn":1,"kind":"odd","q":"Ship it"}]}`;
    const entries = parseWatcherLog(reply, [turn()], board(), NOW);
    expect(entries.map((item) => [item.project, item.kind, item.question])).toEqual([
      ["T3 Code fork", "question", "Why home?"],
      ["ThaiLookup", "decision", "Use phrase pages"],
      ["Other", "request", "Ship it"],
    ]);
    expect(entries[0]).toMatchObject({ threadId: "thread-a", threadTitle: "Label above chat" });
    expect(parseWatcherLog('{"ops":[]}', [turn()], board(), NOW)).toEqual([]);
    expect(parseWatcherLog(null, [turn()], board(), NOW)).toEqual([]);
  });
});

describe("log file", () => {
  it("round-trips, newest first, skipping broken lines", () => {
    const older = entry({ at: "2026-11-21T10:00:00.000Z", question: "Older" });
    const text = `${serializeQuestionEntries([older, entry()])}\nnot json\n{"at":"x"}`;
    expect(parseQuestionLog(text).map((item) => item.question)).toEqual(["Why home?", "Older"]);
    expect(parseQuestionLog(null)).toEqual([]);
  });
});

describe("grouping", () => {
  it("groups by project then chat, in newest-first order, and filters by kind and words", () => {
    const entries = [
      entry({
        at: "2026-11-22T12:00:00.000Z",
        project: "ThaiLookup",
        threadId: "b",
        threadTitle: "SEO",
      }),
      entry({ at: "2026-11-22T11:00:00.000Z", kind: "decision", question: "Use Dev app" }),
      entry(),
      entry({ at: "2026-11-22T09:00:00.000Z", project: "t3 code fork", threadId: "c" }),
    ];
    const groups = groupQuestions(entries);
    expect(groups.map((group) => [group.project, group.count, group.threads.length])).toEqual([
      ["ThaiLookup", 1, 1],
      ["T3 Code fork", 3, 2],
    ]);
    expect(groups[1]!.threads[0]!.entries.map((item) => item.question)).toEqual([
      "Use Dev app",
      "Why home?",
    ]);
    expect(filterQuestions(entries, "decision", "").map((item) => item.question)).toEqual([
      "Use Dev app",
    ]);
    expect(filterQuestions(entries, "all", "seo").map((item) => item.threadId)).toEqual(["b"]);
  });
});

describe("backfill", () => {
  it("pairs each typed prompt with the decisions and last reply after it", () => {
    const at = (iso: string) => ({ updatedAt: iso, completedAt: iso });
    const items = [
      {
        item: {
          id: "u1",
          ordinal: 1,
          type: "user_message",
          runId: null,
          text: "Old question",
          ...at("2026-11-22T05:00:00Z"),
        },
      },
      {
        item: {
          ordinal: 2,
          type: "assistant_message",
          text: "Old answer",
          ...at("2026-11-22T05:01:00Z"),
        },
      },
      {
        item: {
          id: "u2",
          ordinal: 3,
          type: "user_message",
          text: "Add a log",
          ...at("2026-11-22T09:00:00Z"),
        },
      },
      {
        item: {
          ordinal: 4,
          type: "user_input_request",
          questionAnswer: { answers: { a: "Last 4h" }, questionTextById: { a: "Backfill?" } },
          ...at("2026-11-22T09:05:00Z"),
        },
      },
      {
        item: {
          ordinal: 6,
          type: "assistant_message",
          text: "Done",
          ...at("2026-11-22T09:10:00Z"),
        },
      },
      {
        item: {
          ordinal: 5,
          type: "assistant_message",
          text: "Working",
          ...at("2026-11-22T09:06:00Z"),
        },
      },
      {
        item: {
          ordinal: 7,
          type: "user_message",
          text: "From a schedule",
          scheduledTaskId: "s",
          ...at("2026-11-22T09:20:00Z"),
        },
      },
    ];
    expect(exchangesFromTranscript(items, Date.parse("2026-11-22T08:00:00Z"))).toEqual([
      {
        id: "u2",
        prompt: "Add a log",
        decisions: [{ question: "Backfill?", answer: "Last 4h" }],
        reply: "Done",
        endedAt: Date.parse("2026-11-22T09:20:00Z"),
      },
    ]);
    expect(exchangesFromTranscript(items).map((exchange) => exchange.reply)).toEqual([
      "Old answer",
      "Done",
    ]);
    expect(timeMs({ epochMilliseconds: 5 })).toBe(5);
    expect(timeMs({ epochMillis: 6 })).toBe(6);
  });
});

describe("time filters", () => {
  it("keeps entries inside today, the last days or a picked day range", () => {
    const now = new Date(2026, 10, 22, 15, 0).getTime();
    const local = (day: number, hour: number) => new Date(2026, 10, day, hour).toISOString();
    const entries = [
      entry({ at: local(22, 1), question: "today" }),
      entry({ at: local(20, 12), question: "two days ago" }),
      entry({ at: local(14, 12), question: "last week" }),
    ];
    const pick = (window: ReturnType<typeof periodWindow>) =>
      filterQuestions(entries, "all", "", window).map((item) => item.question);
    expect(pick(periodWindow("today", now))).toEqual(["today"]);
    expect(pick(periodWindow("3d", now))).toEqual(["today", "two days ago"]);
    expect(pick(periodWindow("all", now))).toHaveLength(3);
    expect(pick(dayRangeWindow(new Date(2026, 10, 20)))).toEqual(["two days ago"]);
    expect(pick(dayRangeWindow(new Date(2026, 10, 22), new Date(2026, 10, 14)))).toHaveLength(3);
  });
});
