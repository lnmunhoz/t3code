import { describe, expect, it } from "vite-plus/test";

import {
  formatTokens,
  formatUsd,
  parseTaskUsage,
  serializeTaskUsage,
  summarizeTaskUsage,
  type TaskUsageRecord,
} from "./taskUsage.logic";

const record = (overrides: Partial<TaskUsageRecord> = {}): TaskUsageRecord => ({
  at: "2026-11-22T10:00:00.000Z",
  model: "claude-haiku-5-5",
  ok: true,
  turns: 1,
  chats: ["Music bars"],
  changes: 1,
  inputTokens: 1_000,
  outputTokens: 200,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0.0012,
  durationMs: 2_000,
  ...overrides,
});

describe("task usage log", () => {
  it("reads its own lines newest first and skips broken ones", () => {
    const older = record({ at: "2026-11-21T10:00:00.000Z" });
    const newer = record();
    const text = [serializeTaskUsage(older), "{oops", "", serializeTaskUsage(newer)].join("\n");
    expect(parseTaskUsage(text)).toEqual([newer, older]);
    expect(parseTaskUsage(null)).toEqual([]);
  });

  it("totals today, the last week and all time, counting cached input", () => {
    const now = new Date("2026-11-22T12:00:00");
    const records = [
      record({ at: new Date("2026-11-22T09:00:00").toISOString(), cacheReadTokens: 500 }),
      record({ at: new Date("2026-11-20T09:00:00").toISOString(), ok: false, costUsd: 0 }),
      record({ at: new Date("2026-10-01T09:00:00").toISOString(), costUsd: 0.5 }),
    ];
    const summary = summarizeTaskUsage(records, now);
    expect(summary.today).toEqual({
      calls: 1,
      failed: 0,
      inputTokens: 1_500,
      outputTokens: 200,
      costUsd: 0.0012,
    });
    expect(summary.week.calls).toBe(2);
    expect(summary.week.failed).toBe(1);
    expect(summary.all.calls).toBe(3);
    expect(summary.all.costUsd).toBeCloseTo(0.5024);
  });

  it("formats small costs and token counts", () => {
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(0.00153)).toBe("$0.0015");
    expect(formatUsd(0.0421)).toBe("$0.042");
    expect(formatUsd(3.456)).toBe("$3.46");
    expect(formatTokens(840)).toBe("840");
    expect(formatTokens(1_250)).toBe("1.3k");
    expect(formatTokens(48_000)).toBe("48k");
    expect(formatTokens(1_200_000)).toBe("1.2M");
  });
});
