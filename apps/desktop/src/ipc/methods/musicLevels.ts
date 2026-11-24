// @effect-diagnostics globalTimers:off -- Meter restarts are scheduled from child-process callbacks outside any Effect fiber.
// @effect-diagnostics nodeBuiltinImport:off -- This desktop-only helper owns a Node child process for the native audio meter.

import * as NodeChildProcess from "node:child_process";

import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import {
  MUSIC_LEVELS_CHANNEL,
  MUSIC_LEVELS_SUBSCRIBE_CHANNEL,
  MUSIC_METER_REQUEST_ACCESS_CHANNEL,
} from "../channels.ts";

const MUSIC_SPECTRUM_BANDS = 40;

/** One stdout line of native/audio-meter: 40 band levels from 0 to 1. */
export function parseMeterReading(line: string): ReadonlyArray<number> | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  return Array.isArray(value) &&
    value.length === MUSIC_SPECTRUM_BANDS &&
    value.every((band) => typeof band === "number" && band >= 0 && band <= 1)
    ? value
    : null;
}

// Exit 0: the players changed, re-tap now. Exit 2: no player runs. Anything else is usually a
// missing System Audio Recording grant, so it waits longer before trying again.
const restartDelayMs = (code: number | null) => (code === 0 ? 250 : code === 2 ? 3_000 : 30_000);

/**
 * Runs the native music meter (macOS) while the window shows music bars, and forwards each
 * spectrum to it. The meter taps only Spotify and Apple Music and keeps no audio.
 */
export const installMusicLevels = Effect.fn("desktop.ipc.installMusicLevels")(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const ipc = yield* DesktopIpc.DesktopIpc;
  const fileSystem = yield* FileSystem.FileSystem;
  const meterApp = ["T3 Code Music Meter.app", "Contents", "MacOS", "t3-audio-meter"] as const;
  const executable = environment.isPackaged
    ? environment.path.join(environment.resourcesPath, "audio-meter", ...meterApp)
    : environment.path.join(environment.rootDir, "native", "audio-meter", "build", ...meterApp);
  const available =
    environment.platform === "darwin" &&
    (yield* fileSystem.exists(executable).pipe(Effect.orElseSucceed(() => false)));

  let subscriber: number | null = null;
  let meter: NodeChildProcess.ChildProcess | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;

  const send = (spectrum: ReadonlyArray<number> | null) => {
    if (subscriber === null) return;
    const contents = Electron.webContents.fromId(subscriber);
    if (contents && !contents.isDestroyed()) contents.send(MUSIC_LEVELS_CHANNEL, spectrum);
  };

  const start = () => {
    clearTimeout(restartTimer);
    if (!available || subscriber === null || meter) return;
    const child = NodeChildProcess.spawn(executable, [], { stdio: ["ignore", "pipe", "ignore"] });
    meter = child;
    let pending = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = (lines.pop() ?? "").slice(-4_096);
      for (const line of lines) {
        const spectrum = parseMeterReading(line);
        if (spectrum) send(spectrum);
      }
    });
    const exited = (code: number | null) => {
      if (meter !== child) return;
      meter = null;
      send(null);
      if (subscriber !== null) restartTimer = setTimeout(start, restartDelayMs(code));
    };
    child.once("error", () => exited(1));
    child.once("exit", exited);
  };

  const stop = () => {
    clearTimeout(restartTimer);
    const child = meter;
    meter = null;
    child?.kill();
  };

  yield* Effect.addFinalizer(() => Effect.sync(stop));
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: MUSIC_LEVELS_SUBSCRIBE_CHANNEL,
      payload: Schema.Boolean,
      result: Schema.Boolean,
      handler: (subscribe, event) =>
        Effect.sync(() => {
          if (subscribe && event) {
            subscriber = event.sender.id;
            start();
          } else {
            subscriber = null;
            stop();
          }
          return available;
        }),
    }),
  );
  // The Settings button: macOS's Microphone prompt for the meter, in front. Core Audio needs that
  // grant before the tap hears anything, and its own check never prompts.
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: MUSIC_METER_REQUEST_ACCESS_CHANNEL,
      payload: Schema.Void,
      result: Schema.Literals(["granted", "denied", "unavailable"]),
      handler: () =>
        Effect.callback<"granted" | "denied" | "unavailable">((resume) => {
          if (!available) return resume(Effect.succeed("unavailable"));
          NodeChildProcess.execFile(executable, ["--request-access"], (_error, stdout) => {
            const granted = stdout.trim() === "granted";
            if (granted) {
              stop();
              start();
            }
            resume(Effect.succeed(granted ? "granted" : "denied"));
          });
        }),
    }),
  );
});
