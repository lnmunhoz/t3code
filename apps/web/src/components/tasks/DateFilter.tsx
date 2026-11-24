import { msg, useGT, useMessages } from "gt-react";
import { CalendarIcon, XIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { Calendar } from "~/components/ui/calendar";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { useNowMinute } from "~/hooks/useNowMinute";

import {
  dayRangeWindow,
  periodWindow,
  type QuestionPeriod,
  type TimeWindow,
} from "./taskQuestions.logic";

const PERIODS: ReadonlyArray<{ value: QuestionPeriod; label: string }> = [
  { value: "today", label: msg("Today") },
  { value: "3d", label: msg("3 days") },
  { value: "7d", label: msg("7 days") },
  { value: "all", label: msg("All", { $context: "time period, everything" }) },
];

interface DayRange {
  readonly from: Date;
  readonly to?: Date | undefined;
}

interface DateFilterChoice {
  readonly period: QuestionPeriod;
  readonly range: DayRange | null;
}

// Each view's choice, remembered while the app runs, so coming back keeps the same dates.
const remembered = new Map<string, DateFilterChoice>();

const shortDay = (date: Date) => date.toLocaleDateString([], { month: "short", day: "numeric" });

function rangeLabel(range: DayRange): string {
  if (!range.to || range.to.toDateString() === range.from.toDateString()) {
    return shortDay(range.from);
  }
  return `${shortDay(range.from)} – ${shortDay(range.to)}`;
}

export interface DateFilterState extends DateFilterChoice {
  /** The window to filter by, or null for everything. */
  readonly timeWindow: TimeWindow | null;
  readonly nowMs: number;
  readonly setPeriod: (period: QuestionPeriod) => void;
  readonly setRange: (range: DayRange | null) => void;
}

/** A date filter (Today, 3 days, 7 days, All, or picked days) remembered per view. */
export function useDateFilter(key: string): DateFilterState {
  const [choice, setChoice] = useState<DateFilterChoice>(
    () => remembered.get(key) ?? { period: "all", range: null },
  );
  const update = (next: DateFilterChoice) => {
    remembered.set(key, next);
    setChoice(next);
  };
  // The minute clock is UTC without a zone mark ("2026-11-22T08:52").
  const nowMs = Date.parse(`${useNowMinute()}:00Z`);
  return {
    ...choice,
    nowMs,
    timeWindow: choice.range
      ? dayRangeWindow(choice.range.from, choice.range.to)
      : periodWindow(choice.period, nowMs),
    setPeriod: (period) => update({ period, range: null }),
    setRange: (range) => update({ period: choice.period, range }),
  };
}

/** The filter's row: quick periods, a calendar for a day range, and a count on the right. */
export function DateFilterBar({ filter, count }: { filter: DateFilterState; count?: ReactNode }) {
  const gt = useGT();
  const m = useMessages();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const { range } = filter;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ToggleGroup
        aria-label={gt("When")}
        variant="segmented"
        value={range ? [] : [filter.period]}
        onValueChange={(next) => {
          const value = next[0] as QuestionPeriod | undefined;
          if (value) filter.setPeriod(value);
        }}
      >
        {PERIODS.map((option) => (
          <Toggle key={option.value} value={option.value}>
            {m(option.label)}
          </Toggle>
        ))}
      </ToggleGroup>
      <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
        <PopoverTrigger
          render={
            <Button
              size="compact"
              variant={range ? "secondary" : "ghost"}
              aria-label={gt("Pick dates")}
            />
          }
        >
          <CalendarIcon />
          {range ? rangeLabel(range) : gt("Pick dates")}
        </PopoverTrigger>
        <PopoverPopup align="start" aria-label={gt("Pick dates")}>
          <Calendar
            mode="range"
            selected={range ? { from: range.from, to: range.to } : undefined}
            {...(range ? { defaultMonth: range.from } : {})}
            disabled={{ after: new Date(filter.nowMs) }}
            onSelect={(selected) => {
              if (!selected?.from) return filter.setRange(null);
              filter.setRange({ from: selected.from, to: selected.to });
              if (selected.to && selected.to.getTime() !== selected.from.getTime()) {
                setCalendarOpen(false);
              }
            }}
          />
        </PopoverPopup>
      </Popover>
      {range ? (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={gt("Clear dates")}
          onClick={() => filter.setRange(null)}
        >
          <XIcon />
        </Button>
      ) : null}
      {count !== undefined ? (
        <span className="ms-auto text-muted-foreground text-xs tabular-nums">{count}</span>
      ) : null}
    </div>
  );
}
