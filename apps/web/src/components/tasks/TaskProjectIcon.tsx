import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { createContext, use } from "react";

import { ProjectFavicon } from "~/components/ProjectFavicon";
import { cn } from "~/lib/utils";
import { useProjects, useQuietThreadShells } from "~/state/entities";

import { boardProjectKeys, type TaskItem } from "./taskBoard.logic";

const NO_ICONS: ReadonlyMap<string, EnvironmentProject> = new Map();

/** Board project name → the app project whose icon it shows, for the whole Tasks page. */
export const TaskProjectIconsContext =
  createContext<ReadonlyMap<string, EnvironmentProject>>(NO_ICONS);

/**
 * Matches each board project to an app project (by name, else through its chats), so the Tasks
 * page shows the same icon the sidebar does.
 */
export function useTaskProjectIcons(
  projects: ReadonlyArray<TaskItem>,
): ReadonlyMap<string, EnvironmentProject> {
  const appProjects = useProjects();
  const shells = useQuietThreadShells();
  const byKey = new Map<string, EnvironmentProject>(
    appProjects.map((project) => [`${project.environmentId}:${project.id}`, project]),
  );
  const projectOfChat = new Map(
    shells.map(
      (shell) =>
        [
          `${shell.environmentId}:${shell.id}`,
          `${shell.environmentId}:${shell.projectId}`,
        ] as const,
    ),
  );
  const projectByName = new Map(
    appProjects.map(
      (project) =>
        [project.title.trim().toLowerCase(), `${project.environmentId}:${project.id}`] as const,
    ),
  );
  const result = new Map<string, EnvironmentProject>();
  for (const [name, key] of boardProjectKeys(projects, projectOfChat, projectByName)) {
    const project = byKey.get(key);
    if (project) result.set(name, project);
  }
  return result;
}

/** The project's icon, as in the sidebar; nothing when the board project matches no app project. */
export function TaskProjectIcon({ name, className }: { name: string; className?: string }) {
  const project = use(TaskProjectIconsContext).get(name);
  if (!project) return null;
  return <ProjectFavicon project={project} className={cn("size-3.5 shrink-0", className)} />;
}
