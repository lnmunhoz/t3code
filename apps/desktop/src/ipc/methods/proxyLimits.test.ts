import { describe, expect, it } from "vite-plus/test";

import { parseAuthFiles, readProxySettings } from "./proxyLimits.ts";

describe("readProxySettings", () => {
  it("reads the port and key from flat TOML", () => {
    expect(
      readProxySettings('host = "127.0.0.1"\nport = 8400\nmanagement-secret-key = "abc"\n'),
    ).toEqual({ port: 8400, key: "abc" });
  });

  it("falls back to the default port and no key", () => {
    expect(readProxySettings('allow-lan = false\nmanagement-secret-key = ""\n')).toEqual({
      port: 8317,
      key: null,
    });
  });
});

describe("parseAuthFiles", () => {
  const reply = {
    observed_at: "2026-11-22T10:00:00Z",
    files: [
      {
        auth_index: "0",
        provider: "claude",
        email: "a@example.com",
        status: "active",
        disabled: false,
        unavailable: false,
        cooldowns: [],
        quota: {
          observed_at: "2026-11-22T09:55:00Z",
          signals: {
            "Anthropic-Ratelimit-Unified-5h-Utilization": "0.16",
            "Anthropic-Ratelimit-Unified-5h-Reset": "1795000000",
            "Anthropic-Ratelimit-Unified-5h-Status": "allowed",
            "anthropic-ratelimit-unified-7d-utilization": "0.421",
            "anthropic-ratelimit-unified-7d-status": "allowed",
            "Anthropic-Ratelimit-Unified-Overage-Status": "rejected",
            "Anthropic-Ratelimit-Unified-Representative-Claim": "five_hour",
          },
        },
      },
      // No 5-hour data yet, and disabled.
      {
        auth_index: "1",
        provider: "claude",
        email: "b@example.com",
        disabled: true,
        next_retry_after: "2026-11-22T11:00:00Z",
        quota: { signals: { "Anthropic-Ratelimit-Unified-7d-Utilization": "0.05" } },
      },
      { auth_index: "2", provider: "gemini", email: "c@example.com" },
    ],
  };

  it("keeps Claude accounts and reads their windows whatever the header case", () => {
    const [first, second, ...rest] = parseAuthFiles(reply);
    expect(rest).toEqual([]);
    expect(first).toEqual({
      id: "0",
      label: "a@example.com",
      status: "active",
      disabled: false,
      unavailable: false,
      cooldownUntil: null,
      observedAt: "2026-11-22T09:55:00.000Z",
      fiveHour: { pct: 16, resetsAt: "2026-11-18T11:06:40.000Z", status: "allowed" },
      sevenDay: { pct: 42.1, resetsAt: null, status: "allowed" },
      overage: "rejected",
      bindingClaim: "five_hour",
    });
    expect(second).toMatchObject({
      label: "b@example.com",
      disabled: true,
      cooldownUntil: "2026-11-22T11:00:00.000Z",
      observedAt: null,
      fiveHour: null,
      sevenDay: { pct: 5 },
      status: "unknown",
    });
  });

  it("returns nothing for a reply it doesn't know", () => {
    expect(parseAuthFiles(null)).toEqual([]);
    expect(parseAuthFiles({ files: "x" })).toEqual([]);
  });
});
