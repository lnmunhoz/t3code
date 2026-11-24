import {
  OTHER_PROJECT,
  projectForThread,
  projectKey,
  type TaskBoard,
  type TurnDecision,
  type WatchedTurn,
} from "./taskBoard.logic";

export type { TurnDecision };

/**
 * The question log: every prompt the watcher sees, summarized with its answer, plus the decisions
 * made in a chat (answers to the agent's questions). Kept as JSON lines next to the board, so the
 * Tasks page can show what was asked and settled in each project and chat.
 */
export type QuestionKind = "question" | "decision" | "request";

const QUESTION_KINDS: ReadonlyArray<QuestionKind> = ["question", "decision", "request"];

export interface QuestionEntry {
  readonly at: string;
  readonly environmentId: string;
  readonly threadId: string;
  readonly threadTitle: string;
  /** The board project it belongs to (the real project, as on the task board). */
  readonly project: string;
  readonly kind: QuestionKind;
  /** What was asked, requested or decided, in the user's voice. */
  readonly question: string;
  /** The agent's answer or the outcome. */
  readonly answer: string;
}

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

/** A user-input answer as text, whatever shape the provider stored it in. */
export function answerText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(answerText).filter(Boolean).join(", ");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["answers", "answer", "label", "value", "text", "selected"]) {
      if (key in record) {
        const text = answerText(record[key]);
        if (text) return text;
      }
    }
    return Object.values(record).map(answerText).filter(Boolean).join(", ");
  }
  return "";
}

/** The decisions in an answered question card: each question's text with the answer given. */
export function decisionsFromAnswer(payload: {
  readonly answers: Readonly<Record<string, unknown>>;
  readonly questionTextById?: Readonly<Record<string, string>> | undefined;
}): TurnDecision[] {
  return Object.entries(payload.answers).flatMap(([id, value]) => {
    const answer = answerText(value);
    if (!answer) return [];
    return [{ question: payload.questionTextById?.[id] ?? id, answer }];
  });
}

function parseEntry(line: string): QuestionEntry | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const at = asString(raw.at);
  const question = asString(raw.question);
  if (!at || Number.isNaN(Date.parse(at)) || !question) return null;
  return {
    at,
    environmentId: asString(raw.environmentId) ?? "",
    threadId: asString(raw.threadId) ?? "",
    threadTitle: asString(raw.threadTitle) ?? "",
    project: asString(raw.project) ?? OTHER_PROJECT,
    kind: QUESTION_KINDS.includes(raw.kind as QuestionKind)
      ? (raw.kind as QuestionKind)
      : "request",
    question,
    answer: asString(raw.answer) ?? "",
  };
}

/** Newest first; broken lines are skipped. */
export function parseQuestionLog(text: string | null): QuestionEntry[] {
  if (!text) return [];
  const entries: QuestionEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const entry = parseEntry(line);
    if (entry) entries.push(entry);
  }
  return entries.toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export function serializeQuestionEntries(entries: ReadonlyArray<QuestionEntry>): string {
  return entries.map((entry) => JSON.stringify(entry)).join("\n");
}

/**
 * The log entries in the watcher's reply (`"log":[{turn, project, kind, q, a}]`), tied to their
 * chats. The project is matched to the board's own spelling, else the chat's board project.
 */
export function parseWatcherLog(
  reply: string | null,
  turns: ReadonlyArray<WatchedTurn>,
  board: TaskBoard,
  /** When the entries happened: one time for all, or per turn number (backfill). */
  at: string | ((turn: number) => string),
): QuestionEntry[] {
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
  const log = (value as { log?: unknown })?.log;
  if (!Array.isArray(log)) return [];
  return log.flatMap((raw): QuestionEntry[] => {
    if (typeof raw !== "object" || raw === null) return [];
    const item = raw as Record<string, unknown>;
    const turn = typeof item.turn === "number" ? turns[item.turn - 1] : undefined;
    const question = asString(item.q);
    if (!turn || !question) return [];
    const named = asString(item.project);
    const existing = named
      ? board.items.find((project) => projectKey(project.text) === projectKey(named))
      : undefined;
    const project =
      existing?.text ??
      named ??
      projectForThread(board, turn.environmentId, turn.threadId)?.text ??
      OTHER_PROJECT;
    return [
      {
        at: typeof at === "string" ? at : at(item.turn as number),
        environmentId: turn.environmentId,
        threadId: turn.threadId,
        threadTitle: turn.threadTitle,
        project: clip(project, 60),
        kind: QUESTION_KINDS.includes(item.kind as QuestionKind)
          ? (item.kind as QuestionKind)
          : "request",
        question: clip(question, 240),
        answer: clip(asString(item.a) ?? "", 400),
      },
    ];
  });
}

export interface QuestionThreadGroup {
  readonly environmentId: string;
  readonly threadId: string;
  readonly threadTitle: string;
  readonly entries: ReadonlyArray<QuestionEntry>;
}

export interface QuestionProjectGroup {
  readonly project: string;
  readonly count: number;
  readonly latestAt: string;
  readonly threads: ReadonlyArray<QuestionThreadGroup>;
}

/** A time window in ms: from inclusive, to exclusive. */
export interface TimeWindow {
  readonly from: number;
  readonly to: number;
}

