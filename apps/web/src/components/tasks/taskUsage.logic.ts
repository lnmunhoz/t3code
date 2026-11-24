/**
 * The watcher's call log: one record per Haiku call, kept as JSON lines next to the board, so the
 * Tasks page can show what the watcher costs.
 */
export interface TaskUsageRecord {
  readonly at: string;
  readonly model: string;
  readonly ok: boolean;
  /** Finished prompts the call looked at. */
  readonly turns: number;
  /** Titles of the chats those prompts came from. */
  readonly chats: ReadonlyArray<string>;
  /** Board changes the call made. */
  readonly changes: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly costUsd: number;
  readonly durationMs: number;
  readonly error?: string;
}

export interface TaskUsageTotals {
  readonly calls: number;
  readonly failed: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
}

export interface TaskUsageSummary {
  readonly today: TaskUsageTotals;
  readonly week: TaskUsageTotals;
  readonly all: TaskUsageTotals;
}

const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

function parseRecord(line: string): TaskUsageRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.at !== "string" || Number.isNaN(Date.parse(raw.at))) return null;
  return {
    at: raw.at,
    model: typeof raw.model === "string" ? raw.model : "",
    ok: raw.ok !== false,
    turns: num(raw.turns),
    chats: Array.isArray(raw.chats)
      ? raw.chats.filter((chat): chat is string => typeof chat === "string")
      : [],
    changes: num(raw.changes),
    inputTokens: num(raw.inputTokens),
    outputTokens: num(raw.outputTokens),
    cacheReadTokens: num(raw.cacheReadTokens),
    cacheWriteTokens: num(raw.cacheWriteTokens),
    costUsd: num(raw.costUsd),
    durationMs: num(raw.durationMs),
    ...(typeof raw.error === "string" && raw.error ? { error: raw.error } : {}),
  };
}

/** Newest first; broken lines are skipped. */
export function parseTaskUsage(text: string | null): TaskUsageRecord[] {
  if (!text) return [];
  const records: TaskUsageRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const record = parseRecord(line);
    if (record) records.push(record);
  }
  return records.toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export function serializeTaskUsage(record: TaskUsageRecord): string {
  return JSON.stringify(record);
}

/** Every input token the call was billed for, cached or not. */
export function totalInputTokens(record: TaskUsageRecord): number {
  return record.inputTokens + record.cacheReadTokens + record.cacheWriteTokens;
}

const EMPTY_TOTALS: TaskUsageTotals = {
  calls: 0,
  failed: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
};

function add(totals: TaskUsageTotals, record: TaskUsageRecord): TaskUsageTotals {
  return {
    calls: totals.calls + 1,
    failed: totals.failed + (record.ok ? 0 : 1),
    inputTokens: totals.inputTokens + totalInputTokens(record),
    outputTokens: totals.outputTokens + record.outputTokens,
    costUsd: totals.costUsd + record.costUsd,
  };
}

/** Totals for today (since local midnight), the last 7 days and all time. */
export function summarizeTaskUsage(
  records: ReadonlyArray<TaskUsageRecord>,
  now: Date = new Date(),
): TaskUsageSummary {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const todayStart = midnight.getTime();
  const weekStart = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  let today = EMPTY_TOTALS;
  let week = EMPTY_TOTALS;
  let all = EMPTY_TOTALS;
  for (const record of records) {
    const at = Date.parse(record.at);
    all = add(all, record);
    if (at >= weekStart) week = add(week, record);
    if (at >= todayStart) today = add(today, record);
  }
  return { today, week, all };
}

/** "$0.0012" for small amounts, "$1.24" from a dollar up. */
export function formatUsd(value: number): string {
  if (value === 0) return "$0";
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
}

/** "840", "12.4k", "1.2M". */
export function formatTokens(value: number): string {
  if (value < 1_000) return String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}
