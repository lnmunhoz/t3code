import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  desktopDir,
  resolveDevProtocolClient,
  resolveElectronLaunchCommand,
} from "./electron-launcher.mjs";
import { waitForResources } from "./wait-for-resources.mjs";

const devServerUrl = process.env.VITE_DEV_SERVER_URL?.trim();
if (!devServerUrl) {
  throw new Error("VITE_DEV_SERVER_URL is required for desktop development.");
}

const devServer = new URL(devServerUrl);
const port = Number.parseInt(devServer.port, 10);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`VITE_DEV_SERVER_URL must include an explicit port: ${devServerUrl}`);
}

const requiredFiles = [
  "dist-electron/main.cjs",
  "dist-electron/electron/WindowsForegroundFocusWorker.cjs",
  "dist-electron/preload.cjs",
  "dist-electron/snapShot/GlobalShiftShortcutWorker.cjs",
  "dist-electron/snapShot/RegionSnapShotWorker.cjs",
  "dist-electron/snapShot/SnapShotAccessibilityWorker.cjs",
  "../server/dist/bin.mjs",
];
const watchedDirectories = [
  { directory: "dist-electron", files: new Set(["main.cjs", "preload.cjs"]) },
  {
    directory: "dist-electron/electron",
    files: new Set(["WindowsForegroundFocusWorker.cjs"]),
  },
  {
    directory: "dist-electron/snapShot",
    files: new Set([
      "GlobalShiftShortcutWorker.cjs",
      "RegionSnapShotWorker.cjs",
      "SnapShotAccessibilityWorker.cjs",
    ]),
  },
];
// Server code rebuilds into dist-next in the background; the app swaps it in only when asked,
// so a rebuild never restarts the app under running agents or mid-write.
const serverDir = NodePath.join(desktopDir, "../server");
const liveServerDir = NodePath.join(serverDir, "dist");
const stagedServerDir = NodePath.join(serverDir, "dist-next");
const serverRestartRequestPath = NodePath.join(
  desktopDir,
  ".electron-runtime",
  "server-build-restart",
);
const forcedShutdownTimeoutMs = 1_500;
const restartDebounceMs = 120;
const childTreeGracePeriodMs = 1_200;
const remoteDebuggingPort = process.env.T3CODE_DESKTOP_REMOTE_DEBUGGING_PORT?.trim();
// oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone dev script has no Effect runtime.
const hostPlatform = NodeOS.platform();

NodeChildProcess.execFileSync(
  process.execPath,
  [NodePath.join(desktopDir, "scripts/build-browser-secret.mjs")],
  { stdio: "inherit" },
);

await waitForResources({
  baseDir: desktopDir,
  files: requiredFiles,
  tcpHost: devServer.hostname,
  tcpPort: port,
});

const runnerPid = Number.parseInt(process.env.T3CODE_DEV_RUNNER_PID ?? "", 10);

const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;
delete childEnv.T3CODE_DEV_RUNNER_PID;
const devProtocolClient = resolveDevProtocolClient();
if (devProtocolClient) {
  childEnv.T3CODE_DESKTOP_APP_USER_MODEL_ID = devProtocolClient.appBundleId;
  childEnv.T3CODE_DESKTOP_PROTOCOL_REGISTRATION_MANAGED = "1";
}

let shuttingDown = false;
let restartTimer = null;
let currentApp = null;
let restartQueue = Promise.resolve();
const expectedExits = new WeakSet();
const watchers = [];

function killChildTreeByPid(pid, signal) {
  if (hostPlatform === "win32" || typeof pid !== "number") {
    return;
  }

  NodeChildProcess.spawnSync("pkill", [`-${signal}`, "-P", String(pid)], { stdio: "ignore" });
}

function cleanupStaleDevApps() {
  if (hostPlatform === "win32") {
    return;
  }

  const escapedDesktopDir = desktopDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  NodeChildProcess.spawnSync(
    "pkill",
    ["-f", "--", `(^| )--t3code-dev-root=${escapedDesktopDir}( |$)`],
    {
      stdio: "ignore",
    },
  );
}

let serverWatcher = null;

function startServerWatcher() {
  serverWatcher = NodeChildProcess.spawn("vp", ["pack", "--watch"], {
    cwd: serverDir,
    env: { ...process.env, T3CODE_SERVER_DEV_STAGE: "1" },
    stdio: ["ignore", "ignore", "inherit"],
    shell: hostPlatform === "win32",
  });
  serverWatcher.once("error", (error) => {
    console.error("[dev-electron] server rebuild watcher failed to start:", error.message);
  });
}

// The staged build has no web client, so the live one carries over.
function swapInStagedServerBuild() {
  const marker = NodePath.join(stagedServerDir, ".complete");
  if (!NodeFS.existsSync(marker)) return;
  const swapDir = NodePath.join(serverDir, "dist-swap");
  const retiredDir = NodePath.join(serverDir, "dist-prev");
  NodeFS.rmSync(swapDir, { recursive: true, force: true });
  NodeFS.renameSync(stagedServerDir, swapDir);
  // A rebuild that started meanwhile clears the marker; keep the live build then.
  if (!NodeFS.existsSync(NodePath.join(swapDir, ".complete"))) {
    NodeFS.rmSync(swapDir, { recursive: true, force: true });
    return;
  }
  NodeFS.rmSync(retiredDir, { recursive: true, force: true });
  NodeFS.renameSync(liveServerDir, retiredDir);
  NodeFS.renameSync(swapDir, liveServerDir);
  const retiredClient = NodePath.join(retiredDir, "client");
  if (NodeFS.existsSync(retiredClient)) {
    NodeFS.renameSync(retiredClient, NodePath.join(liveServerDir, "client"));
  }
  NodeFS.rmSync(retiredDir, { recursive: true, force: true });
}

