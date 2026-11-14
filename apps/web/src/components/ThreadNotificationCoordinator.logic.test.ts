import { describe, expect, it, vi } from "vite-plus/test";

import {
  createThreadNotificationGate,
  RELEASED_COMPLETION_GRACE_MS,
  type ThreadNotificationObservation,
} from "./ThreadNotificationCoordinator.logic";

const working: ThreadNotificationObservation = {
  attention: null,
  requestId: null,
  settled: false,
  completedAt: null,
  backgroundWake: false,
};
const completed = (at: number): ThreadNotificationObservation => ({
  attention: null,
  requestId: null,
  settled: true,
  completedAt: at,
  backgroundWake: false,
});
const waking: ThreadNotificationObservation = { ...working, backgroundWake: true };
const woke = (at: number): ThreadNotificationObservation => ({
  ...completed(at),
  backgroundWake: true,
});
const visible = { archived: false, quiet: false };

function fakeTimers(): Disposable {
  vi.useFakeTimers();
  return { [Symbol.dispose]: () => void vi.useRealTimers() };
}

function harness() {
  const notify = vi.fn();
  const timers: Array<() => void> = [];
  const gate = createThreadNotificationGate<string>(notify, (run) => {
    timers.push(run);
    return () => timers.splice(timers.indexOf(run) >>> 0, 1);
  });
  let prior: ThreadNotificationObservation | undefined;
  const observe = (next: ThreadNotificationObservation, options = visible) => {
    gate.observe("thread", prior, next, options);
    prior = next;
  };
  const elapse = () => timers.splice(0).forEach((run) => run());
  return { gate, notify, observe, elapse, timers };
}

