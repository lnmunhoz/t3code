import { useAtomValue } from "@effect/atom-react";
import type { SnapShotKeyChord } from "@t3tools/contracts";
import { parseKeybindingShortcut } from "@t3tools/shared/keybindings";
import { useState, type KeyboardEvent } from "react";

import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import { getDesktopSnapShotBridge } from "../../lib/desktopSnapShot";
import { sameSnapShotShortcut, snapShotKeybindingConflict } from "../../lib/snapShotShortcut";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { SnapShotShortcutKeys } from "../desktop/SnapShotShortcutKeys";
import { Button } from "../ui/button";
import { commandLabel, keybindingFromKeyboardEvent } from "./KeybindingsSettings.logic";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const MODIFIER_KEYS = new Set(["Shift", "Meta", "OS", "Control", "Alt", "AltGraph"]);

/** Desktop only: a system-wide chord that opens the next thread needing you. */
export function AttentionShortcutSettings() {
  const bridge = getDesktopSnapShotBridge();
  const { shortcut, snapShotShortcut } = useClientSettings((settings) => ({
    shortcut: settings.attentionGlobalShortcut,
    snapShotShortcut: settings.snapShotShortcut,
  }));
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!bridge) return null;

  const save = async (next: SnapShotKeyChord | null) => {
    setMessage(null);
    if (next !== null && (shortcut === null || !sameSnapShotShortcut(next, shortcut))) {
      if (sameSnapShotShortcut(next, snapShotShortcut)) {
        setMessage("Snapshot already uses this shortcut.");
        return;
      }
      // The system-wide chord swallows the key inside T3 Code too, so only this command may share it.
      const conflict = snapShotKeybindingConflict(next, keybindings);
      if (conflict !== null && conflict !== "thread.nextAttention") {
        setMessage(`${commandLabel(conflict)} already uses this shortcut.`);
        return;
      }
      const availability = await bridge.checkSnapShotShortcut(next).catch(() => null);
      if (availability !== null && !availability.available) {
        setMessage(
          availability.message ?? "This shortcut is already used by the system or another app.",
        );
        return;
      }
    }
    try {
      await updateClientSettings({ attentionGlobalShortcut: next });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save this shortcut.");
    }
  };

  const record = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording || event.key === "Tab" || event.repeat) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setRecording(false);
      return;
    }
    if (MODIFIER_KEYS.has(event.key)) return;
    // Without a modifier the chord would take that key from every app.
    if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) return;
    const input = keybindingFromKeyboardEvent(event, navigator.platform);
    const next = input ? parseKeybindingShortcut(input) : null;
    if (!next) return;
    setRecording(false);
    void save(next);
  };

  return (
    <SettingsRow
      {...searchableSetting("attention-global-shortcut")}
      description={
        message ??
        "From any app, bring T3 Code forward and open the next thread that needs you or finished since you last looked."
      }
      control={
        <div className="flex items-center gap-1.5">
          {shortcut !== null && !recording ? (
            <Button type="button" size="xs" variant="ghost-muted" onClick={() => void save(null)}>
              Clear
            </Button>
          ) : null}
          <Button
            type="button"
            size="xs"
            variant={recording ? "secondary" : "outline"}
            aria-label={shortcut ? "Change system-wide shortcut" : "Set system-wide shortcut"}
            aria-pressed={recording}
            data-keybinding-capture=""
            onClick={() => {
              setMessage(null);
              setRecording(true);
            }}
            onKeyDown={record}
            onBlur={() => setRecording(false)}
          >
            {recording ? (
              "Press shortcut…"
            ) : shortcut ? (
              <SnapShotShortcutKeys shortcut={shortcut} />
            ) : (
              "Set shortcut"
            )}
          </Button>
        </div>
      }
    />
  );
}
