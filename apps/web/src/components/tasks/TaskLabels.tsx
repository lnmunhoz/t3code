import { T, useGT, Var } from "gt-react";
import { TagIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuSearchInput,
  MenuTrigger,
} from "~/components/ui/menu";
import { cn } from "~/lib/utils";

import { normalizeLabels, setTaskLabels, type TaskItem } from "./taskBoard.logic";
import { changeTaskBoard } from "./taskBoardStore";

const DOTS = [
  "bg-sky-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-teal-500",
  "bg-orange-500",
  "bg-fuchsia-500",
] as const;

/** The same label always gets the same color. */
function labelDot(label: string): string {
  let hash = 0;
  for (const char of label) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return DOTS[Math.abs(hash) % DOTS.length]!;
}

function LabelChip({ label }: { label: string }) {
  return (
    <span className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border px-2 text-muted-foreground text-xs">
      <span aria-hidden className={cn("size-1.5 rounded-full", labelDot(label))} />
      {label}
    </span>
  );
}

const MAX_CHIPS = 3;

/** A task's labels as chips, three at most and "+N" for the rest. */
export function LabelChips({ labels }: { labels: ReadonlyArray<string> | undefined }) {
  if (!labels || labels.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {labels.slice(0, MAX_CHIPS).map((label) => (
        <LabelChip key={label} label={label} />
      ))}
      {labels.length > MAX_CHIPS ? (
        <span className="inline-flex h-5 items-center rounded-full border px-2 text-muted-foreground text-xs">
          +{labels.length - MAX_CHIPS}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Puts labels on a task or takes them off. `known` are the labels already used nearby; typing a
 * new name and pressing Enter adds it.
 */
export function LabelMenu({
  task,
  known,
  className,
}: {
  task: TaskItem;
  known: ReadonlyArray<string>;
  /** For the wrapper, such as showing it only while the row is hovered. */
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const gt = useGT();
  const own = task.labels ?? [];
  const choices = [...new Set([...own, ...known])];
  const needle = query.trim().toLowerCase();
  const visible = choices.filter((label) => label.includes(needle));
  const save = (labels: ReadonlyArray<string>) =>
    void changeTaskBoard((board) =>
      setTaskLabels(board, task.id, labels, new Date().toISOString()),
    );
  const isNew = needle.length > 0 && !choices.includes(normalizeLabels([needle])[0] ?? "");
  return (
    <Menu onOpenChange={(open) => !open && setQuery("")}>
      <span className={className}>
        <MenuTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={own.length > 0 ? gt("Change labels") : gt("Add a label")}
            />
          }
        >
          <TagIcon />
        </MenuTrigger>
      </span>
      <MenuPopup align="end" className="min-w-48">
        <MenuSearchInput
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || needle.length === 0) return;
            event.preventDefault();
            if (!own.includes(needle)) save([...own, needle]);
            setQuery("");
          }}
          placeholder={gt("Find or add a label")}
          aria-label={gt("Find or add a label")}
        />
        {isNew ? (
          <MenuItem
            closeOnClick={false}
            onClick={() => {
              save([...own, needle]);
              setQuery("");
            }}
          >
            <T>
              Add “<Var>{needle}</Var>”
            </T>
          </MenuItem>
        ) : null}
        {visible.map((label) => (
          <MenuCheckboxItem
            key={label}
            checked={own.includes(label)}
            closeOnClick={false}
            onCheckedChange={(on) =>
              save(on ? [...own, label] : own.filter((name) => name !== label))
            }
          >
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden className={cn("size-2 shrink-0 rounded-full", labelDot(label))} />
              <span className="min-w-0 truncate">{label}</span>
            </span>
          </MenuCheckboxItem>
        ))}
        {choices.length === 0 && !isNew ? (
          <MenuItem disabled>
            <T>Type a name, then Enter.</T>
          </MenuItem>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