describe("createThreadNotificationGate", () => {
  it("notifies a completion immediately and only once", () => {
    const { notify, observe } = harness();
    observe(working);
    observe(completed(1));
    expect(notify.mock.calls).toEqual([["thread", "completion"]]);
    observe({ ...completed(1) });
    observe(working);
    observe(completed(1));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("notifies each newer completion immediately", () => {
    const { notify, observe } = harness();
    observe(working);
    observe(completed(1));
    observe(working);
    observe(completed(2));
    expect(notify.mock.calls).toEqual([
      ["thread", "completion"],
      ["thread", "completion"],
    ]);
    observe(completed(1));
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("notifies each attention once per stretch and still notifies the subsequent completion", () => {
    const { notify, observe } = harness();
    observe(working);
    const attention = { ...working, attention: "run-1:approval:a", requestId: "a" };
    observe(attention);
    expect(notify.mock.calls).toEqual([["thread", "input"]]);
    observe({ ...attention });
    expect(notify).toHaveBeenCalledTimes(1);
    observe({ ...attention, attention: "run-1:approval:b", requestId: "b" });
    observe(attention);
    expect(notify).toHaveBeenCalledTimes(2);
    observe(working);
    observe(attention);
    expect(notify).toHaveBeenCalledTimes(3);
    const subagent = { ...attention, attention: "run-1:approval:", requestId: null };
    observe(subagent);
    observe(attention);
    observe(subagent);
    expect(notify).toHaveBeenCalledTimes(5);
    observe(working);
    observe(completed(1));
    expect(notify.mock.calls).toEqual([
      ["thread", "input"],
      ["thread", "input"],
      ["thread", "input"],
      ["thread", "input"],
      ["thread", "input"],
      ["thread", "completion"],
    ]);
  });

  it("does not replay a completion after attention resolves", () => {
    const { notify, observe } = harness();
    observe(working);
    observe(completed(1));
    observe({ ...working, attention: "run-1:limited" });
    observe(completed(1));
    expect(notify.mock.calls).toEqual([
      ["thread", "completion"],
      ["thread", "input"],
    ]);
  });

  it("announces only the question when a completed reply turns out to ask the user", () => {
    const { notify, observe, elapse } = harness();
    observe(working);
    observe({ ...completed(1), runCompletedAt: 1, awaitingReplyCheck: true });
    expect(notify).not.toHaveBeenCalled();
    observe({ ...working, attention: "run-1:input", runCompletedAt: 1 });
    elapse();
    observe(completed(1));
    expect(notify.mock.calls).toEqual([["thread", "input"]]);
  });

  it("announces a held completion once the reply check finds no question", () => {
    const { notify, observe, timers } = harness();
    observe(working);
    observe({ ...completed(1), runCompletedAt: 1, awaitingReplyCheck: true });
    observe({ ...completed(1), runCompletedAt: 1, awaitingReplyCheck: true });
    expect(notify).not.toHaveBeenCalled();
    observe({ ...completed(1), runCompletedAt: 1 });
    expect(notify.mock.calls).toEqual([["thread", "completion"]]);
    expect(timers).toHaveLength(0);
  });

  it("announces a held completion after the wait when no reply check arrives", () => {
    const { notify, observe, elapse } = harness();
    observe(working);
    observe({ ...completed(1), runCompletedAt: 1, awaitingReplyCheck: true });
    elapse();
    observe({ ...completed(1), runCompletedAt: 1 });
    expect(notify.mock.calls).toEqual([["thread", "completion"]]);
  });

  it("never notifies existing, archived or stopped completions, including when unarchived", () => {
    const { notify, observe } = harness();
    observe(completed(1));
    observe(working);
    observe(completed(2), { ...visible, quiet: true });
    observe(completed(2));
    observe(working);
    observe(completed(3), { ...visible, archived: true });
    observe(completed(3));
    expect(notify).not.toHaveBeenCalled();
    observe(working);
    observe(completed(4));
    expect(notify.mock.calls).toEqual([["thread", "completion"]]);
  });

  it("forgets handled completions when a thread is removed or the gate is cleared", () => {
    for (const reset of [
      (gate: ReturnType<typeof createThreadNotificationGate<string>>) => gate.retain(new Set()),
      (gate: ReturnType<typeof createThreadNotificationGate<string>>) => gate.clear(),
    ]) {
      const { gate, notify, observe } = harness();
      observe(completed(1));
      reset(gate);
      gate.observe("thread", undefined, working, visible);
      gate.observe("thread", working, completed(1), visible);
      expect(notify.mock.calls).toEqual([["thread", "completion"]]);
    }
  });

  it("waits out the grace before notifying a wake's completion, and a final wake replaces it", () => {
    using _timers = fakeTimers();
    const { notify, observe } = harness();
    observe(working);
    observe(completed(1));
    // Held until the monitor left, or completing after it already had: either way unheld here.
    observe(waking);
    observe(woke(2));
    expect(notify).toHaveBeenCalledTimes(1);
    observe(working);
    vi.advanceTimersByTime(RELEASED_COMPLETION_GRACE_MS);
    expect(notify).toHaveBeenCalledTimes(1);
    observe(completed(3));
    vi.advanceTimersByTime(RELEASED_COMPLETION_GRACE_MS);
    expect(notify.mock.calls).toEqual([
      ["thread", "completion"],
      ["thread", "completion"],
    ]);
  });

  it("notifies a wake's completion once after the grace when no run follows, even across a pause", () => {
    using _timers = fakeTimers();
    const { gate, notify, observe } = harness();
    observe(waking);
    observe(woke(1));
    gate.pause();
    vi.advanceTimersByTime(RELEASED_COMPLETION_GRACE_MS);
    expect(notify).not.toHaveBeenCalled();
    observe({ ...woke(1) });
    vi.advanceTimersByTime(RELEASED_COMPLETION_GRACE_MS - 1);
    observe({ ...woke(1) });
    expect(notify).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(notify.mock.calls).toEqual([["thread", "completion"]]);
    observe({ ...woke(1) });
    vi.advanceTimersByTime(RELEASED_COMPLETION_GRACE_MS);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("waits out the grace when finished background work releases a held completion", () => {
    using _timers = fakeTimers();
    const { notify, observe } = harness();
    const held = (at: number) => ({ ...working, runCompletedAt: at });
    const released = (at: number) => ({ ...completed(at), runCompletedAt: at });
    observe(working);
    observe(held(1));
    observe(released(1));
    expect(notify).not.toHaveBeenCalled();
    // The wake for the finished work starts within the grace and owns the alert.
    observe({ ...working, fromNotification: true });
    vi.advanceTimersByTime(RELEASED_COMPLETION_GRACE_MS);
    observe({ ...completed(2), runCompletedAt: 2, fromNotification: true });
    expect(notify.mock.calls).toEqual([["thread", "completion"]]);
    // Without a wake, the held completion plays once after the grace.
    observe(working);
    observe(held(3));
    observe(released(3));
    expect(notify).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(RELEASED_COMPLETION_GRACE_MS);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("keeps wake completions quiet once the prompt played, until the next prompt", () => {
    const { notify, observe } = harness();
    const wake = { ...working, fromNotification: true };
    observe(working);
    observe(completed(1));
    observe(wake);
    observe({ ...completed(2), fromNotification: true });
    observe(wake);
    observe({ ...completed(3), fromNotification: true });
    expect(notify.mock.calls).toEqual([["thread", "completion"]]);
    observe({ ...wake, attention: "run-4:failed" });
    expect(notify.mock.calls).toEqual([
      ["thread", "completion"],
      ["thread", "input"],
    ]);
    observe(working);
    observe(completed(5));
    expect(notify).toHaveBeenCalledTimes(3);
  });

  it("drops a pending wake completion when the thread is removed or the gate is cleared", () => {
    using _timers = fakeTimers();
    for (const reset of [
      (gate: ReturnType<typeof createThreadNotificationGate<string>>) => gate.retain(new Set()),
      (gate: ReturnType<typeof createThreadNotificationGate<string>>) => gate.clear(),
    ]) {
      const { gate, notify, observe } = harness();
      observe(waking);
      observe(woke(1));
      reset(gate);
      vi.advanceTimersByTime(RELEASED_COMPLETION_GRACE_MS);
      expect(notify).not.toHaveBeenCalled();
    }
  });
});