export type QuestionPeriod = "today" | "3d" | "7d" | "all";

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** The window for a quick period: today since local midnight, or the last 3 or 7 days. */
export function periodWindow(period: QuestionPeriod, nowMs: number): TimeWindow | null {
  switch (period) {
    case "today":
      return { from: startOfLocalDay(nowMs), to: Number.POSITIVE_INFINITY };
    case "3d":
      return { from: nowMs - 3 * DAY_MS, to: Number.POSITIVE_INFINITY };
    case "7d":
      return { from: nowMs - 7 * DAY_MS, to: Number.POSITIVE_INFINITY };
    case "all":
      return null;
  }
}

/** The window for calendar days picked in local time, both days included. */
export function dayRangeWindow(from: Date, to: Date = from): TimeWindow {
  const start = startOfLocalDay(Math.min(from.getTime(), to.getTime()));
  const end = new Date(startOfLocalDay(Math.max(from.getTime(), to.getTime())));
  end.setDate(end.getDate() + 1);
  return { from: start, to: end.getTime() };
}

/** Entries matching the kind, search text (in the question, answer or chat title) and window. */
export function filterQuestions(
  entries: ReadonlyArray<QuestionEntry>,
  kind: QuestionKind | "all",
  search: string,
  window: TimeWindow | null = null,
): QuestionEntry[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    if (kind !== "all" && entry.kind !== kind) return false;
    if (window) {
      const at = Date.parse(entry.at);
      if (!(at >= window.from && at < window.to)) return false;
    }
    if (words.length === 0) return true;
    const haystack =
      `${entry.question} ${entry.answer} ${entry.threadTitle} ${entry.project}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/**
 * Entries (newest first) grouped by project, then chat. Projects and chats are ordered by their
 * newest entry; a chat's entries stay newest first.
 */
export function groupQuestions(entries: ReadonlyArray<QuestionEntry>): QuestionProjectGroup[] {
  const projects = new Map<
    string,
    { project: string; count: number; latestAt: string; threads: Map<string, QuestionEntry[]> }
  >();
  for (const entry of entries) {
    const key = projectKey(entry.project) || projectKey(OTHER_PROJECT);
    let group = projects.get(key);
    if (!group) {
      group = { project: entry.project, count: 0, latestAt: entry.at, threads: new Map() };
      projects.set(key, group);
    }
    group.count += 1;
    const threadKey = `${entry.environmentId}:${entry.threadId}`;
    const thread = group.threads.get(threadKey);
    if (thread) thread.push(entry);
    else group.threads.set(threadKey, [entry]);
  }
  return [...projects.values()].map((group) => ({
    project: group.project,
    count: group.count,
    latestAt: group.latestAt,
    threads: [...group.threads.values()].map((threadEntries) => ({
      environmentId: threadEntries[0]!.environmentId,
      threadId: threadEntries[0]!.threadId,
      threadTitle: threadEntries[0]!.threadTitle,
      entries: threadEntries,
    })),
  }));
}

// ── Backfill ────────────────────────────────────────────────────────────────

/** A transcript timestamp (an ISO string or an Effect DateTime) in ms, or NaN. */
export function timeMs(value: unknown): number {
  if (typeof value === "string") return Date.parse(value);
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === "object") {
    // Effect 4's DateTime keeps `epochMilliseconds`; older ones `epochMillis`.
    const record = value as { epochMilliseconds?: unknown; epochMillis?: unknown };
    const millis = record.epochMilliseconds ?? record.epochMillis;
    return typeof millis === "number" ? millis : Number.NaN;
  }
  return Number.NaN;
}

/** One prompt in a chat with what followed it, as the watcher sees it. */
export interface PastExchange {
  /** The prompt's transcript item id. */
  readonly id: string;
  readonly prompt: string;
  readonly decisions: ReadonlyArray<TurnDecision>;
  /** The agent's last message before the next prompt. */
  readonly reply: string;
  /** When the exchange's last item changed. */
  readonly endedAt: number;
}

/**
 * A chat's prompts, in order, each with the answers given to the agent's questions and the agent's
 * last message before the next prompt. Only prompts the user typed count (not ones sent by a
 * schedule or another chat); exchanges that ended before `sinceMs` are left out.
 */
export function exchangesFromTranscript(
  items: ReadonlyArray<{ readonly item: unknown }>,
  sinceMs = Number.NEGATIVE_INFINITY,
): PastExchange[] {
  const ordered = items
    .map((entry) => entry.item)
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .toSorted((a, b) => (Number(a.ordinal) || 0) - (Number(b.ordinal) || 0));
  const exchanges: Array<{
    id: string;
    prompt: string;
    decisions: TurnDecision[];
    reply: string;
    endedAt: number;
  }> = [];
  for (const item of ordered) {
    const at = timeMs(item.completedAt ?? item.updatedAt);
    if (item.type === "user_message") {
      const fromUser = !item.senderThreadId && !item.scheduledTaskId && !item.linkedSender;
      const text = typeof item.text === "string" ? item.text.trim() : "";
      if (fromUser && text) {
        exchanges.push({
          id: String(item.id ?? exchanges.length),
          prompt: text,
          decisions: [],
          reply: "",
          endedAt: at,
        });
        continue;
      }
    }
    const current = exchanges.at(-1);
    if (!current) continue;
    if (Number.isFinite(at) && !(at <= current.endedAt)) current.endedAt = at;
    if (item.type === "assistant_message") {
      if (typeof item.text === "string" && item.text.trim()) current.reply = item.text.trim();
    } else if (item.type === "user_input_request") {
      const answer = item.questionAnswer as Parameters<typeof decisionsFromAnswer>[0] | undefined;
      if (answer?.answers) current.decisions.push(...decisionsFromAnswer(answer));
    }
  }
  return exchanges.filter((exchange) => exchange.endedAt >= sinceMs);
}
