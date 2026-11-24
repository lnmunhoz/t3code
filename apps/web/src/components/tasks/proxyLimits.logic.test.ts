import type { DesktopProxyLimitsAccount } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  accountState,
  combinedWindow,
  planWeights,
  formatAgo,
  formatTimeLeft,
  isStale,
  limitTone,
  tightestPct,
} from "./proxyLimits.logic";

const NOW = Date.parse("2026-11-22T10:00:00Z");
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

const account = (patch: Partial<DesktopProxyLimitsAccount> = {}): DesktopProxyLimitsAccount => ({
  id: "1",
  label: "a@example.com",
  status: "active",
  disabled: false,
  unavailable: false,
  cooldownUntil: null,
  observedAt: at(-5),
  fiveHour: { pct: 16, resetsAt: at(120), status: "allowed" },
  sevenDay: { pct: 42, resetsAt: at(3 * 1440), status: "allowed" },
  overage: null,
  bindingClaim: "five_hour",
  ...patch,
});

describe("proxy limits", () => {
  it("colours use by how close it is to the limit", () => {
    expect(limitTone(10)).toBe("ok");
    expect(limitTone(70)).toBe("warn");
    expect(limitTone(95)).toBe("high");
  });

  it("says how long until a reset", () => {
    expect(formatTimeLeft(at(134), NOW)).toBe("2h 14m");
    expect(formatTimeLeft(at(3 * 1440 + 240), NOW)).toBe("3d 4h");
    expect(formatTimeLeft(at(12), NOW)).toBe("12m");
    expect(formatTimeLeft(at(-1), NOW)).toBeNull();
    expect(formatTimeLeft(null, NOW)).toBeNull();
  });

  it("says how old the data is", () => {
    expect(formatAgo(at(0), NOW)).toBe("just now");
    expect(formatAgo(at(-4), NOW)).toBe("4m ago");
    expect(formatAgo(at(-180), NOW)).toBe("3h ago");
  });

  it("greys out data from before the account's last half hour", () => {
    expect(isStale(account(), NOW)).toBe(false);
    expect(isStale(account({ observedAt: at(-45) }), NOW)).toBe(true);
    expect(isStale(account({ observedAt: null }), NOW)).toBe(true);
  });

  it("puts the worst state first", () => {
    expect(accountState(account(), NOW)).toBe("ok");
    expect(accountState(account({ disabled: true, cooldownUntil: at(10) }), NOW)).toBe("disabled");
    expect(accountState(account({ cooldownUntil: at(10) }), NOW)).toBe("cooldown");
    expect(accountState(account({ cooldownUntil: at(-10) }), NOW)).toBe("ok");
    expect(
      accountState(account({ fiveHour: { pct: 100, resetsAt: at(30), status: "rejected" } }), NOW),
    ).toBe("limited");
    // The window has reset since.
    expect(
      accountState(account({ fiveHour: { pct: 100, resetsAt: at(-30), status: "rejected" } }), NOW),
    ).toBe("ok");
    expect(accountState(account({ unavailable: true }), NOW)).toBe("unavailable");
  });

  it("takes the fuller window, and copes with a missing one", () => {
    expect(tightestPct(account())).toBe(42);
    expect(tightestPct(account({ fiveHour: null }))).toBe(42);
    expect(tightestPct(account({ fiveHour: null, sevenDay: null }))).toBeNull();
  });

  it("adds the accounts up as one", () => {
    const accounts = [
      account({ fiveHour: { pct: 20, resetsAt: at(120), status: "allowed" } }),
      account({ id: "2", fiveHour: { pct: 40, resetsAt: at(60), status: "allowed" } }),
      // No 5-hour data: not counted there.
      account({ id: "3", fiveHour: null }),
      // Off: not counted at all.
      account({ id: "4", disabled: true }),
      // Reset since the proxy looked: counts as empty.
      account({ id: "5", fiveHour: { pct: 90, resetsAt: at(-5), status: "allowed" } }),
    ];
    expect(combinedWindow(accounts, "fiveHour", NOW)).toEqual({
      pct: 20,
      counted: 3,
      nextResetAt: at(60),
    });
    expect(combinedWindow(accounts, "sevenDay", NOW)?.counted).toBe(4);
    expect(combinedWindow([account({ fiveHour: null })], "fiveHour", NOW)).toBeNull();
  });

  it("weighs each account by its plan", () => {
    const accounts = [
      account({ id: "a", label: "a@x", fiveHour: { pct: 50, resetsAt: at(60), status: null } }),
      account({ id: "b", label: "b@x", fiveHour: { pct: 0, resetsAt: at(60), status: null } }),
      account({ id: "c", label: "c@x", fiveHour: { pct: 0, resetsAt: at(60), status: null } }),
    ];
    // A Max half used, beside a Pro and an account with no plan set (counted as the average).
    const weights = planWeights(accounts, { "a@x": "max", "b@x": "pro" }, "fiveHour");
    expect(weights.get("c")).toBe(3);
    expect(combinedWindow(accounts, "fiveHour", NOW, weights)?.pct).toBeCloseTo((50 * 5) / 9);
    // No plans set: all the same size.
    expect(planWeights(accounts, {}, "fiveHour").get("a")).toBe(1);
  });

  it("leaves Ultra out of the 5-hour pool, which it doesn't have", () => {
    const accounts = [
      account({ id: "a", label: "a@x", fiveHour: { pct: 40, resetsAt: at(60), status: null } }),
      account({ id: "u", label: "u@x", fiveHour: { pct: 90, resetsAt: at(60), status: null } }),
    ];
    const plans = { "a@x": "pro", "u@x": "ultra" } as const;
    const fiveHour = combinedWindow(
      accounts,
      "fiveHour",
      NOW,
      planWeights(accounts, plans, "fiveHour"),
    );
    expect(fiveHour).toMatchObject({ pct: 40, counted: 1 });
    // Weekly: Ultra is 10x Pro. Both at 42% in the fixture.
    expect(planWeights(accounts, plans, "sevenDay").get("u")).toBe(10);
  });
});
