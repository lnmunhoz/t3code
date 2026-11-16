import type { OrchestrationV2BackgroundTaskProgress } from "@t3tools/contracts";

/**
 * A background command reports progress by printing its own line:
 * `::progress:: 412/1484 Unit tests`, `::progress:: Building`, or a bare `::progress::` to clear it.
 */
export type BackgroundProgressLine = Omit<OrchestrationV2BackgroundTaskProgress, "taskId">;

const PROGRESS_LINE = /^::progress::[ \t]*(?:(\d+)[ \t]*\/[ \t]*(\d+)(?![^ \t]))?[ \t]*(.*)$/u;
const TERMINAL_ESCAPES = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/gu;
const MAX_LABEL_CHARS = 80;

export function parseBackgroundProgressLine(line: string): BackgroundProgressLine | null {
  const match = PROGRESS_LINE.exec(line.replace(TERMINAL_ESCAPES, "").trim());
  if (match === null) return null;
  const [, rawDone, rawTotal, rawLabel] = match;
  const done = rawDone === undefined ? undefined : Number(rawDone);
  const total = rawTotal === undefined ? undefined : Number(rawTotal);
  const label = rawLabel?.trim().slice(0, MAX_LABEL_CHARS).trim();
  return {
    ...(done !== undefined && total !== undefined && total > 0 && Number.isSafeInteger(done)
      ? { done, total }
      : {}),
    ...(label ? { label } : {}),
  };
}

// Counts test runners print by default when their output is not a terminal. Vitest prints
// nothing until it finishes there, so it needs a `::progress::` reporter instead.
const PLAYWRIGHT_TOTAL = /^Running (\d+) tests? using \d+ workers?/u;
/** The list reporter: `  ✓  12 [chromium] › e2e/a.spec.ts:3:1 › title (1.2s)`. */
const PLAYWRIGHT_LIST_RESULT = /^\s+\S{1,2}\s+(\d+)\s+\[[^\]]*\]\s+›\s/u;
/** The line reporter: `[12/84] [chromium] › e2e/a.spec.ts:3:1 › title`. */
const PLAYWRIGHT_LINE_RESULT = /^\[(\d+)\/(\d+)\]\s+\[[^\]]*\]\s+›\s/u;
/** Node's test runner without a terminal numbers each top-level result, but learns its total last. */
const TAP_TOP_LEVEL_RESULT = /^(?:not )?ok (\d+) - /u;

function runnerProgress(
  line: string,
  playwrightTotal: number | undefined,
): BackgroundProgressLine | undefined {
  const lineResult = PLAYWRIGHT_LINE_RESULT.exec(line);
  if (lineResult !== null) {
    const total = Number(lineResult[2]);
    return total > 0
      ? { done: Math.min(Number(lineResult[1]), total), total, label: "Playwright" }
      : undefined;
  }
  const listResult = PLAYWRIGHT_LIST_RESULT.exec(line);
  if (listResult !== null) {
    const done = Number(listResult[1]);
    return playwrightTotal === undefined || playwrightTotal <= 0
      ? { label: `Playwright, ${done} done` }
      : { done: Math.min(done, playwrightTotal), total: playwrightTotal, label: "Playwright" };
  }
  const tapResult = TAP_TOP_LEVEL_RESULT.exec(line);
  return tapResult === null ? undefined : { label: `Tests, ${tapResult[1]} done` };
}

/**
 * Reads successive tails of one command's output. Returns its newest progress, `null` when the
 * command clears it, and `undefined` when the tail has none, so a burst of other output keeps
 * the last one. A command's own `::progress::` lines win over counts read from test runners.
 */
export function makeBackgroundProgressReader() {
  let reportsOwnProgress = false;
  let playwrightTotal: number | undefined;
  return (text: string): BackgroundProgressLine | null | undefined => {
    // The segment after the last line break may still be mid-write.
    const lines = text
      .split(/\r\n|\r|\n/u)
      .slice(0, -1)
      .map((line) => line.replace(TERMINAL_ESCAPES, ""));
    for (const line of lines) {
      if (line.includes("::progress::") && parseBackgroundProgressLine(line) !== null) {
        reportsOwnProgress = true;
      }
      const total = PLAYWRIGHT_TOTAL.exec(line);
      if (total !== null) playwrightTotal = Number(total[1]);
    }
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      if (line === undefined) continue;
      if (reportsOwnProgress) {
        const progress = line.includes("::progress::") ? parseBackgroundProgressLine(line) : null;
        if (progress === null) continue;
        return progress.done === undefined && progress.label === undefined ? null : progress;
      }
      const inferred = runnerProgress(line, playwrightTotal);
      if (inferred !== undefined) return inferred;
    }
    return undefined;
  };
}

const STDOUT_REDIRECT = /(?:^|[\s;&|(])(?:1|&)?>>?\|?[ \t]*("[^"]+"|'[^']+'|[^\s;&|<>()]+)/gu;
const TEE_TARGET = /(?:^|[\s;&|(])tee(?:[ \t]+-[A-Za-z]+)*[ \t]+("[^"]+"|'[^']+'|[^\s;&|<>()]+)/gu;

/**
 * Files a shell command sends its stdout to (`> log`, `>> log`, `&> log`, `| tee log`), so progress
 * still shows when an agent writes a background command's output to its own log. Targets that need
 * the shell to expand them (`$LOG`, `~/log`, a subshell) and devices are left out.
 */
export function backgroundCommandOutputFiles(command: string): ReadonlyArray<string> {
  const targets = [...command.matchAll(STDOUT_REDIRECT), ...command.matchAll(TEE_TARGET)]
    .map((match) => match[1]?.replace(/^(["'])(.*)\1$/u, "$2") ?? "")
    .filter(
      (target) =>
        target.length > 0 &&
        !/[$`]/u.test(target) &&
        !target.startsWith("~") &&
        !target.startsWith("/dev/"),
    );
  return [...new Set(targets)];
}

export function sameBackgroundProgress(
  left: BackgroundProgressLine | null,
  right: BackgroundProgressLine | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.done === right.done &&
      left.total === right.total &&
      left.label === right.label)
  );
}
