// @effect-diagnostics globalTimers:off -- The file watcher debounces from fs callbacks outside any Effect fiber.
// @effect-diagnostics nodeBuiltinImport:off -- This desktop-only helper owns a file watcher and a Claude CLI child process.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";

import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as Option from "effect/Option";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import {
  alertTasksWaiting,
  openTasksPopout,
  pinTasksPopout,
} from "../../window/TasksPopoutWindow.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import {
  TASK_BOARD_CHANGED_CHANNEL,
  TASK_BOARD_ALERT_WAITING_CHANNEL,
  TASK_BOARD_CLASSIFY_CHANNEL,
  TASK_BOARD_OPEN_POPOUT_CHANNEL,
  TASK_BOARD_OPEN_THREAD_CHANNEL,
  TASK_BOARD_PATH_CHANNEL,
  TASK_BOARD_POPOUT_PIN_CHANNEL,
  TASK_BOARD_READ_CHANNEL,
  TASK_BOARD_SHOW_THREAD_CHANNEL,
  TASK_BOARD_SUBSCRIBE_CHANNEL,
  TASK_BOARD_QUESTIONS_APPEND_CHANNEL,
  TASK_BOARD_QUESTIONS_READ_CHANNEL,
  TASK_BOARD_USAGE_APPEND_CHANNEL,
  TASK_BOARD_USAGE_READ_CHANNEL,
  TASK_BOARD_WRITE_CHANNEL,
} from "../channels.ts";

const CLASSIFY_TIMEOUT_MS = 90_000;
const MAX_CLASSIFY_INPUT = 60_000;
// The call log keeps its newest lines; a call adds about 300 bytes.
const MAX_USAGE_BYTES = 1_000_000;
const KEEP_USAGE_LINES = 2_000;
// The question log is history worth keeping: about 20,000 summaries.
const MAX_QUESTIONS_BYTES = 8_000_000;
const KEEP_QUESTIONS_LINES = 20_000;

const ClassifyRequest = Schema.Struct({
  system: Schema.String,
  prompt: Schema.String,
  model: Schema.String,
});

const ThreadRef = Schema.Struct({
  environmentId: Schema.String,
  threadId: Schema.String,
});

const ClassifyResult = Schema.Struct({
  text: Schema.NullOr(Schema.String),
  model: Schema.String,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cacheReadTokens: Schema.Number,
  cacheWriteTokens: Schema.Number,
  costUsd: Schema.Number,
  durationMs: Schema.Number,
  error: Schema.NullOr(Schema.String),
});
type ClassifyResult = typeof ClassifyResult.Type;

const numberOr0 = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/**
 * The Claude CLI's `--output-format json` result: the reply text (null on any failure) and the
 * tokens and cost the CLI reports for the call.
 */
function parseClaudePrintResult(stdout: string, model: string): ClassifyResult {
  const failed = (error: string): ClassifyResult => ({
    text: null,
    model,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    durationMs: 0,
    error,
  });
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    return failed("The Claude CLI printed something other than JSON");
  }
  if (typeof value !== "object" || value === null) return failed("Empty reply from the Claude CLI");
  const record = value as {
    is_error?: unknown;
    result?: unknown;
    total_cost_usd?: unknown;
    duration_ms?: unknown;
    usage?: Record<string, unknown>;
    modelUsage?: Record<string, unknown>;
  };
  const usage = record.usage ?? {};
  const ok = record.is_error !== true && typeof record.result === "string";
  return {
    text: ok ? (record.result as string) : null,
    model: Object.keys(record.modelUsage ?? {})[0] ?? model,
    inputTokens: numberOr0(usage.input_tokens),
    outputTokens: numberOr0(usage.output_tokens),
    cacheReadTokens: numberOr0(usage.cache_read_input_tokens),
    cacheWriteTokens: numberOr0(usage.cache_creation_input_tokens),
    costUsd: numberOr0(record.total_cost_usd),
    durationMs: numberOr0(record.duration_ms),
    error: ok
      ? null
      : typeof record.result === "string"
        ? record.result.slice(0, 300)
        : "The Claude CLI reported an error",
  };
}

/**
 * The task board: one JSON file the Tasks page edits, agents may edit by hand, and the watcher
 * updates. It lives outside T3's own data folders so nothing else owns it. `classify` runs one
 * cheap headless Claude call (no tools, no MCP, no settings, no saved session) for the watcher.
 */
