import { describe, expect, it } from "vite-plus/test";

import { addMilestone, setTaskMilestone } from "./milestones.logic";
import { addTask, makeTask, setTaskStatus, type TaskBoard } from "./taskBoard.logic";
import { matchTaskMentions, taskMentionText } from "./taskMentions.logic";

const NOW = "2026-11-22T10:00:00.000Z";
const LATER = "2026-11-22T11:00:00.000Z";

function board(): TaskBoard {
  let next: TaskBoard = { version: 1, items: [] };
  next = addTask(next, null, { ...makeTask("ThaiLookup", "you", NOW), id: "p1" });
  next = addTask(next, "p1", { ...makeTask("Sitemap for phrases", "you", NOW), id: "a" });
  next = addTask(next, "p1", { ...makeTask("Hero section", "you", LATER), id: "b" });
  next = addTask(next, "a", { ...makeTask("Submit to Search Console", "you", NOW), id: "a1" });
  next = addTask(next, null, { ...makeTask("RentaBus", "you", NOW), id: "p2" });
  next = addTask(next, "p2", {
    ...makeTask("Fix booking email", "you", NOW),
    id: "r",
    status: "waiting",
  });
  return next;
}

describe("matchTaskMentions", () => {
  it("lists open tasks, waiting first, then newest, with where they are", () => {
    let next = addMilestone(board(), "p1", { name: "SEO 2" }, NOW).board;
    next = setTaskMilestone(next, "a", next.items[0]!.milestones![0]!.id, NOW);
    next = setTaskStatus(next, "b", "done", LATER);
    expect(matchTaskMentions(next, "")).toEqual([
      { id: "r", text: "Fix booking email", where: "RentaBus", status: "waiting" },
      { id: "a", text: "Sitemap for phrases", where: "ThaiLookup · SEO 2", status: "active" },
      {
        id: "a1",
        text: "Submit to Search Console",
        where: "ThaiLookup › Sitemap for phrases",
        status: "active",
      },
    ]);
  });

  it("matches every word across text, project and milestone", () => {
    let next = addMilestone(board(), "p1", { name: "SEO 2" }, NOW).board;
    next = setTaskMilestone(next, "b", next.items[0]!.milestones![0]!.id, NOW);
    expect(matchTaskMentions(next, "seo hero").map((m) => m.id)).toEqual(["b"]);
    expect(matchTaskMentions(next, "rentabus").map((m) => m.id)).toEqual(["r"]);
    expect(matchTaskMentions(next, "nothing like this")).toEqual([]);
    expect(matchTaskMentions(next, "", 1)).toHaveLength(1);
  });

  it("puts the id in the message text", () => {
    expect(taskMentionText({ id: "a", text: "Sitemap for phrases" })).toBe(
      "[task a: Sitemap for phrases]",
    );
  });
});
