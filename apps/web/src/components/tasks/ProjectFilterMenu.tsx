import { T, useGT } from "gt-react";
import { FolderGit2Icon, LayersIcon } from "lucide-react";
import { use, useState } from "react";

import { ProjectFavicon } from "~/components/ProjectFavicon";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuSearchInput,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";

import type { TaskBoard } from "./taskBoard.logic";
import { TaskProjectIconsContext } from "./TaskProjectIcon";

/**
 * Picks which board projects the List and Board show, laid out like the Projects filter on the
 * Issues page: "Show all", then a checkbox per project. It keeps the hidden ids, so a new
 * project shows up without being picked.
 */
export function ProjectFilterMenu({
  board,
  hidden,
  onChange,
}: {
  board: TaskBoard;
  hidden: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
}) {
  const icons = use(TaskProjectIconsContext);
  const [query, setQuery] = useState("");
  const gt = useGT();
  if (board.items.length < 2) return null;
  const shown = board.items.filter((project) => !hidden.has(project.id));
  const allShown = shown.length === board.items.length;
  const label = allShown
    ? gt("All projects")
    : shown.length === 1
      ? shown[0]!.text
      : shown.length === 0
        ? gt("No projects")
        : gt("{count, plural, one {{count} project} other {{count} projects}}", {
            count: shown.length,
          });
  const needle = query.trim().toLowerCase();
  const visible = board.items.filter(
    (project) => needle.length === 0 || project.text.toLowerCase().includes(needle),
  );
  const toggle = (id: string, show: boolean) => {
    const next = new Set(hidden);
    if (show) next.delete(id);
    else next.add(id);
    onChange(next);
  };
  return (
    <Menu onOpenChange={(open) => !open && setQuery("")}>
      <MenuTrigger
        render={
          <Button
            size="compact"
            variant={allShown ? "ghost" : "secondary"}
            aria-label={gt("Filter by project")}
          />
        }
      >
        <FolderGit2Icon />
        <span className="max-w-40 truncate">{label}</span>
      </MenuTrigger>
      <MenuPopup align="end">
        {board.items.length > 8 ? (
          <MenuSearchInput
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={gt("Search projects")}
            aria-label={gt("Search projects")}
          />
        ) : null}
        <MenuCheckboxItem
          checked={allShown}
          closeOnClick={false}
          onCheckedChange={(on) =>
            onChange(on ? new Set() : new Set(board.items.map((project) => project.id)))
          }
        >
          <span className="flex min-w-0 items-center gap-2">
            <LayersIcon aria-hidden className="size-3.5" />
            <span className="min-w-0 flex-1 truncate">
              <T>Show all</T>
            </span>
          </span>
        </MenuCheckboxItem>
        <MenuSeparator />
        {visible.length === 0 ? (
          <MenuItem disabled>
            <T>No matching projects.</T>
          </MenuItem>
        ) : null}
        {visible.map((project) => {
          const appProject = icons.get(project.text);
          return (
            <MenuCheckboxItem
              key={project.id}
              checked={!hidden.has(project.id)}
              closeOnClick={false}
              onCheckedChange={(on) => toggle(project.id, Boolean(on))}
            >
              <span className="flex min-w-0 items-center gap-2">
                {appProject ? (
                  <ProjectFavicon project={appProject} className="size-3.5 shrink-0" />
                ) : (
                  <FolderGit2Icon aria-hidden className="size-3.5 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">{project.text}</span>
              </span>
            </MenuCheckboxItem>
          );
        })}
      </MenuPopup>
    </Menu>
  );
}