export const installTaskBoard = Effect.fn("desktop.ipc.installTaskBoard")(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const ipc = yield* DesktopIpc.DesktopIpc;
  const directory = environment.path.join(environment.homeDirectory, ".config", "t3code-tasks");
  const file = environment.path.join(directory, "tasks.json");
  const usageFile = environment.path.join(directory, "usage.jsonl");
  const claude = environment.path.join(environment.homeDirectory, ".local", "bin", "claude");

  const subscribers = new Set<number>();
  let watcher: NodeFS.FSWatcher | null = null;
  let changeTimer: ReturnType<typeof setTimeout> | undefined;
  let lastWritten: string | null = null;

  const readFile = (): string | null => {
    try {
      return NodeFS.readFileSync(file, "utf8");
    } catch {
      return null;
    }
  };

  const notify = () => {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
      const text = readFile();
      // Our own write already updated the page that made it.
      if (text === null || text === lastWritten) return;
      lastWritten = text;
      for (const id of subscribers) {
        const contents = Electron.webContents.fromId(id);
        if (contents && !contents.isDestroyed()) contents.send(TASK_BOARD_CHANGED_CHANNEL, text);
        else subscribers.delete(id);
      }
    }, 150);
  };

  const ensureWatcher = () => {
    if (watcher || subscribers.size === 0) return;
    try {
      NodeFS.mkdirSync(directory, { recursive: true });
      watcher = NodeFS.watch(directory, (_event, name) => {
        if (name === null || name === "tasks.json") notify();
      });
      watcher.on("error", () => {
        watcher?.close();
        watcher = null;
      });
    } catch {
      watcher = null;
    }
  };

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      clearTimeout(changeTimer);
      watcher?.close();
      watcher = null;
    }),
  );

  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: TASK_BOARD_READ_CHANNEL,
      payload: Schema.Void,
      result: Schema.NullOr(Schema.String),
      handler: () => Effect.sync(readFile),
    }),
  );

  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: TASK_BOARD_WRITE_CHANNEL,
      payload: Schema.String,
      result: Schema.Boolean,
      handler: (text) =>
        Effect.sync(() => {
          try {
            NodeFS.mkdirSync(directory, { recursive: true });
            const temporary = `${file}.${process.pid}.tmp`;
            NodeFS.writeFileSync(temporary, text, "utf8");
            NodeFS.renameSync(temporary, file);
            lastWritten = text;
            return true;
          } catch {
            return false;
          }
        }),
    }),
  );

  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: TASK_BOARD_SUBSCRIBE_CHANNEL,
      payload: Schema.Boolean,
      result: Schema.Boolean,
      handler: (subscribe, event) =>
        Effect.sync(() => {
          if (event) {
            if (subscribe) subscribers.add(event.sender.id);
            else subscribers.delete(event.sender.id);
          }
          if (subscribers.size === 0) {
            watcher?.close();
            watcher = null;
          } else ensureWatcher();
          return true;
        }),
    }),
  );

  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: TASK_BOARD_PATH_CHANNEL,
      payload: Schema.Void,
      result: Schema.String,
      handler: () => Effect.succeed(file),
    }),
  );

  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: TASK_BOARD_CLASSIFY_CHANNEL,
      payload: ClassifyRequest,
      result: ClassifyResult,
      handler: (request) =>
        Effect.callback<ClassifyResult>((resume) => {
          const failed = (error: string): ClassifyResult => ({
            ...parseClaudePrintResult("", request.model),
            error,
          });
          try {
            NodeFS.mkdirSync(directory, { recursive: true });
          } catch {
            return resume(Effect.succeed(failed(`Could not create ${directory}`)));
          }
          const child = NodeChildProcess.execFile(
            claude,
            [
              "-p",
              "--model",
              request.model,
              "--tools",
              "",
              "--strict-mcp-config",
              "--setting-sources",
              "",
              "--no-session-persistence",
              "--disable-slash-commands",
              "--output-format",
              "json",
              "--system-prompt",
              request.system,
            ],
            {
              cwd: directory,
              timeout: CLASSIFY_TIMEOUT_MS,
              maxBuffer: 4 * 1024 * 1024,
            },
            (error, stdout) => {
              // The CLI prints its JSON (with usage) even when it exits non-zero after an API error.
              const result = parseClaudePrintResult(stdout, request.model);
              if (!error || result.costUsd > 0 || result.inputTokens > 0) {
                return resume(Effect.succeed(result));
              }
              resume(
                Effect.succeed(failed(error.killed ? "Timed out" : error.message.slice(0, 300))),
              );
            },
          );
          child.stdin?.end(request.prompt.slice(0, MAX_CLASSIFY_INPUT));
        }),
    }),
  );

  // The watcher's logs: one JSON record per line, trimmed to the newest lines past a size cap.
  const handleJsonLog = Effect.fn("desktop.ipc.taskBoardLog")(function* (
    readChannel: string,
    appendChannel: string,
    logFile: string,
    maxBytes: number,
    keepLines: number,
  ) {
    yield* ipc.handle(
      DesktopIpc.makeIpcMethod({
        channel: readChannel,
        payload: Schema.Void,
        result: Schema.NullOr(Schema.String),
        handler: () =>
          Effect.sync(() => {
            try {
              return NodeFS.readFileSync(logFile, "utf8");
            } catch {
              return null;
            }
          }),
      }),
    );
    yield* ipc.handle(
      DesktopIpc.makeIpcMethod({
        channel: appendChannel,
        payload: Schema.String,
        result: Schema.Boolean,
        handler: (text) =>
          Effect.sync(() => {
            try {
              NodeFS.mkdirSync(directory, { recursive: true });
              // One record per line; several records may come at once, already newline-joined.
              const lines = text
                .split("\n")
                .filter((line) => line.trim())
                .join("\n");
              if (!lines) return true;
              NodeFS.appendFileSync(logFile, `${lines}\n`, "utf8");
              if (NodeFS.statSync(logFile).size > maxBytes) {
                const kept = NodeFS.readFileSync(logFile, "utf8").trimEnd().split("\n");
                const temporary = `${logFile}.${process.pid}.tmp`;
                NodeFS.writeFileSync(temporary, `${kept.slice(-keepLines).join("\n")}\n`, "utf8");
                NodeFS.renameSync(temporary, logFile);
              }
              return true;
            } catch {
              return false;
            }
          }),
      }),
    );
  });

  // The Tasks page in its own window. It loads the address of the window that asked.
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: TASK_BOARD_OPEN_POPOUT_CHANNEL,
      payload: Schema.Void,
      result: Schema.Boolean,
      handler: (_payload, event) =>
        Effect.sync(() => {
          const sender = event ? Electron.webContents.fromId(event.sender.id) : undefined;
          if (!sender || sender.isDestroyed()) return false;
          return openTasksPopout({
            appUrl: sender.getURL(),
            preloadPath: environment.preloadPath,
            platform: environment.platform,
            prefsFile: environment.path.join(directory, "popout-window.json"),
          });
        }),
    }),
  );

  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: TASK_BOARD_POPOUT_PIN_CHANNEL,
      payload: Schema.NullOr(Schema.Boolean),
      result: Schema.Boolean,
      handler: (pinned) => Effect.sync(() => pinTasksPopout(pinned)),
    }),
  );

  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: TASK_BOARD_ALERT_WAITING_CHANNEL,
      payload: Schema.Void,
      result: Schema.Boolean,
      handler: () => Effect.sync(() => alertTasksWaiting(environment.platform)),
    }),
  );

  // A chat opened from the Tasks window shows in the main window, which comes forward.
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: TASK_BOARD_SHOW_THREAD_CHANNEL,
      payload: ThreadRef,
      result: Schema.Boolean,
      handler: Effect.fn("desktop.ipc.taskBoardShowThread")(function* (thread) {
        const windows = yield* ElectronWindow.ElectronWindow;
        const main = yield* windows.main;
        if (Option.isNone(main) || main.value.isDestroyed()) return false;
        if (main.value.isMinimized()) main.value.restore();
        yield* windows.reveal(main.value);
        main.value.focus();
        main.value.webContents.send(TASK_BOARD_OPEN_THREAD_CHANNEL, thread);
        return true;
      }),
    }),
  );

  yield* handleJsonLog(
    TASK_BOARD_USAGE_READ_CHANNEL,
    TASK_BOARD_USAGE_APPEND_CHANNEL,
    usageFile,
    MAX_USAGE_BYTES,
    KEEP_USAGE_LINES,
  );
  yield* handleJsonLog(
    TASK_BOARD_QUESTIONS_READ_CHANNEL,
    TASK_BOARD_QUESTIONS_APPEND_CHANNEL,
    environment.path.join(directory, "questions.jsonl"),
    MAX_QUESTIONS_BYTES,
    KEEP_QUESTIONS_LINES,
  );
});
