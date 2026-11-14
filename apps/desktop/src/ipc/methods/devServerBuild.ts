import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { DEV_SERVER_BUILD_READY_CHANNEL, DEV_SERVER_BUILD_RESTART_CHANNEL } from "../channels.ts";

/**
 * dev:desktop rebuilds the server into apps/server/dist-next and marks each finished build.
 * This tells the page when that build differs from the running one, and asks dev-electron
 * (scripts/dev-electron.mjs) to swap it in and restart when the page says so.
 */
export const installDevServerBuild = Effect.fn("desktop.ipc.installDevServerBuild")(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  if (environment.isPackaged || !environment.isDevelopment) return;
  const ipc = yield* DesktopIpc.DesktopIpc;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const liveDir = path.join(environment.serverRoot, "apps/server/dist");
  const stagedDir = path.join(environment.serverRoot, "apps/server/dist-next");
  const restartRequest = path.join(
    environment.serverRoot,
    "apps/desktop/.electron-runtime/server-build-restart",
  );

  let ready = false;
  let checkedMarker: number | null = null;

  const modules = (dir: string) =>
    fileSystem
      .readDirectory(dir)
      .pipe(Effect.map((names) => names.filter((name) => name.endsWith(".mjs")).toSorted()));
  // Chunk names carry content hashes, so an unchanged build matches file for file.
  const sameAsLive = Effect.gen(function* () {
    const live = yield* modules(liveDir);
    const staged = yield* modules(stagedDir);
    if (live.length !== staged.length || live.some((name, index) => name !== staged[index])) {
      return false;
    }
    for (const name of live) {
      const left = yield* fileSystem.readFile(path.join(liveDir, name));
      const right = yield* fileSystem.readFile(path.join(stagedDir, name));
      if (left.length !== right.length || left.some((byte, index) => byte !== right[index])) {
        return false;
      }
    }
    return true;
  });

  const check = Effect.gen(function* () {
    const marker = yield* fileSystem
      .stat(path.join(stagedDir, ".complete"))
      .pipe(Effect.option, Effect.map(Option.flatMap((info) => info.mtime)));
    if (Option.isNone(marker)) return;
    const markedAt = marker.value.getTime();
    if (markedAt === checkedMarker) return;
    const next = !(yield* sameAsLive);
    checkedMarker = markedAt;
    if (next === ready) return;
    ready = next;
    for (const window of Electron.BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(DEV_SERVER_BUILD_READY_CHANNEL, ready);
    }
  }).pipe(Effect.ignore);

  yield* check.pipe(Effect.repeat(Schedule.spaced("2 seconds")), Effect.forkScoped);
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: DEV_SERVER_BUILD_READY_CHANNEL,
      payload: Schema.Void,
      result: Schema.Boolean,
      handler: () => Effect.sync(() => ready),
    }),
  );
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: DEV_SERVER_BUILD_RESTART_CHANNEL,
      payload: Schema.Void,
      result: Schema.Void,
      handler: () => fileSystem.writeFileString(restartRequest, "").pipe(Effect.orDie),
    }),
  );
});
