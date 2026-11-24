import {
  ArchiveComboScale,
  ArchiveComboVoice,
  type ArchiveComboSoundSettings as ComboSettings,
} from "@t3tools/contracts";
import { msg, T, useGT, useMessages } from "gt-react";
import { PlayIcon } from "lucide-react";
import type { ReactNode } from "react";

import { previewArchiveCombo } from "../../archiveComboSound";
import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

const VOICE_LABELS = {
  chime: "Completion chime",
  coin: "Coin",
  pop: "Pop",
} satisfies Record<ComboSettings["voice"], string>;
const SCALE_LABELS = {
  pentatonic: "Pentatonic",
  major: "Major",
  chromatic: "Chromatic",
} satisfies Record<ComboSettings["scale"], string>;
const VOLUMES = [25, 50, 75, 100];
const SPEEDS = [
  { stepMs: 260, label: msg("Relaxed", { $context: "combo sound speed" }) },
  { stepMs: 160, label: msg("Normal", { $context: "combo sound speed" }) },
  { stepMs: 100, label: msg("Fast", { $context: "combo sound speed" }) },
  { stepMs: 70, label: msg("Frantic", { $context: "combo sound speed" }) },
];

function save(next: ComboSettings, preview = true) {
  void updateClientSettings({ archiveComboSound: next });
  if (preview && next.enabled) previewArchiveCombo(next);
}

function ComboSelect(props: {
  label: string;
  value: string;
  display: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      value={props.value}
      onValueChange={(value) => {
        if (value !== null) props.onChange(value);
      }}
    >
      <SelectTrigger size="sm" className="w-full sm:w-44" aria-label={props.label}>
        <SelectValue>{props.display}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {props.options.map((option) => (
          <SelectItem key={option.value} hideIndicator value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function NestedRow(props: { title: string; description: string; control: ReactNode }) {
  return <SettingsRow className="px-0 py-2 sm:px-0" {...props} />;
}

/** The game-style combo sound played while the sidebar card archives idle threads. */
export function ArchiveComboSoundSettings() {
  const searchableSetting = useSearchableSetting();
  const settings = useClientSettings((current) => current.archiveComboSound);
  const gt = useGT();
  const m = useMessages();
  const speed = SPEEDS.find((entry) => entry.stepMs === settings.stepMs);
  const speedLabel = speed ? m(speed.label) : `${settings.stepMs} ms`;
  return (
    <SettingsRow
      {...searchableSetting("archive-combo-sound")}
      description={gt(
        "Archiving idle threads from the sidebar card plays a sound that climbs with each thread, like a combo in a game.",
      )}
      control={
        <div className="flex items-center gap-2">
          <Button
            size="xs"
            variant="outline"
            onClick={() => previewArchiveCombo(settings)}
            aria-label={gt("Preview combo sound")}
          >
            <PlayIcon />
            <T context="verb, plays the sound">Preview</T>
          </Button>
          <Switch
            checked={settings.enabled}
            onCheckedChange={(checked) =>
              save({ ...settings, enabled: Boolean(checked) }, Boolean(checked))
            }
            aria-label={gt("Archive combo sound")}
          />
        </div>
      }
    >
      {settings.enabled ? (
        <div className="mt-2 mb-2 border-l-2 border-border/60 ps-3">
          <NestedRow
            title={gt("Sound")}
            description={gt("The completion chime pitched up, or a synthesized coin or pop.")}
            control={
              <ComboSelect
                label={gt("Combo sound")}
                value={settings.voice}
                display={VOICE_LABELS[settings.voice]}
                options={ArchiveComboVoice.literals.map((voice) => ({
                  value: voice,
                  label: VOICE_LABELS[voice],
                }))}
                onChange={(value) => {
                  const voice = ArchiveComboVoice.literals.find((literal) => literal === value);
                  if (voice) save({ ...settings, voice });
                }}
              />
            }
          />
          <NestedRow
            title={gt("Volume")}
            description={gt("Separate from notification sounds.")}
            control={
              <ComboSelect
                label={gt("Combo volume")}
                value={String(settings.volume)}
                display={`${settings.volume}%`}
                options={VOLUMES.map((volume) => ({ value: String(volume), label: `${volume}%` }))}
                onChange={(value) => save({ ...settings, volume: Number(value) })}
              />
            }
          />
          <NestedRow
            title={gt("Scale")}
            description={gt(
              "The notes each hit climbs through. Long combos hold at two octaves up.",
            )}
            control={
              <ComboSelect
                label={gt("Combo scale")}
                value={settings.scale}
                display={SCALE_LABELS[settings.scale]}
                options={ArchiveComboScale.literals.map((scale) => ({
                  value: scale,
                  label: SCALE_LABELS[scale],
                }))}
                onChange={(value) => {
                  const scale = ArchiveComboScale.literals.find((literal) => literal === value);
                  if (scale) save({ ...settings, scale });
                }}
              />
            }
          />
          <NestedRow
            title={gt("Speed")}
            description={gt("Time between archives. It speeds up as the combo grows.")}
            control={
              <ComboSelect
                label={gt("Combo speed")}
                value={String(settings.stepMs)}
                display={speedLabel}
                options={SPEEDS.map((speed) => ({
                  value: String(speed.stepMs),
                  label: m(speed.label),
                }))}
                onChange={(value) => save({ ...settings, stepMs: Number(value) })}
              />
            }
          />
          <NestedRow
            title={gt("Finishing chord")}
            description={gt("Play the last archive as a bright chord instead of a single note.")}
            control={
              <Switch
                checked={settings.finale}
                onCheckedChange={(checked) => save({ ...settings, finale: Boolean(checked) })}
                aria-label={gt("Finishing chord")}
              />
            }
          />
        </div>
      ) : null}
    </SettingsRow>
  );
}