function restartWithStagedServerBuild() {
  restartQueue = restartQueue
    .catch(() => undefined)
    .then(async () => {
      await stopApp();
      try {
        swapInStagedServerBuild();
      } catch (error) {
        console.error("[dev-electron] could not swap in the new server build:", error);
      }
      if (!shuttingDown) {
        startApp();
      }
    });
}

function startApp() {
  if (shuttingDown || currentApp !== null) {
    return;
  }

  const electronArgs = remoteDebuggingPort
    ? [`--remote-debugging-port=${remoteDebuggingPort}`]
    : [];
  const launchArgs = devProtocolClient
    ? electronArgs
    : [...electronArgs, `--t3code-dev-root=${desktopDir}`, "dist-electron/main.cjs"];
  const electronCommand = resolveElectronLaunchCommand(launchArgs);
  const app = NodeChildProcess.spawn(electronCommand.electronPath, electronCommand.args, {
    cwd: desktopDir,
    env: childEnv,
    stdio: "inherit",
  });

  currentApp = app;

  app.once("error", () => {
    if (currentApp === app) {
      currentApp = null;
    }

    if (!shuttingDown) {
      scheduleRestart();
    }
  });

  app.once("exit", (code, signal) => {
    if (currentApp === app) {
      currentApp = null;
    }

    const exitedAbnormally = signal !== null || code !== 0;
    if (!shuttingDown && !expectedExits.has(app) && exitedAbnormally) {
      scheduleRestart();
    }
  });
}

async function stopApp() {
  const app = currentApp;
  if (!app) {
    return;
  }

  currentApp = null;
  expectedExits.add(app);

  await new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      resolve();
    };

    app.once("exit", finish);
    app.kill("SIGTERM");
    killChildTreeByPid(app.pid, "TERM");
    cleanupStaleDevApps();

    setTimeout(() => {
      if (settled) {
        return;
      }

      app.kill("SIGKILL");
      killChildTreeByPid(app.pid, "KILL");
      cleanupStaleDevApps();
      finish();
    }, forcedShutdownTimeoutMs).unref();
  });
}

function scheduleRestart() {
  if (shuttingDown) {
    return;
  }

  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  restartTimer = setTimeout(() => {
    restartTimer = null;
    restartQueue = restartQueue
      .catch(() => undefined)
      .then(async () => {
        await stopApp();
        if (!shuttingDown) {
          startApp();
        }
      });
  }, restartDebounceMs);
}

function startWatchers() {
  for (const { directory, files } of watchedDirectories) {
    const watcher = NodeFS.watch(
      NodePath.join(desktopDir, directory),
      { persistent: true },
      (_eventType, filename) => {
        if (typeof filename !== "string" || !files.has(filename)) {
          return;
        }

        scheduleRestart();
      },
    );

    watchers.push(watcher);
  }
}

function killChildTree(signal) {
  if (hostPlatform === "win32") {
    return;
  }

  NodeChildProcess.spawnSync("pkill", [`-${signal}`, "-P", String(process.pid)], {
    stdio: "ignore",
  });
}

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  for (const watcher of watchers) {
    watcher.close();
  }

  await stopApp();
  if (serverWatcher?.pid !== undefined) {
    serverWatcher.kill("SIGTERM");
    killChildTreeByPid(serverWatcher.pid, "TERM");
  }
  killChildTree("TERM");
  await new Promise((resolve) => {
    setTimeout(resolve, childTreeGracePeriodMs);
  });
  killChildTree("KILL");

  process.exit(exitCode);
}

// Signal 0 only probes; EPERM still means the process exists.
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

startWatchers();
cleanupStaleDevApps();
NodeFS.rmSync(serverRestartRequestPath, { force: true });
startServerWatcher();
startApp();

// The app writes this file when its "Restart to load server changes" button is clicked.
setInterval(() => {
  if (shuttingDown || !NodeFS.existsSync(serverRestartRequestPath)) return;
  NodeFS.rmSync(serverRestartRequestPath, { force: true });
  restartWithStagedServerBuild();
}, 1_000).unref();

// A runner killed without signalling us (closed agent shell, SIGKILL) would leave this watcher
// relaunching its app forever, holding the T3 home so the next dev:desktop server cannot start.
if (runnerPid > 0) {
  setInterval(() => {
    if (!isProcessAlive(runnerPid)) {
      void shutdown(0);
    }
  }, 1_000).unref();
}

process.once("SIGINT", () => {
  void shutdown(130);
});
process.once("SIGTERM", () => {
  void shutdown(143);
});
process.once("SIGHUP", () => {
  void shutdown(129);
});
