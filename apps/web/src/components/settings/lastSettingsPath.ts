import { SETTINGS_NAV_LABELS, type SettingsPath } from "./settingsSearch";

const STORAGE_KEY = "t3code:last-settings-path:v1";

const isSettingsPath = (value: string): value is SettingsPath =>
  Object.hasOwn(SETTINGS_NAV_LABELS, value);

/** The settings page this device last showed, so reopening Settings lands back on it. */
export function readLastSettingsPath(): SettingsPath | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value !== null && isSettingsPath(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveLastSettingsPath(pathname: string): void {
  if (!isSettingsPath(pathname)) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, pathname);
  } catch {}
}
