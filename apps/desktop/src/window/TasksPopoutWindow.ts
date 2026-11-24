// @effect-diagnostics globalTimers:off -- Saving the window's place is debounced from Electron events.
// @effect-diagnostics nodeBuiltinImport:off -- The window's place is a small JSON file beside the board.

import * as NodeFS from "node:fs";

import * as Option from "effect/Option";
import * as Electron from "electron";

import { parseSafeExternalUrl } from "../electron/ElectronShell.ts";

/**
 * Fork: the Tasks page in its own window, so the board and question log can sit beside the app
 * (or on another screen). It loads the same app as the main window with `?popout=tasks`, which
 * the web app reads to show only the Tasks page and to skip its app-wide services (the watcher,
 * notifications and the rest stay in the main window). One at a time: opening it again focuses it.
 */
let popout: Electron.BrowserWindow | null = null;

const POPOUT_TITLE = "Tasks";

/** Where the window was and whether it stays on top, kept across launches. */
interface PopoutPrefs {
  readonly bounds?: Electron.Rectangle;
  readonly alwaysOnTop?: boolean;
}

let prefsFile: string | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function readPrefs(): PopoutPrefs {
  if (!prefsFile) return {};
  try {
    const value: unknown = JSON.parse(NodeFS.readFileSync(prefsFile, "utf8"));
    if (typeof value !== "object" || value === null) return {};
    const record = value as { bounds?: unknown; alwaysOnTop?: unknown };
    const bounds = record.bounds as Partial<Electron.Rectangle> | undefined;
    const validBounds =
      bounds &&
      [bounds.x, bounds.y, bounds.width, bounds.height].every(
        (n) => typeof n === "number" && Number.isFinite(n),
      )
        ? (bounds as Electron.Rectangle)
        : undefined;
    return {
      ...(validBounds ? { bounds: validBounds } : {}),
      alwaysOnTop: record.alwaysOnTop === true,
    };
  } catch {
    return {};
  }
}

function savePrefs(window: Electron.BrowserWindow) {
  if (!prefsFile || window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return;
  const prefs: PopoutPrefs = {
    bounds: window.getNormalBounds(),
    alwaysOnTop: window.isAlwaysOnTop(),
  };
  try {
    NodeFS.writeFileSync(prefsFile, JSON.stringify(prefs), "utf8");
  } catch {
    // Losing the place only means the next window opens at the default size.
  }
}

/** Saved bounds only when most of the window still lands on a connected display. */
function visibleBounds(bounds: Electron.Rectangle | undefined): Electron.Rectangle | undefined {
  if (!bounds) return undefined;
  const fits = Electron.screen.getAllDisplays().some(({ workArea }) => {
    const width =
      Math.min(bounds.x + bounds.width, workArea.x + workArea.width) -
      Math.max(bounds.x, workArea.x);
    const height =
      Math.min(bounds.y + bounds.height, workArea.y + workArea.height) -
      Math.max(bounds.y, workArea.y);
    return width >= Math.min(200, bounds.width) && height >= Math.min(120, bounds.height);
  });
  return fits ? bounds : undefined;
}

/** Keeps the Tasks window above other apps, or not; null only reads. Returns the setting. */
export function pinTasksPopout(pinned: boolean | null): boolean {
  if (!popout || popout.isDestroyed()) return readPrefs().alwaysOnTop === true;
  if (pinned !== null) {
    popout.setAlwaysOnTop(pinned, "floating");
    savePrefs(popout);
  }
  return popout.isAlwaysOnTop();
}

/** A task just turned to waiting on you: bounce the Dock icon once, unless you're in the app. */
export function alertTasksWaiting(platform: NodeJS.Platform): boolean {
  if (Electron.BrowserWindow.getFocusedWindow()) return false;
  if (platform === "darwin") Electron.app.dock?.bounce("informational");
  else if (popout && !popout.isDestroyed()) popout.flashFrame(true);
  return true;
}

/** The popout's own page, which IPC trusts like the main window's. */
export function isTasksPopoutSender(event: {
  readonly sender: { readonly id: number };
  readonly senderFrame?: unknown;
}): boolean {
  return (
    popout !== null &&
    !popout.isDestroyed() &&
    popout.webContents.id === event.sender.id &&
    popout.webContents.mainFrame === event.senderFrame
  );
}

/** The app address the popout loads: the main window's, with the popout flag and the Tasks route. */
function tasksPopoutUrl(appUrl: string): string | null {
  try {
    const url = new URL(appUrl);
    url.search = "?popout=tasks";
    url.hash = "#/tasks";
    return url.toString();
  } catch {
    return null;
  }
}

function sameOrigin(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    return left.host !== "" && left.protocol === right.protocol && left.host === right.host;
  } catch {
    return false;
  }
}

function openExternal(url: string) {
  if (Option.isSome(parseSafeExternalUrl(url))) void Electron.shell.openExternal(url);
}

export function openTasksPopout(input: {
  readonly appUrl: string;
  readonly preloadPath: string;
  readonly platform: NodeJS.Platform;
  readonly prefsFile: string;
}): boolean {
  prefsFile = input.prefsFile;
  if (popout && !popout.isDestroyed()) {
    if (popout.isMinimized()) popout.restore();
    popout.show();
    popout.focus();
    return true;
  }
  const url = tasksPopoutUrl(input.appUrl);
  if (!url) return false;
  const dark = Electron.nativeTheme.shouldUseDarkColors;
  const prefs = readPrefs();
  const bounds = visibleBounds(prefs.bounds);
  const window = new Electron.BrowserWindow({
    ...(bounds ?? { width: 560, height: 820 }),
    minWidth: 380,
    minHeight: 420,
    title: POPOUT_TITLE,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: dark ? "#000000" : "#ffffff",
    ...(input.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 16, y: 18 } }
      : {}),
    webPreferences: {
      preload: input.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  popout = window;
  if (prefs.alwaysOnTop) window.setAlwaysOnTop(true, "floating");
  const saveSoon = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => savePrefs(window), 400);
  };
  window.on("moved", saveSoon);
  window.on("resized", saveSoon);
  window.on("close", () => {
    clearTimeout(saveTimer);
    savePrefs(window);
  });
  window.on("closed", () => {
    if (popout === window) popout = null;
  });
  window.once("ready-to-show", () => window.show());
  // The page would rename the window after whatever it shows; it is always the Tasks window.
  window.on("page-title-updated", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    openExternal(target);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, target) => {
    if (sameOrigin(url, target)) return;
    event.preventDefault();
    openExternal(target);
  });
  void window.loadURL(url).catch(() => undefined);
  return true;
}
