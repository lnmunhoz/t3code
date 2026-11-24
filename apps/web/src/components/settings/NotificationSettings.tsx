import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { T, useGT, useMessages } from "gt-react";
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
import { useSearchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function NotificationSettings() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const m = useMessages();
  const mode = useScopedSettings((settings) => settings.notificationMode);
  const updateSettings = useUpdateScopedSettings();
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  return (
    <SettingsRow
      {...searchableSetting("thread-notifications")}
      description={
        permissionMessage ??
        gt(
          "System alerts when a thread finishes, fails, or needs input or approval. Applies to this device while T3 Code is open.",
        )
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
                  gt(
                    "Notifications need a supported browser over HTTPS, or the desktop app. Sound only is still available.",
                  ),
                );
                return;
              }
              setRequesting(true);
              const permission = await settlePromise(() => Notification.requestPermission());
              setRequesting(false);
              if (permission._tag === "Failure") {
                setPermissionMessage(
                  gt(
                    "Notifications are unavailable in this browser. Sound only is still available.",
                  ),
                );
                return;
              }
              if (permission.value !== "granted") {
                setPermissionMessage(
                  gt(
                    "Allow notifications in your browser or system settings, then choose this option again. Sound only is still available.",
                  ),
                );
                return;
              }
            }
            updateSettings({ notificationMode: value });
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-56"
            aria-label={gt("Thread notifications")}
          >
            <SelectValue>{m(NOTIFICATION_MODE_LABELS[mode])}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {Object.entries(NOTIFICATION_MODE_LABELS).map(([value, label]) => (
              <SelectItem key={value} hideIndicator value={value}>
                {m(label)}
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
  const searchableSetting = useSearchableSetting();
  const speechMode = useScopedSettings((settings) => settings.notificationSpeechMode);
  const soundOn = useScopedSettings((settings) => hasNotificationSound(settings.notificationMode));
  const updateSettings = useUpdateScopedSettings();
  const supported = canSpeakNotifications();
  const gt = useGT();

  return (
    <SettingsRow
      {...searchableSetting("spoken-notifications")}
      description={
        !supported
          ? gt("Text to speech is not available in this browser.")
          : soundOn
            ? gt(
                "Say the thread title aloud, such as \u201cFix login bug complete\u201d or \u201cFix login bug needs approval\u201d.",
              )
            : gt(
                "Say the thread title aloud. Choose a thread notification mode with sound to hear it.",
              )
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
          <SelectTrigger
            size="sm"
            className="w-full sm:w-56"
            aria-label={gt("Spoken notifications")}
          >
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
  const searchableSetting = useSearchableSetting();
  const speechOn = useScopedSettings((settings) => settings.notificationSpeechMode !== "off");
  const engine = useScopedSettings((settings) => settings.notificationSpeechEngine);
  const updateSettings = useUpdateScopedSettings();
  const gt = useGT();
  const m = useMessages();
  if (!canSpeakNotifications() || !speechOn) return null;

  return (
    <>
      <SettingsRow
        {...searchableSetting("spoken-notification-engine")}
        description={gt(
          "System voices are built into this device. Kokoro is a neural voice that runs locally; it downloads once ({size}) and stays offline afterwards.",
          { size: m(KOKORO_DOWNLOAD_LABEL) },
        )}
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
            <SelectTrigger size="sm" className="w-full sm:w-56" aria-label={gt("Voice engine")}>
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
  const searchableSetting = useSearchableSetting();
  const voiceURI = useScopedSettings((settings) => settings.notificationSpeechVoice);
  const updateSettings = useUpdateScopedSettings();
  const voices = useSyncExternalStore(subscribeSpeechVoices, listSpeechVoices);
  // The full macOS list is long; show voices in the app's language plus the current pick.
  const language = (navigator.language || "en").split("-")[0]!;
  const shown = voices
    .filter((voice) => voice.lang.startsWith(language) || voice.voiceURI === voiceURI)
    .toSorted((a, b) => a.name.localeCompare(b.name));
  const selected = voices.find((voice) => voice.voiceURI === voiceURI);
  const gt = useGT();

  return (
    <SettingsRow
      {...searchableSetting("spoken-notification-voice")}
      description={gt(
        "Voices installed on this device. Add more in System Settings › Accessibility › Spoken Content › System voice › Manage Voices.",
      )}
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
          <SelectTrigger size="sm" className="w-full sm:w-56" aria-label={gt("Notification voice")}>
            <SelectValue>
              {selected ? selected.name : gt("Default", { $context: "default system voice" })}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem hideIndicator value={DEFAULT_VOICE}>
              <T context="default system voice">Default</T>
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
  const searchableSetting = useSearchableSetting();
  const state = useSyncExternalStore(subscribeKokoroState, getKokoroState);
  const downloaded = useSyncExternalStore(subscribeKokoroState, getKokoroDownloaded);
  const gt = useGT();
  const m = useMessages();

  const description =
    state.status === "loading"
      ? state.progress === null
        ? gt("Loading the Kokoro model…")
        : gt("Downloading the Kokoro model… {percent}%", {
            percent: Math.round(state.progress * 100),
          })
      : state.status === "error"
        ? gt("Kokoro failed to load: {error}. Alerts use the system voice until it works.", {
            error: state.message,
          })
        : downloaded
          ? state.status === "ready"
            ? gt("Downloaded and loaded. It unloads after 10 idle minutes to free memory.")
            : gt("Downloaded. It loads on the next alert.")
          : gt("Not downloaded yet ({size}). Alerts use the system voice until it is.", {
              size: m(KOKORO_DOWNLOAD_LABEL),
            });

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
            <T>Remove download</T>
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
            {state.status === "error"
              ? gt("Retry download")
              : gt("Download", { $context: "verb, downloads the voice model" })}
          </Button>
        )
      }
    />
  );
}

function KokoroVoiceRow() {
  const searchableSetting = useSearchableSetting();
  const voice = useScopedSettings((settings) => settings.notificationSpeechKokoroVoice);
  const updateSettings = useUpdateScopedSettings();
  const selected = KOKORO_VOICES.find((entry) => entry.id === voice);
  const gt = useGT();
  const m = useMessages();

  return (
    <SettingsRow
      {...searchableSetting("spoken-notification-kokoro-voice")}
      description={gt("The Kokoro voice used for spoken alerts.")}
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
          <SelectTrigger size="sm" className="w-full sm:w-56" aria-label={gt("Kokoro voice")}>
            <SelectValue>{selected ? m(selected.label) : voice}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {KOKORO_VOICES.map((entry) => (
              <SelectItem key={entry.id} hideIndicator value={entry.id}>
                {m(entry.label)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

function SpeechRateRow() {
  const searchableSetting = useSearchableSetting();
  const rate = useScopedSettings((settings) => settings.notificationSpeechRate);
  const updateSettings = useUpdateScopedSettings();
  const gt = useGT();

  return (
    <SettingsRow
      {...searchableSetting("spoken-notification-rate")}
      description={gt("How fast alerts are spoken.")}
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
          <SelectTrigger size="sm" className="w-full sm:w-56" aria-label={gt("Speech rate")}>
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
