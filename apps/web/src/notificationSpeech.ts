/** The seam where a cloud voice (ElevenLabs, OpenAI) can replace the built-in one later. */
export interface NotificationSpeechProvider {
  readonly available: () => boolean;
  /** Resolves when the utterance ends or is dropped. `voice` is a provider-specific id; "" is the default. */
  readonly speak: (text: string, voice: string) => Promise<void>;
}

// Chromium (and so Electron) on macOS often flags no default voice and falls back to the first one
// alphabetically, a novelty voice ("Albert"). Prefer the usual system voices instead.
const PREFERRED_VOICE_NAMES = ["Samantha", "Alex", "Ava", "Allison", "Daniel", "Karen", "Moira"];

let cachedVoices: ReadonlyArray<SpeechSynthesisVoice> = [];

export function listSpeechVoices(): ReadonlyArray<SpeechSynthesisVoice> {
  return cachedVoices;
}

/** Voices load asynchronously; subscribers hear when the list arrives or changes. */
export function subscribeSpeechVoices(onChange: () => void): () => void {
  if (typeof speechSynthesis === "undefined") return () => {};
  const refresh = () => {
    cachedVoices = speechSynthesis.getVoices();
    onChange();
  };
  speechSynthesis.addEventListener("voiceschanged", refresh);
  refresh();
  return () => speechSynthesis.removeEventListener("voiceschanged", refresh);
}

function resolveVoice(voiceURI: string): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices();
  if (voiceURI) {
    const chosen = voices.find((voice) => voice.voiceURI === voiceURI);
    if (chosen) return chosen;
  }
  const flagged = voices.find((voice) => voice.default);
  if (flagged) return flagged;
  const language = (navigator.language || "en").split("-")[0]!;
  const local = voices.filter((voice) => voice.lang.startsWith(language));
  for (const name of PREFERRED_VOICE_NAMES) {
    const match = local.find((voice) => voice.name.startsWith(name));
    if (match) return match;
  }
  return undefined;
}

const webSpeechProvider: NotificationSpeechProvider = {
  available: () => typeof speechSynthesis !== "undefined",
  speak: (text, voice) =>
    new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      const resolved = resolveVoice(voice);
      if (resolved) {
        utterance.voice = resolved;
        utterance.lang = resolved.lang;
      }
      // Chromium can drop `end` events; never let one stuck utterance block the queue.
      const fallback = setTimeout(resolve, 15_000);
      const done = () => {
        clearTimeout(fallback);
        resolve();
      };
      utterance.onend = done;
      utterance.onerror = done;
      speechSynthesis.speak(utterance);
    }),
};

const provider: NotificationSpeechProvider = webSpeechProvider;

export function canSpeakNotifications() {
  return provider.available();
}

const MAX_TITLE_CHARS = 60;
const MAX_QUEUED = 3;

/** Cuts long titles at a word boundary so the announcement stays short. */
function spokenThreadTitle(title: string): string {
  const clean = title.replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_TITLE_CHARS) return clean || "Thread";
  const cut = clean.slice(0, MAX_TITLE_CHARS);
  const space = cut.lastIndexOf(" ");
  return (space > MAX_TITLE_CHARS / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:-]+$/, "");
}

/** `status` is the sidebar status that raised an input alert; completions pass "completion". */
export function threadSpeechText(title: string, status: string): string {
  const subject = spokenThreadTitle(title);
  switch (status) {
    case "completion":
      return `${subject} complete`;
    case "approval":
      return `${subject} needs approval`;
    case "failed":
      return `${subject} failed`;
    case "limited":
      return `${subject} hit a usage limit`;
    default:
      return `${subject} needs your input`;
  }
}

// Announcements play one after another; bursts beyond the cap and repeats already waiting are dropped.
const queue: Array<{ readonly text: string; readonly voice: string }> = [];
let draining = false;

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const next = queue[0]!;
      await provider.speak(next.text, next.voice);
      queue.shift();
    }
  } finally {
    draining = false;
  }
}

export function speakNotification(text: string, voice = "") {
  if (!provider.available() || queue.length >= MAX_QUEUED) return;
  if (queue.some((entry) => entry.text === text)) return;
  queue.push({ text, voice });
  void drain();
}
