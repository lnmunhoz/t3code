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

/**
 * The newest complete progress line in a tail of output: `null` when it clears progress,
 * `undefined` when the tail has none, so a burst of other output keeps the last one.
 */
export function latestBackgroundProgress(text: string): BackgroundProgressLine | null | undefined {
  // The segment after the last line break may still be mid-write.
  const lines = text.split(/\r\n|\r|\n/u).slice(0, -1);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line === undefined || !line.includes("::progress::")) continue;
    const progress = parseBackgroundProgressLine(line);
    if (progress === null) continue;
    return progress.done === undefined && progress.label === undefined ? null : progress;
  }
  return undefined;
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
