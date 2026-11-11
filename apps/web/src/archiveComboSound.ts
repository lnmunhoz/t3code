import type { ArchiveComboSoundSettings } from "@t3tools/contracts";

import completionUrl from "./assets/notification-completion.mp3";

const SCALE_DEGREES = {
  pentatonic: [0, 2, 4, 7, 9],
  major: [0, 2, 4, 5, 7, 9, 11],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
} satisfies Record<ArchiveComboSoundSettings["scale"], ReadonlyArray<number>>;
// Past two octaves the chime turns into a squeak, so long combos hold the top note.
const MAX_COMBO_SEMITONES = 24;
// The last hit layers a major chord on its note, so the finish stays one sound.
const FINISH_CHORD_INTERVALS = [4, 7];
// notification-completion.mp3 strikes twice; starting at the second strike makes one ding per thread.
const CHIME_SECOND_STRIKE_S = 0.064;

function comboSemitones(step: number, scale: ArchiveComboSoundSettings["scale"]): number {
  const degrees = SCALE_DEGREES[scale];
  const octave = Math.floor(step / degrees.length);
  return Math.min(octave * 12 + degrees[step % degrees.length]!, MAX_COMBO_SEMITONES);
}

/** Pause before the next archive in a combo; the pace picks up as the combo grows. */
export function comboStepDelayMs(stepMs: number, step: number): number {
  return Math.round(stepMs * Math.max(0.55, 1 - step * 0.05));
}

let audioContext: AudioContext | undefined;
let chimeBuffer: Promise<AudioBuffer> | undefined;

function loadChime(context: AudioContext): Promise<AudioBuffer> {
  chimeBuffer ??= fetch(completionUrl)
    .then((response) => response.arrayBuffer())
    .then((data) => context.decodeAudioData(data))
    .catch((error: unknown) => {
      chimeBuffer = undefined;
      throw error;
    });
  return chimeBuffer;
}

export interface ArchiveComboPlayer {
  /**
   * One sound for one archived thread; `step` counts up from 0 within the current streak.
   * `last` marks the combo's final archive, which gets the finishing chord when enabled.
   */
  readonly hit: (step: number, last: boolean) => void;
}

/**
 * Call from the click that starts the combo: browsers only let audio start from a gesture.
 * Returns null when the sound is off.
 */
export function createArchiveComboPlayer(
  settings: ArchiveComboSoundSettings,
): ArchiveComboPlayer | null {
  if (!settings.enabled || settings.volume === 0) return null;
  audioContext ??= new AudioContext();
  const context = audioContext;
  void context.resume().catch(() => undefined);
  const master = context.createGain();
  // Squared so the volume steps sound even to the ear.
  master.gain.value = (settings.volume / 100) ** 2;
  master.connect(context.destination);
  const chime = settings.voice === "chime" ? loadChime(context) : null;
  void chime?.catch(() => undefined);
  let previous: GainNode | null = null;

  const play = (semitones: number, at: number, cutPrevious: boolean, level = 1) => {
    // Overlapping chimes turn to mush at combo speed; each hit fades out the last.
    if (cutPrevious && previous !== null) {
      previous.gain.cancelScheduledValues(at);
      previous.gain.setTargetAtTime(0, at, 0.03);
    }
    const voice = context.createGain();
    voice.connect(master);
    previous = voice;
    const ratio = 2 ** (semitones / 12);
    if (chime !== null) {
      void chime
        .then((buffer) => {
          const start = Math.max(at, context.currentTime);
          // A short ramp hides the first strike's leftover tail at the cut.
          voice.gain.setValueAtTime(0, start);
          voice.gain.linearRampToValueAtTime(0.9 * level, start + 0.004);
          const source = context.createBufferSource();
          source.buffer = buffer;
          source.playbackRate.value = ratio;
          source.connect(voice);
          source.start(start, CHIME_SECOND_STRIKE_S);
        })
        .catch(() => undefined);
      return;
    }
    const oscillator = context.createOscillator();
    const end = settings.voice === "coin" ? at + 0.22 : at + 0.16;
    if (settings.voice === "coin") {
      const frequency = 659 * ratio;
      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(frequency, at);
      oscillator.frequency.setValueAtTime(frequency * (4 / 3), at + 0.06);
      voice.gain.setValueAtTime(0.0001, at);
      voice.gain.exponentialRampToValueAtTime(0.22 * level, at + 0.005);
    } else {
      const frequency = 440 * ratio;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency * 0.6, at);
      oscillator.frequency.exponentialRampToValueAtTime(frequency, at + 0.05);
      voice.gain.setValueAtTime(0.0001, at);
      voice.gain.exponentialRampToValueAtTime(0.6 * level, at + 0.008);
    }
    voice.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(voice);
    oscillator.start(at);
    oscillator.stop(end + 0.02);
  };

  return {
    hit: (step, last) => {
      const root = comboSemitones(step, settings.scale);
      const at = context.currentTime;
      play(root, at, true);
      if (!last || !settings.finale) return;
      for (const interval of FINISH_CHORD_INTERVALS) play(root + interval, at, false, 0.5);
    },
  };
}

let previewTimers: ReturnType<typeof setTimeout>[] = [];

/** Plays a short combo with `settings`, replacing any preview still playing. */
export function previewArchiveCombo(settings: ArchiveComboSoundSettings, hits = 8) {
  for (const timer of previewTimers) clearTimeout(timer);
  previewTimers = [];
  const player = createArchiveComboPlayer({ ...settings, enabled: true });
  if (player === null) return;
  let at = 0;
  for (let step = 0; step < hits; step++) {
    previewTimers.push(setTimeout(() => player.hit(step, step === hits - 1), at));
    at += comboStepDelayMs(settings.stepMs, step);
  }
}
