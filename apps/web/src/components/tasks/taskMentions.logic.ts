import { milestoneOf } from "./milestones.logic";
import type { TaskBoard, TaskItem } from "./taskBoard.logic";

export interface TaskMention {
  readonly id: string;
  readonly text: string;
  /** "ThaiLookup", "ThaiLookup · SEO 2", or "ThaiLookup › Parent task". */
  readonly where: string;
  readonly status: TaskItem["status"];
}

/**
 * The board's open tasks for the composer's @ menu: those holding every word of `query` in their
 * text, note, project or milestone. Waiting on him first, then the most recently changed.
 */
export function matchTaskMentions(board: TaskBoard, query: string, limit = 8): TaskMention[] {
  const words = query.toLowerCase().split(/\s+/u).filter(Boolean);
  const found: Array<TaskMention & { readonly updatedAt: string }> = [];
  for (const project of board.items) {
    const visit = (task: TaskItem, parent: TaskItem | null) => {
      if (task.status !== "done") {
        const milestone = parent === null ? milestoneOf(project, task) : null;
        const where = parent
          ? `${project.text} › ${parent.text}`
          : milestone
            ? `${project.text} · ${milestone.name}`
            : project.text;
        const haystack = [task.text, task.note ?? "", where].join(" ").toLowerCase();
        if (words.every((word) => haystack.includes(word))) {
          found.push({
            id: task.id,
            text: task.text,
            where,
            status: task.status,
            updatedAt: task.updatedAt,
          });
        }
      }
      for (const child of task.children) visit(child, task);
    };
    for (const task of project.children) visit(task, null);
  }
  return found
    .toSorted(
      (a, b) =>
        Number(b.status === "waiting") - Number(a.status === "waiting") ||
        b.updatedAt.localeCompare(a.updatedAt),
    )
    .slice(0, limit)
    .map(({ updatedAt: _updatedAt, ...mention }) => mention);
}

/** What picking a task puts in the message: its id, so the agent can `tasks show` it. */
export function taskMentionText(mention: Pick<TaskMention, "id" | "text">): string {
  return `[task ${mention.id}: ${mention.text}]`;
}
