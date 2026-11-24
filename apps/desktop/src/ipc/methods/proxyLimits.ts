// @effect-diagnostics globalDate:off -- The proxy's times arrive as unix seconds and go out as ISO text.
// @effect-diagnostics globalFetch:off -- One read-only GET to the proxy on localhost.
// @effect-diagnostics nodeBuiltinImport:off -- Reads the proxy app's own settings file for its port and management key.

import * as NodeFS from "node:fs";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { PROXY_LIMITS_READ_CHANNEL } from "../channels.ts";

/**
 * Fork: the Tasks page's Limits view. EasyCLIProxyAPI (the local Claude proxy) keeps each
 * account's `anthropic-ratelimit-unified-*` headers from its real traffic, and its management API
 * lists them. Reading that costs no quota and calls nothing outside this machine. The management
 * key is read here, from the proxy app's settings, and never leaves the main process.
 */
const REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_PORT = 8317;

const LimitWindow = Schema.Struct({
  /** 0–100. */
  pct: Schema.Number,
  resetsAt: Schema.NullOr(Schema.String),
  status: Schema.NullOr(Schema.String),
});

const LimitsAccount = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  status: Schema.String,
  disabled: Schema.Boolean,
  unavailable: Schema.Boolean,
  cooldownUntil: Schema.NullOr(Schema.String),
  observedAt: Schema.NullOr(Schema.String),
  fiveHour: Schema.NullOr(LimitWindow),
  sevenDay: Schema.NullOr(LimitWindow),
  overage: Schema.NullOr(Schema.String),
  bindingClaim: Schema.NullOr(Schema.String),
});
type LimitsAccount = typeof LimitsAccount.Type;

const LimitsSnapshot = Schema.Struct({
  fetchedAt: Schema.String,
  error: Schema.NullOr(Schema.Literals(["no_key", "proxy_down", "unauthorized", "bad_reply"])),
  accounts: Schema.Array(LimitsAccount),
});
type LimitsSnapshot = typeof LimitsSnapshot.Type;

/** The port and management key from EasyCLIProxyAPI's `config.toml` (flat `key = value` lines). */
export function readProxySettings(text: string): { port: number; key: string | null } {
  const value = (name: string) => {
    const match = new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`, "m").exec(text);
    if (!match) return null;
    const raw = match[1]!;
    const quoted = /^"(.*)"$/.exec(raw) ?? /^'(.*)'$/.exec(raw);
    return quoted ? quoted[1]! : raw;
  };
  const port = Number(value("port"));
  const key = value("management-secret-key");
  return {
    port: Number.isInteger(port) && port > 0 && port < 65_536 ? port : DEFAULT_PORT,
    key: key ? key : null,
  };
}

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;

/** Unix seconds (as the headers send them) or an ISO date, as ISO. */
const isoTime = (value: unknown): string | null => {
  const text = str(value) ?? (typeof value === "number" ? String(value) : null);
  if (!text) return null;
  const seconds = Number(text);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(text);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

/** The quota headers with lowercase names; the proxy keeps them as Anthropic sent them. */
function signalsOf(quota: unknown): Map<string, string> {
  const signals = (quota as { signals?: unknown } | null)?.signals;
  const result = new Map<string, string>();
  if (typeof signals !== "object" || signals === null) return result;
  for (const [name, value] of Object.entries(signals)) {
    if (typeof value === "string") result.set(name.toLowerCase(), value);
    else if (typeof value === "number") result.set(name.toLowerCase(), String(value));
  }
  return result;
}

function windowOf(signals: Map<string, string>, window: "5h" | "7d") {
  const prefix = `anthropic-ratelimit-unified-${window}-`;
  const utilization = Number(signals.get(`${prefix}utilization`));
  if (!signals.has(`${prefix}utilization`) || !Number.isFinite(utilization)) return null;
  return {
    pct: Math.max(0, Math.round(utilization * 1000) / 10),
    resetsAt: isoTime(signals.get(`${prefix}reset`)),
    status: signals.get(`${prefix}status`) ?? null,
  };
}

/** The Claude accounts in a `/v0/management/auth-files` reply. Missing fields read as unknown. */
export function parseAuthFiles(value: unknown): LimitsAccount[] {
  const files = (value as { files?: unknown } | null)?.files;
  if (!Array.isArray(files)) return [];
  return files.flatMap((raw): LimitsAccount[] => {
    if (typeof raw !== "object" || raw === null) return [];
    const file = raw as Record<string, unknown>;
    if (str(file.provider)?.toLowerCase() !== "claude") return [];
    const quota = file.quota as { observed_at?: unknown } | undefined;
    const signals = signalsOf(quota);
    const cooldowns = Array.isArray(file.cooldowns) ? file.cooldowns : [];
    const cooldownUntil =
      isoTime(file.next_retry_after) ??
      cooldowns
        .map((entry) =>
          isoTime(
            (entry as { until?: unknown; retry_after?: unknown } | null)?.until ??
              (entry as { retry_after?: unknown } | null)?.retry_after,
          ),
        )
        .find((time) => time !== null) ??
      null;
    return [
      {
        id: str(file.auth_index) ?? str(file.id) ?? str(file.email) ?? "account",
        label: str(file.email) ?? str(file.label) ?? str(file.name) ?? "Claude account",
        status: str(file.status) ?? "unknown",
        disabled: file.disabled === true,
        unavailable: file.unavailable === true,
        cooldownUntil,
        observedAt: isoTime(quota?.observed_at),
        fiveHour: windowOf(signals, "5h"),
        sevenDay: windowOf(signals, "7d"),
        overage: signals.get("anthropic-ratelimit-unified-overage-status") ?? null,
        bindingClaim: signals.get("anthropic-ratelimit-unified-representative-claim") ?? null,
      },
    ];
  });
}

export const installProxyLimits = Effect.fn("desktop.ipc.installProxyLimits")(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const ipc = yield* DesktopIpc.DesktopIpc;
  const settingsFile = environment.path.join(
    environment.homeDirectory,
    "Library",
    "Application Support",
    "com.cpa.gui",
    "config.toml",
  );

  const read = async (): Promise<LimitsSnapshot> => {
    const snapshot = (
      error: LimitsSnapshot["error"],
      accounts: LimitsSnapshot["accounts"] = [],
    ): LimitsSnapshot => ({ fetchedAt: new Date().toISOString(), error, accounts });
    let settings: { port: number; key: string | null };
    try {
      // Read every time: the proxy app can change its key or port.
      settings = readProxySettings(NodeFS.readFileSync(settingsFile, "utf8"));
    } catch {
      return snapshot("no_key");
    }
    if (!settings.key) return snapshot("no_key");
    let response: Response;
    try {
      response = await fetch(`http://127.0.0.1:${settings.port}/v0/management/auth-files`, {
        headers: { Authorization: `Bearer ${settings.key}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return snapshot("proxy_down");
    }
    if (response.status === 401 || response.status === 403) return snapshot("unauthorized");
    if (!response.ok) return snapshot("bad_reply");
    try {
      return snapshot(null, parseAuthFiles(await response.json()));
    } catch {
      return snapshot("bad_reply");
    }
  };

  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: PROXY_LIMITS_READ_CHANNEL,
      payload: Schema.Void,
      result: LimitsSnapshot,
      handler: () => Effect.promise(read),
    }),
  );
});
