import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { useState, useSyncExternalStore } from "react";

import type { ClientSettings, NotificationSpeechMode } from "@t3tools/contracts/settings";

import { getClientSettings } from "../../hooks/useSettings";
import {
  canSpeakNotifications,
  listSpeechVoices,
  speakNotification,
  speechOptionsFromSettings,
  subscribeSpeechVoices,
} from "../../notificationSpeech";
import {
  getKokoroDownloaded,
  getKokoroState,
  KOKORO_DOWNLOAD_LABEL,
  KOKORO_VOICES,
  loadKokoro,
  removeKokoro,
  subscribeKokoroState,
} from "../../speech/kokoroSpeech";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  NOTIFICATION_MODE_LABELS,
  unlockNotificationAudio,
} from "../../threadNotifications";
import { Button } from "../ui/button";
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
            if (value !== "off") previewSpeech({ notificationSpeechMode: value });
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

/** Engine, voice, model download, and rate rows; hidden while speech is off. */
export function NotificationSpeechVoiceSettings() {
  const speechOn = useScopedSettings((settings) => settings.notificationSpeechMode !== "off");
  const engine = useScopedSettings((settings) => settings.notificationSpeechEngine);
  const updateSettings = useUpdateScopedSettings();
  if (!canSpeakNotifications() || !speechOn) return null;

  return (
    <>
      <SettingsRow
        {...searchableSetting("spoken-notification-engine")}
        description={`System voices are built into this device. Kokoro is a neural voice that runs locally; it downloads once (${KOKORO_DOWNLOAD_LABEL}) and stays offline afterwards.`}
        control={
          <Select
            value={engine}
            onValueChange={(value) => {
              if (value !== "system" && value !== "kokoro") return;
              updateSettings({ notificationSpeechEngine: value });
              if (value === "kokoro") {
                void loadKokoro()
                  .then(() => previewSpeech({ notificationSpeechEngine: "kokoro" }))
                  .catch(() => undefined);
              } else {
                previewSpeech({ notificationSpeechEngine: "system" });
              }
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Voice engine">
              <SelectValue>{SPEECH_ENGINE_LABELS[engine]}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {Object.entries(SPEECH_ENGINE_LABELS).map(([value, label]) => (
                <SelectItem key={value} hideIndicator value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      {engine === "kokoro" ? (
        <>
          <KokoroModelRow />
          <KokoroVoiceRow />
        </>
      ) : (
        <SystemVoiceRow />
      )}
      <SpeechRateRow />
    </>
  );
}

const SPEECH_ENGINE_LABELS = {
  system: "System voices",
  kokoro: "Kokoro (neural, local)",
} satisfies Record<ClientSettings["notificationSpeechEngine"], string>;

const SPEECH_RATES = [0.8, 0.9, 1, 1.1, 1.25, 1.5] as const;

function previewSpeech(patch: Partial<ClientSettings>) {
  speakNotification(
    "Thread complete",
    speechOptionsFromSettings({ ...getClientSettings(), ...patch }),
  );
}

const DEFAULT_VOICE = "default";

function SystemVoiceRow() {
  const voiceURI = useScopedSettings((settings) => settings.notificationSpeechVoice);
  const updateSettings = useUpdateScopedSettings();
  const voices = useSyncExternalStore(subscribeSpeechVoices, listSpeechVoices);
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
            previewSpeech({ notificationSpeechVoice: next });
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

function KokoroModelRow() {
  const state = useSyncExternalStore(subscribeKokoroState, getKokoroState);
  const downloaded = useSyncExternalStore(subscribeKokoroState, getKokoroDownloaded);

  const description =
    state.status === "loading"
      ? state.progress === null
        ? "Loading the Kokoro model…"
        : `Downloading the Kokoro model… ${Math.round(state.progress * 100)}%`
      : state.status === "error"
        ? `Kokoro failed to load: ${state.message}. Alerts use the system voice until it works.`
        : downloaded
          ? state.status === "ready"
            ? "Downloaded and loaded. It unloads after 10 idle minutes to free memory."
            : "Downloaded. It loads on the next alert."
          : `Not downloaded yet (${KOKORO_DOWNLOAD_LABEL}). Alerts use the system voice until it is.`;

  return (
    <SettingsRow
      {...searchableSetting("spoken-notification-kokoro-model")}
      description={description}
      control={
        downloaded && state.status !== "loading" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void removeKokoro();
            }}
          >
            Remove download
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={state.status === "loading"}
            onClick={() => {
              void loadKokoro()
                .then(() => previewSpeech({ notificationSpeechEngine: "kokoro" }))
                .catch(() => undefined);
            }}
          >
            {state.status === "error" ? "Retry download" : "Download"}
          </Button>
        )
      }
    />
  );
}

function KokoroVoiceRow() {
  const voice = useScopedSettings((settings) => settings.notificationSpeechKokoroVoice);
  const updateSettings = useUpdateScopedSettings();
  const selected = KOKORO_VOICES.find((entry) => entry.id === voice);

  return (
    <SettingsRow
      {...searchableSetting("spoken-notification-kokoro-voice")}
      description="The Kokoro voice used for spoken alerts."
      control={
        <Select
          value={voice}
          onValueChange={(value) => {
            if (typeof value !== "string") return;
            updateSettings({ notificationSpeechKokoroVoice: value });
            previewSpeech({
              notificationSpeechEngine: "kokoro",
              notificationSpeechKokoroVoice: value,
            });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Kokoro voice">
            <SelectValue>{selected?.label ?? voice}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {KOKORO_VOICES.map((entry) => (
              <SelectItem key={entry.id} hideIndicator value={entry.id}>
                {entry.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

function SpeechRateRow() {
  const rate = useScopedSettings((settings) => settings.notificationSpeechRate);
  const updateSettings = useUpdateScopedSettings();

  return (
    <SettingsRow
      {...searchableSetting("spoken-notification-rate")}
      description="How fast alerts are spoken."
      control={
        <Select
          value={String(rate)}
          onValueChange={(value) => {
            const next = Number(value);
            if (!Number.isFinite(next)) return;
            updateSettings({ notificationSpeechRate: next });
            previewSpeech({ notificationSpeechRate: next });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Speech rate">
            <SelectValue>{`${rate}×`}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {SPEECH_RATES.map((value) => (
              <SelectItem key={value} hideIndicator value={String(value)}>
                {`${value}×`}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
