import { assert, describe, it } from "@effect/vitest";

import { latestBackgroundProgress, parseBackgroundProgressLine } from "./BackgroundProgress.ts";

describe("parseBackgroundProgressLine", () => {
  it("reads counts and a label, and ignores other lines", () => {
    const cases: ReadonlyArray<readonly [string, ReturnType<typeof parseBackgroundProgressLine>]> =
      [
        ["::progress:: 412/1484 Unit tests", { done: 412, total: 1484, label: "Unit tests" }],
        ["::progress::31 / 84 E2E", { done: 31, total: 84, label: "E2E" }],
        ["::progress:: 3/10", { done: 3, total: 10 }],
        ["::progress:: Building extension", { label: "Building extension" }],
        ["\u001b[2m::progress:: 5/9 Checks\u001b[0m", { done: 5, total: 9, label: "Checks" }],
        // A zero total has nothing to measure against; the label still shows.
        ["::progress:: 0/0 Starting", { label: "Starting" }],
        // Counts must stand alone, so a version number stays part of the label.
        ["::progress:: 1/2b retry", { label: "1/2b retry" }],
        ["::progress::", {}],
        ["ok 12 - renders ::progress:: inside a test name", null],
        ["progress: 4/5", null],
      ];
    for (const [line, expected] of cases) {
      assert.deepEqual(parseBackgroundProgressLine(line), expected, line);
    }
  });
});

describe("latestBackgroundProgress", () => {
  it("takes the newest complete line and keeps progress through other output", () => {
    assert.deepEqual(
      latestBackgroundProgress("::progress:: 1/4 Unit\nok 1\n::progress:: 2/4 Unit\nok 2\n"),
      { done: 2, total: 4, label: "Unit" },
    );
    // The last line may still be mid-write.
    assert.deepEqual(latestBackgroundProgress("::progress:: 2/4 Unit\n::progress:: 3/"), {
      done: 2,
      total: 4,
      label: "Unit",
    });
    assert.deepEqual(latestBackgroundProgress("::progress:: 7/9 E2E\r::progress:: 8/9 E2E\r"), {
      done: 8,
      total: 9,
      label: "E2E",
    });
    assert.isUndefined(latestBackgroundProgress("stack trace\n  at foo\n"));
    assert.isNull(latestBackgroundProgress("::progress:: 9/9 Unit\n::progress::\n"));
  });
});
