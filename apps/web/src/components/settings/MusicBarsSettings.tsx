import {
  DEFAULT_MUSIC_BARS,
  MUSIC_BARS_BOUNDS,
  type MusicBarsSettings as MusicBarsLook,
} from "@t3tools/contracts";
import { msg, T, useGT, useMessages } from "gt-react";
import { useState, type CSSProperties } from "react";

import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow } from "./settingsLayout";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

type NumericKey = keyof typeof MUSIC_BARS_BOUNDS;

const SLIDERS: ReadonlyArray<{
  key: NumericKey;
  title: string;
  description: string;
  step: number;
  format: (value: number) => string;
}> = [
  {
    key: "sensitivity",
    title: msg("Sensitivity"),
    description: msg("How far the bars move for the same music."),
    step: 5,
    format: (value) => `${value}%`,
  },
  {
    key: "reach",
    title: msg("Reach"),
    description: msg("How far into the window the tallest bar goes."),
    step: 4,
    format: (value) => `${value}px`,
  },
  {
    key: "visibility",
    title: msg("Visibility"),
    description: msg("How solid the bars look over the app."),
    step: 5,
    format: (value) => `${value}%`,
  },
  {
    key: "falloffMs",
    title: msg("Falloff"),
    description: msg("How slowly the bars sink after a beat. Peaks always land at once."),
    step: 10,
    format: (value) => `${value}ms`,
  },
  {
    key: "density",
    title: msg("Bar density"),
    description: msg("How many bars fill the edge."),
    step: 10,
    format: (value) => `${value}`,
  },
];

/** Where the music bars sit and how they move, shown under the Music bars switch. */
export function MusicBarsLookSettings() {
  const look = useScopedSettings().musicBars;
  const updateSettings = useUpdateScopedSettings();
  const gt = useGT();
  const m = useMessages();
  const update = (patch: Partial<MusicBarsLook>) =>
    updateSettings({ musicBars: { ...look, ...patch } });
  const isDefault = (Object.keys(DEFAULT_MUSIC_BARS) as (keyof MusicBarsLook)[]).every(
    (key) => look[key] === DEFAULT_MUSIC_BARS[key],
  );

  return (
    <div className="mt-2 mb-2 border-l-2 border-border/60 ps-3">
      <MusicMeterAccessRow />
      <SettingsRow
        title={gt("Position")}
        className="px-0 py-2 sm:px-0"
        description={gt("Down the left edge, or along the bottom of the window.")}
        control={
          <div className="w-full sm:w-40">
            <Select
              value={look.position}
              onValueChange={(value) => {
                if (value === "left" || value === "bottom") update({ position: value });
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full min-w-0"
                aria-label={gt("Music bars position")}
              >
                <SelectValue>
                  {look.position === "left"
                    ? gt("Left edge")
                    : gt("Bottom", { $context: "position, along the bottom of the window" })}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem value="left">
                  <T>Left edge</T>
                </SelectItem>
                <SelectItem value="bottom">
                  <T context="position, along the bottom of the window">Bottom</T>
                </SelectItem>
              </SelectPopup>
            </Select>
          </div>
        }
      />
      {SLIDERS.map(({ key, title, description, step, format }) => {
        const { min, max } = MUSIC_BARS_BOUNDS[key];
        const ratio = (look[key] - min) / (max - min);
        const id = `music-bars-${key}`;
        return (
          <SettingsRow
            key={key}
            title={m(title)}
            className="px-0 py-2 sm:px-0"
            description={m(description)}
            control={
              <div className="flex w-full items-center gap-3 sm:w-52">
                <output
                  className="min-w-14 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                  htmlFor={id}
                >
                  {format(look[key])}
                </output>
                <input
                  aria-label={m(title)}
                  className="settings-slider min-w-0 flex-1"
                  id={id}
                  max={max}
                  min={min}
                  step={step}
                  type="range"
                  value={look[key]}
                  style={
                    {
                      "--settings-slider-progress": `${ratio * 100}%`,
                      "--settings-slider-fill-offset": `${0.5 - ratio}rem`,
                    } as CSSProperties
                  }
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (Number.isInteger(value) && value >= min && value <= max) {
                      update({ [key]: value });
                    }
                  }}
                />
              </div>
            }
          />
        );
      })}
      <div className="flex justify-end py-2">
        <Button
          size="xs"
          variant="outline"
          disabled={isDefault}
          onClick={() => updateSettings({ musicBars: DEFAULT_MUSIC_BARS })}
        >
          <T>Reset to defaults</T>
        </Button>
      </div>
    </div>
  );
}

const ACCESS_MESSAGES = {
  granted: "Allowed. The bars should start in a moment.",
  denied:
    "Not allowed. In System Settings › Privacy & Security › Microphone, turn on t3-audio-meter.",
  unavailable: "The music meter isn't built on this machine.",
} as const;

/** macOS only asks once, and only when asked in front: this button shows that prompt on demand. */
function MusicMeterAccessRow() {
  const request = window.desktopBridge?.requestMusicMeterAccess;
  const [state, setState] = useState<"idle" | "asking" | keyof typeof ACCESS_MESSAGES>("idle");
  const gt = useGT();
  if (!request) return null;
  return (
    <SettingsRow
      title={gt("Audio access")}
      className="px-0 py-2 sm:px-0"
      description={
        state === "idle" || state === "asking"
          ? gt(
              "macOS calls it Microphone access for t3-audio-meter. It only measures Spotify and Apple Music and keeps no audio.",
            )
          : ACCESS_MESSAGES[state]
      }
      control={
        <Button
          size="xs"
          variant="outline"
          disabled={state === "asking"}
          onClick={() => {
            setState("asking");
            void request().then(setState, () => setState("denied"));
          }}
        >
          {state === "asking" ? gt("Waiting for macOS…") : gt("Allow audio access")}
        </Button>
      }
    />
  );
}
