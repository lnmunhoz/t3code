import {
  EnvironmentId,
  type PreviewSessionSnapshot,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { pinnedTabsForThread } from "./pinnedTabs.logic";

const env = EnvironmentId.make("env");
const place = (id: string, projectId: string, environmentId = env) => ({
  environmentId,
  id: ThreadId.make(id),
  projectId: ProjectId.make(projectId),
});
const tab = (threadId: string, tabId: string, pinned?: boolean): PreviewSessionSnapshot => ({
  threadId,
  tabId,
  navStatus: { _tag: "Idle" as const },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-11-23T00:00:00.000Z",
  ...(pinned === undefined ? {} : { pinned }),
});

describe("pinnedTabsForThread", () => {
  it("returns tabs other threads of the same project pinned", () => {
    const shells = [place("a", "p1"), place("b", "p1"), place("c", "p2")];
    const sessions = [
      tab("a", "pinned-in-a", true),
      tab("a", "plain-in-a"),
      tab("b", "own-pin", true),
      tab("c", "other-project", true),
      tab("gone", "unknown-thread", true),
    ];
    expect(
      pinnedTabsForThread(sessions, shells, place("b", "p1")).map((pin) => [
        pin.ownerThreadId,
        pin.tabId,
      ]),
    ).toEqual([["a", "pinned-in-a"]]);
  });
});
