import {
  DEFAULT_CLIENT_SETTINGS,
  MAX_SIDEBAR_ARCHIVE_SUGGESTION_HOURS,
  MIN_SIDEBAR_ARCHIVE_SUGGESTION_HOURS,
} from "@t3tools/contracts";
import { useState } from "react";

import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const DEFAULT_HOURS = DEFAULT_CLIENT_SETTINGS.sidebarArchiveSuggestionHours ?? 12;

function IdleHoursInput({ value }: { value: number }) {
  const [draft, setDraft] = useState(String(value));
  const [draftSource, setDraftSource] = useState(value);
  if (draftSource !== value) {
    setDraftSource(value);
    setDraft(String(value));
  }
  return (
    <Input
      size="sm"
      type="number"
      min={MIN_SIDEBAR_ARCHIVE_SUGGESTION_HOURS}
      max={MAX_SIDEBAR_ARCHIVE_SUGGESTION_HOURS}
      className="w-full sm:w-24"
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        const parsed = Number(event.target.value);
        if (
          Number.isInteger(parsed) &&
          parsed >= MIN_SIDEBAR_ARCHIVE_SUGGESTION_HOURS &&
          parsed <= MAX_SIDEBAR_ARCHIVE_SUGGESTION_HOURS
        ) {
          void updateClientSettings({ sidebarArchiveSuggestionHours: parsed });
        }
      }}
      onBlur={() => setDraft(String(value))}
      aria-label="Hours idle before suggesting archive"
    />
  );
}

/** Device-local: the sidebar card that offers to archive threads idle past a threshold. */
export function ArchiveSuggestionSettings() {
  const hours = useClientSettings((settings) => settings.sidebarArchiveSuggestionHours);
  return (
    <>
      <SettingsRow
        {...searchableSetting("idle-archive-suggestions")}
        description="A card at the top of the sidebar offers to archive threads with no messages or runs for a while. It skips pinned and snoozed threads, the open thread, and work still running or waiting on you."
        resetAction={
          hours !== DEFAULT_CLIENT_SETTINGS.sidebarArchiveSuggestionHours ? (
            <SettingResetButton
              label="idle archive suggestions"
              onClick={() =>
                void updateClientSettings({
                  sidebarArchiveSuggestionHours:
                    DEFAULT_CLIENT_SETTINGS.sidebarArchiveSuggestionHours,
                })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={hours !== null}
            onCheckedChange={(checked) =>
              void updateClientSettings({
                sidebarArchiveSuggestionHours: checked ? DEFAULT_HOURS : null,
              })
            }
            aria-label="Suggest archiving idle threads"
          />
        }
      />
      {hours !== null ? (
        <SettingsRow
          title={searchableSetting("idle-archive-hours").title}
          description={`From ${MIN_SIDEBAR_ARCHIVE_SUGGESTION_HOURS} to ${MAX_SIDEBAR_ARCHIVE_SUGGESTION_HOURS} hours (30 days).`}
          control={<IdleHoursInput value={hours} />}
        />
      ) : null}
    </>
  );
}
