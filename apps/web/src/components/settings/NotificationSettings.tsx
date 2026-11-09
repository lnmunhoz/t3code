import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { useState, useSyncExternalStore } from "react";

import type { NotificationSpeechMode } from "@t3tools/contracts/settings";

import {
  canSpeakNotifications,
  listSpeechVoices,
  speakNotification,
  subscribeSpeechVoices,
} from "../../notificationSpeech";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  NOTIFICATION_MODE_LABELS,
  unlockNotificationAudio,
} from "../../threadNotifications";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function NotificationSettings() {
  const mode = useScopedSettings((settings) => settings.notificationMode);
  const updateSettings = useUpdateScopedSettings();
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  return (
    <SettingsRow
      {...searchableSetting("thread-notifications")}
      description={
        permissionMessage ??
        "System alerts when a thread finishes, fails, or needs input or approval. Applies to this device while T3 Code is open."
      }
      control={
        <Select
          value={mode}
          disabled={requesting}
          onValueChange={async (value) => {
            if (
              value !== "off" &&
              value !== "notifications" &&
              value !== "sound" &&
              value !== "notifications-and-sound"
            )
              return;
            setPermissionMessage(null);
            if (hasNotificationSound(value)) unlockNotificationAudio();
            if (hasDesktopNotifications(value)) {
              if (typeof Notification === "undefined" || !window.isSecureContext) {
                setPermissionMessage(
                  "Notifications need a supported browser over HTTPS, or the desktop app. Sound only is still available.",
                );
                return;
              }
              setRequesting(true);
              const permission = await settlePromise(() => Notification.requestPermission());
              setRequesting(false);
              if (permission._tag === "Failure") {
                setPermissionMessage(
                  "Notifications are unavailable in this browser. Sound only is still available.",
                );
                return;
              }
              if (permission.value !== "granted") {
                setPermissionMessage(
                  "Allow notifications in your browser or system settings, then choose this option again. Sound only is still available.",
                );
                return;
              }
            }
            updateSettings({ notificationMode: value });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Thread notifications">
            <SelectValue>{NOTIFICATION_MODE_LABELS[mode]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {Object.entries(NOTIFICATION_MODE_LABELS).map(([value, label]) => (
              <SelectItem key={value} hideIndicator value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

const SPEECH_MODE_LABELS = {
  off: "Off",
  "with-sound": "After the sound",
  "instead-of-sound": "Instead of the sound",
} satisfies Record<NotificationSpeechMode, string>;

function isSpeechMode(value: unknown): value is NotificationSpeechMode {
  return typeof value === "string" && Object.hasOwn(SPEECH_MODE_LABELS, value);
}

export function NotificationSpeechSettings() {
  const speechMode = useScopedSettings((settings) => settings.notificationSpeechMode);
  const soundOn = useScopedSettings((settings) => hasNotificationSound(settings.notificationMode));
  const updateSettings = useUpdateScopedSettings();
  const supported = canSpeakNotifications();

  return (
    <SettingsRow
      {...searchableSetting("spoken-notifications")}
      description={
        !supported
          ? "Text to speech is not available in this browser."
          : soundOn
            ? "Say the thread title aloud, such as \u201cFix login bug complete\u201d or \u201cFix login bug needs approval\u201d."
            : "Say the thread title aloud. Choose a thread notification mode with sound to hear it."
      }
      control={
        <Select
          value={speechMode}
          disabled={!supported}
          onValueChange={(value) => {
            if (!isSpeechMode(value)) return;
            updateSettings({ notificationSpeechMode: value });
            if (value !== "off") speakNotification("Spoken notifications on");
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Spoken notifications">
            <SelectValue>{SPEECH_MODE_LABELS[speechMode]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {Object.entries(SPEECH_MODE_LABELS).map(([value, label]) => (
              <SelectItem key={value} hideIndicator value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

const DEFAULT_VOICE = "default";

export function NotificationSpeechVoiceSettings() {
  const voiceURI = useScopedSettings((settings) => settings.notificationSpeechVoice);
  const speechOn = useScopedSettings((settings) => settings.notificationSpeechMode !== "off");
  const updateSettings = useUpdateScopedSettings();
  const voices = useSyncExternalStore(subscribeSpeechVoices, listSpeechVoices);
  if (!canSpeakNotifications() || !speechOn) return null;
  // The full macOS list is long; show voices in the app's language plus the current pick.
  const language = (navigator.language || "en").split("-")[0]!;
  const shown = voices
    .filter((voice) => voice.lang.startsWith(language) || voice.voiceURI === voiceURI)
    .toSorted((a, b) => a.name.localeCompare(b.name));
  const selected = voices.find((voice) => voice.voiceURI === voiceURI);

  return (
    <SettingsRow
      {...searchableSetting("spoken-notification-voice")}
      description="Voices installed on this device. Add more in System Settings › Accessibility › Spoken Content › System voice › Manage Voices."
      control={
        <Select
          value={voiceURI || DEFAULT_VOICE}
          onValueChange={(value) => {
            if (typeof value !== "string") return;
            const next = value === DEFAULT_VOICE ? "" : value;
            updateSettings({ notificationSpeechVoice: next });
            speakNotification("Thread complete", next);
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Notification voice">
            <SelectValue>{selected ? selected.name : "Default"}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem hideIndicator value={DEFAULT_VOICE}>
              Default
            </SelectItem>
            {shown.map((voice) => (
              <SelectItem key={voice.voiceURI} hideIndicator value={voice.voiceURI}>
                {voice.name}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
