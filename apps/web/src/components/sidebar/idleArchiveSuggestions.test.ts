import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture, type ThreadFixtureOverrides } from "../../test-fixtures";
import { keepIdleThreads, resolveIdleArchiveCandidates } from "./idleArchiveSuggestions";

const environmentId = EnvironmentId.make("environment-1");
const NOW = Date.parse("2026-11-11T12:00:00.000Z");
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

function makeThread(id: string, overrides: ThreadFixtureOverrides = {}) {
  return makeThreadFixture({
    id: ThreadId.make(id),
    environmentId,
    runtime: null,
    createdAt: hoursAgo(48),
    ...overrides,
  });
}

function completedRun(completedHoursAgo: number) {
  return {
    runId: RunId.make("run-1"),
    status: "completed" as const,
    requestedAt: hoursAgo(completedHoursAgo + 1),
    startedAt: hoursAgo(completedHoursAgo + 1),
    completedAt: hoursAgo(completedHoursAgo),
    assistantMessageId: null,
  };
}

function keyOf(id: string) {
  return scopedThreadKey(scopeThreadRef(environmentId, ThreadId.make(id)));
}

function candidateIds(
  threads: ReturnType<typeof makeThread>[],
  options: { kept?: Record<string, string>; excludedKeys?: ReadonlySet<string> } = {},
) {
  return resolveIdleArchiveCandidates({
    threads,
    idleHours: 12,
    nowMs: NOW,
    kept: options.kept ?? {},
    excludedKeys: options.excludedKeys ?? new Set(),
  }).map((candidate) => candidate.thread.id);
}

describe("resolveIdleArchiveCandidates", () => {
  it("suggests threads idle past the threshold, most idle first", () => {
    expect(
      candidateIds([
        makeThread("recent-run", { latestRun: completedRun(2) }),
        makeThread("old-run", { latestRun: completedRun(20) }),
        makeThread("recent-message", {
          latestRun: completedRun(30),
          latestUserMessageAt: hoursAgo(3),
        }),
        makeThread("empty-old", { createdAt: hoursAgo(72) }),
        makeThread("empty-new", { createdAt: hoursAgo(1) }),
      ]),
    ).toEqual(["empty-old", "old-run"]);
  });

  it("leaves out threads that are kept, busy, or waiting on the user", () => {
    const runningRuntime = {
      status: "running" as const,
      activeRunId: RunId.make("run-1"),
      providerInstanceId: ProviderInstanceId.make("codex"),
      providerName: null,
      lastError: null,
      updatedAt: hoursAgo(20),
    };
    expect(
      candidateIds(
        [
          makeThread("pinned", { pinnedAt: hoursAgo(30) }),
          makeThread("snoozed", { snoozedUntil: hoursAgo(-5), snoozedAt: hoursAgo(20) }),
          makeThread("auto-settle-off", { autoSettleDisabledAt: hoursAgo(30) }),
          makeThread("running", { runtime: runningRuntime }),
          makeThread("needs-input", { hasPendingUserInput: true }),
          makeThread("asks-question", { asksUserQuestion: true }),
          makeThread("archived", { archivedAt: hoursAgo(20) }),
          makeThread("open-now"),
          makeThread("settled", { settledOverride: "settled", settledAt: hoursAgo(20) }),
        ],
        { excludedKeys: new Set([keyOf("open-now")]) },
      ),
    ).toEqual(["settled"]);
  });

  it("restarts the idle clock when a snooze wakes or the thread is un-settled", () => {
    expect(
      candidateIds([
        makeThread("woke", { snoozedUntil: hoursAgo(2), snoozedAt: hoursAgo(30) }),
        makeThread("unsettled", { unsettledAt: hoursAgo(4) }),
      ]),
    ).toEqual([]);
  });

  it("hides a kept thread until it goes idle again after new activity", () => {
    const kept = keepIdleThreads({}, [keyOf("thread")], hoursAgo(1), new Set());
    expect(candidateIds([makeThread("thread", { latestRun: completedRun(20) })], { kept })).toEqual(
      [],
    );
    expect(candidateIds([makeThread("thread", { latestRun: completedRun(13) })], { kept })).toEqual(
      [],
    );
    const keptLongAgo = keepIdleThreads({}, [keyOf("thread")], hoursAgo(15), new Set());
    expect(
      candidateIds([makeThread("thread", { latestRun: completedRun(13) })], { kept: keptLongAgo }),
    ).toEqual(["thread"]);
  });
});

describe("keepIdleThreads", () => {
  it("drops entries for threads that no longer exist", () => {
    expect(
      keepIdleThreads(
        { gone: hoursAgo(5), live: hoursAgo(5) },
        ["new"],
        hoursAgo(0),
        new Set(["live"]),
      ),
    ).toEqual({ live: hoursAgo(5), new: hoursAgo(0) });
  });
});
