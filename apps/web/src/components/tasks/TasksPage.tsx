import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import {
  ArrowDownUpIcon,
  ChevronRightIcon,
  ClipboardCopyIcon,
  CoinsIcon,
  EllipsisIcon,
  EyeIcon,
  ListTodoIcon,
  MessageSquareIcon,
  MessagesSquareIcon,
  PictureInPicture2Icon,
  PlusIcon,
  ListTreeIcon,
  SquareKanbanIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "~/components/WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "~/components/WorkspacePageContainer";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";
import { SidebarInset } from "~/components/ui/sidebar";
import { Switch } from "~/components/ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { isElectron } from "~/env";
import { useNowMinute } from "~/hooks/useNowMinute";
import { persistClientSettingsPatch, useClientSettings } from "~/hooks/useSettings";
import { type MessageResolver } from "~/i18n/messages";
import { cn, isMacPlatform } from "~/lib/utils";
import { formatRelativeTime, formatRelativeTimeLabel } from "~/timestampFormat";
import {
  labelsIn,
  addTask,
  addTaskAfter,
  countOpenTasks,
  filterTasks,
  indentTask,
  isRecentlyDone,
  isStaleTask,
  makeTask,
  moveTask,
  outdentTask,
  projectForThread,
  removeTask,
  setTaskStatus,
  sortTasks,
  taskActivityAt,
  updateTask,
  type TaskBoard,
  type TaskItem,
  type TaskSort,
  type TaskStatus,
  type TaskThreadRef,
  type TaskLiveState,
  wasUpdatedSinceAdded,
} from "./taskBoard.logic";
import { changeTaskBoard, useTaskBoard } from "./taskBoardStore";
import { useTaskWatcherStatus } from "./taskWatcher";
import {
  formatTokens,
  formatUsd,
  summarizeTaskUsage,
  totalInputTokens,
  type TaskUsageRecord,
  type TaskUsageTotals,
} from "./taskUsage.logic";
import { useTaskUsage } from "./taskUsageStore";
import { DateFilterBar, useDateFilter } from "./DateFilter";
import { KanbanView } from "./KanbanView";
import { TaskProjectIcon, TaskProjectIconsContext, useTaskProjectIcons } from "./TaskProjectIcon";
import { LimitsBadge, LimitsView } from "./LimitsView";
import { canReadProxyLimits } from "./proxyLimitsStore";
import { ProjectQuestions, QuestionsView } from "./QuestionsView";
import { useTaskQuestions } from "./taskQuestionsStore";
import { TaskWorkingBadge, WorkingGlow, useTaskLiveStates } from "./TaskWorking";
import { DoneTodayButton, NowStrip, PinWindowButton } from "./NowStrip";
import {
  createMilestone,
  MilestoneDialog,
  MilestoneFilterMenu,
  MilestoneGroupHeader,
  MilestonesView,
  TaskMilestoneSubmenu,
} from "./Milestones";
import { filterByMilestones, milestoneGroups } from "./milestones.logic";
import { canPopOutTasks, isTasksPopout, popOutTasks, useOpenTaskThread } from "./tasksPopout";
import { PlanningChatColumn } from "./PlanningChat";
import { ProjectFilterMenu } from "./ProjectFilterMenu";
import { LabelChips, LabelMenu } from "./TaskLabels";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";

// Done items stay in view (struck through) for a day, so finishing something feels finished.
const KEEP_DONE_MS = 24 * 60 * 60 * 1000;

const agentPrompt = (filePath: string) =>
  `Update my T3 Code task board, the JSON file ${filePath}. Read it first and keep everything already there. Shape: {"version":1,"items":[...]}; each item is {"id","text","status":"active"|"waiting"|"review"|"done","note"?,"threads":[{"environmentId","threadId","title"}],"children":[...],"by":"agent"}. Top-level items are projects (name them after the T3 project); tasks and sub-tasks go in "children". New items can leave out "id" and the dates. Write the whole file back as valid JSON. Add the tasks I'm working on right now: `;

type TasksView = "tasks" | "milestones" | "questions" | "limits";
/** How the List view lays tasks out: the tree, or columns by state. */
type TaskLayout = "list" | "board";
type TaskShow = "all" | "working" | "waiting";
// Remembered while the app runs, like the view.
let lastShow: TaskShow = "all";
let lastSort: TaskSort = "board";
let lastLayout: TaskLayout = "list";
// Milestone ids (or "none") the List and Board show; empty shows all.
let lastMilestones: ReadonlySet<string> = new Set();
// Board project ids the List and Board leave out; empty shows every project. Kept across restarts.
const HIDDEN_PROJECTS_KEY = "t3code:tasks:hidden-projects";
let lastHiddenProjects: ReadonlySet<string> | null = null;

function readHiddenProjects(): ReadonlySet<string> {
  if (lastHiddenProjects) return lastHiddenProjects;
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(HIDDEN_PROJECTS_KEY) ?? "[]");
    lastHiddenProjects = new Set(
      Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : [],
    );
  } catch {
    lastHiddenProjects = new Set();
  }
  return lastHiddenProjects;
}

function writeHiddenProjects(hidden: ReadonlySet<string>): void {
  lastHiddenProjects = hidden;
  try {
    window.localStorage.setItem(HIDDEN_PROJECTS_KEY, JSON.stringify([...hidden]));
  } catch {
    // The filter still holds until the app restarts.
  }
}
const isMacPopout = typeof navigator !== "undefined" && isMacPlatform(navigator.platform);
// Remembered while the app runs, so coming back to the page keeps the view you left.
let lastView: TasksView = "tasks";

const PLANNING_OPEN_KEY = "t3code:tasks:planning-open";

function readPlanningOpen(): boolean {
  try {
    return window.localStorage.getItem(PLANNING_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writePlanningOpen(open: boolean): void {
  try {
    window.localStorage.setItem(PLANNING_OPEN_KEY, open ? "1" : "0");
  } catch {
    // Only the panel's open state is lost.
  }
}

export function TasksPage() {
  const gt = useGT();
  const { board, loaded, filePath } = useTaskBoard();
  const [view, setViewState] = useState<TasksView>(lastView);
  const setView = (next: TasksView) => {
    lastView = next;
    setViewState(next);
  };
  const watcherEnabled = useClientSettings((settings) => settings.taskWatcherEnabled);
  const [planningOpen, setPlanningOpenState] = useState(readPlanningOpen);
  const setPlanningOpen = (open: boolean) => {
    writePlanningOpen(open);
    setPlanningOpenState(open);
  };
  const [showDone, setShowDone] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showUsage, setShowUsage] = useState(false);
  const openCount = countOpenTasks(board.items.flatMap((project) => project.children));
  const dateFilter = useDateFilter("tasks");
  const live = useTaskLiveStates(board.items);
  const projectIcons = useTaskProjectIcons(board.items);
  const [show, setShowState] = useState<TaskShow>(lastShow);
  const setShow = (next: TaskShow) => {
    lastShow = next;
    setShowState(next);
  };
  const [layout, setLayoutState] = useState<TaskLayout>(lastLayout);
  const setLayout = (next: TaskLayout) => {
    lastLayout = next;
    setLayoutState(next);
  };
  const isBoard = view === "tasks" && layout === "board";
  const [sort, setSortState] = useState<TaskSort>(lastSort);
  const setSort = (next: TaskSort) => {
    lastSort = next;
    setSortState(next);
  };
  const [milestoneFilter, setMilestoneFilterState] = useState<ReadonlySet<string>>(lastMilestones);
  const setMilestoneFilter = (next: ReadonlySet<string>) => {
    lastMilestones = next;
    setMilestoneFilterState(next);
  };
  const [hiddenProjects, setHiddenProjectsState] =
    useState<ReadonlySet<string>>(readHiddenProjects);
  const setHiddenProjects = (next: ReadonlySet<string>) => {
    writeHiddenProjects(next);
    setHiddenProjectsState(next);
  };
  const inProjects =
    hiddenProjects.size > 0
      ? board.items.filter((project) => !hiddenProjects.has(project.id))
      : board.items;
  const shownBoard = inProjects === board.items ? board : { ...board, items: inProjects };
  const timeWindow = dateFilter.timeWindow;
  const filtered =
    timeWindow || show !== "all"
      ? filterTasks(inProjects, (item) => {
          if (timeWindow) {
            const at = taskActivityAt(item);
            if (at < timeWindow.from || at >= timeWindow.to) return false;
          }
          if (show === "working") return Boolean(live.get(item.id)?.working);
          if (show === "waiting") return Boolean(live.get(item.id)?.waiting);
          return true;
        })
      : null;
  const inMilestones =
    milestoneFilter.size > 0
      ? filterByMilestones(filtered?.items ?? inProjects, milestoneFilter)
      : null;
  const projects = sortTasks(inMilestones ?? filtered?.items ?? inProjects, sort);
  const liveStates = [...live.values()];
  const workingCount = liveStates.filter((state) => state.working).length;
  const waitingCount = liveStates.filter((state) => state.waiting).length;

  const copyAgentPrompt = () => {
    if (!filePath) return;
    void navigator.clipboard.writeText(agentPrompt(filePath)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    });
  };

  const addProject = (text: string) => {
    const project = makeTask(text, "you");
    void changeTaskBoard((current) => addTask(current, null, project));
  };

  return (
    <TaskProjectIconsContext value={projectIcons}>
      <SidebarInset className="h-dvh min-h-0 flex-row overflow-hidden overscroll-y-none">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
          <WorkspacePageHeader
            electron={isElectron}
            // The Tasks window has no sidebar, so its title clears the macOS window buttons itself.
            className={cn("relative bg-background", isTasksPopout && isMacPopout && "pl-20")}
          >
            <WorkspaceBreadcrumb ariaLabel={gt("Tasks breadcrumb")}>
              <WorkspaceBreadcrumbItem current>
                <h1 className="truncate">
                  <T>Tasks</T>
                </h1>
              </WorkspaceBreadcrumbItem>
            </WorkspaceBreadcrumb>
            <ToggleGroup
              aria-label={gt("Tasks view")}
              variant="segmented"
              className="[-webkit-app-region:no-drag]"
              value={[view]}
              onValueChange={(next) => {
                const value = next[0];
                if (
                  value === "tasks" ||
                  value === "milestones" ||
                  value === "questions" ||
                  value === "limits"
                )
                  setView(value);
              }}
            >
              <Toggle value="tasks">
                <T context="view showing tasks as a list">List</T>
                {openCount > 0 ? (
                  <span className="tabular-nums opacity-70">{openCount}</span>
                ) : null}
              </Toggle>
              <Toggle value="milestones">
                <T>Milestones</T>
              </Toggle>
              <Toggle value="questions">
                <T>Questions</T>
              </Toggle>
              {canReadProxyLimits() ? (
                <Toggle value="limits">
                  <T context="usage limits">Limits</T>
                </Toggle>
              ) : null}
            </ToggleGroup>
            <div className="min-w-0 flex-1" />
            <div
              className="flex items-center gap-3 [-webkit-app-region:no-drag]"
              data-workspace-titlebar-controls
            >
              {/* The watcher runs in the main window, so the Tasks window leaves its controls there. */}
              {isTasksPopout ? null : (
                <>
                  <WatcherState />
                  <UsageButton open={showUsage} onToggle={() => setShowUsage((value) => !value)} />
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={watcherEnabled}
                      onCheckedChange={(checked) =>
                        void persistClientSettingsPatch({ taskWatcherEnabled: Boolean(checked) })
                      }
                      aria-label={gt("Watch my chats")}
                    />
                    <T>Watch my chats</T>
                  </label>
                </>
              )}
              {canReadProxyLimits() ? <LimitsBadge onOpen={() => setView("limits")} /> : null}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon-sm"
                      variant={planningOpen ? "secondary" : "ghost"}
                      aria-label={
                        planningOpen ? gt("Hide planning chat") : gt("Show planning chat")
                      }
                      aria-pressed={planningOpen}
                      onClick={() => setPlanningOpen(!planningOpen)}
                    />
                  }
                >
                  <MessagesSquareIcon />
                </TooltipTrigger>
                <TooltipPopup side="bottom">
                  <T>Planning chat</T>
                </TooltipPopup>
              </Tooltip>
              <DoneTodayButton board={board} />
              {isTasksPopout ? <PinWindowButton /> : null}
              {canPopOutTasks() ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={gt("Open Tasks in its own window")}
                        onClick={popOutTasks}
                      />
                    }
                  >
                    <PictureInPicture2Icon />
                  </TooltipTrigger>
                  <TooltipPopup side="bottom">
                    <T>Open in its own window</T>
                  </TooltipPopup>
                </Tooltip>
              ) : null}
              <Menu>
                <MenuTrigger
                  render={
                    <Button size="icon-sm" variant="ghost" aria-label={gt("More task options")} />
                  }
                >
                  <EllipsisIcon />
                </MenuTrigger>
                <MenuPopup align="end">
                  <MenuItem onClick={() => setShowDone((value) => !value)}>
                    <EyeIcon />
                    {showDone ? gt("Hide older done items") : gt("Show all done items")}
                  </MenuItem>
                  <MenuItem onClick={copyAgentPrompt} disabled={!filePath}>
                    <ClipboardCopyIcon />
                    <T>Copy a prompt for an agent</T>
                  </MenuItem>
                  <MenuSeparator />
                  <div className="max-w-72 px-2 py-1.5 text-muted-foreground text-xs break-all">
                    {filePath ?? "…"}
                  </div>
                </MenuPopup>
              </Menu>
            </div>
          </WorkspacePageHeader>

          <div className="topbar-scroll-fade scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
            <WorkspacePageContainer
              // The board's four columns need the room.
              width={isBoard ? "expanded" : "readable"}
              className="min-h-full gap-5"
            >
              {showUsage ? <UsagePanel onClose={() => setShowUsage(false)} /> : null}
              {view === "limits" ? (
                <LimitsView />
              ) : view === "milestones" ? (
                <MilestonesView
                  board={board}
                  live={live}
                  hiddenProjects={hiddenProjects}
                  projectFilter={
                    <ProjectFilterMenu
                      board={board}
                      hidden={hiddenProjects}
                      onChange={setHiddenProjects}
                    />
                  }
                />
              ) : view === "questions" ? (
                <QuestionsView />
              ) : (
                <>
                  {loaded && board.items.length === 0 ? (
                    <EmptyBoard onCopy={copyAgentPrompt} copied={copied} />
                  ) : null}
                  {copied && board.items.length > 0 ? (
                    <p className="text-muted-foreground text-sm">
                      <T>Copied. Paste it into any chat and list your tasks after it.</T>
                    </p>
                  ) : null}
                  {/* The board's own columns show what's working and waiting. */}
                  {isBoard ? null : <NowStrip board={shownBoard} live={live} />}
                  {board.items.length > 0 ? (
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <ToggleGroup
                          aria-label={gt("Show", { $context: "filter tasks by state" })}
                          variant="segmented"
                          value={[show]}
                          onValueChange={(next) => {
                            const value = next[0];
                            if (value === "all" || value === "working" || value === "waiting") {
                              setShow(value);
                            }
                          }}
                        >
                          <Toggle value="all">
                            <T>All tasks</T>
                          </Toggle>
                          <Toggle value="working">
                            <T>Working</T>
                            <span className="tabular-nums opacity-70">{workingCount}</span>
                          </Toggle>
                          <Toggle value="waiting">
                            <T>Waiting on you</T>
                            <span className="tabular-nums opacity-70">{waitingCount}</span>
                          </Toggle>
                        </ToggleGroup>
                        <div className="min-w-0 flex-1" />
                        <ProjectFilterMenu
                          board={board}
                          hidden={hiddenProjects}
                          onChange={setHiddenProjects}
                        />
                        <MilestoneFilterMenu
                          board={shownBoard}
                          selected={milestoneFilter}
                          onChange={setMilestoneFilter}
                        />
                        {/* The board orders each column itself. */}
                        {isBoard ? null : <SortMenu sort={sort} onChange={setSort} />}
                        <ToggleGroup
                          aria-label={gt("Layout")}
                          variant="segmented"
                          value={[layout]}
                          onValueChange={(next) => {
                            const value = next[0];
                            if (value === "list" || value === "board") setLayout(value);
                          }}
                        >
                          <Toggle
                            value="list"
                            aria-label={gt("List", { $context: "view showing tasks as a list" })}
                          >
                            <ListTreeIcon />
                            <T context="view showing tasks as a list">List</T>
                          </Toggle>
                          <Toggle
                            value="board"
                            aria-label={gt("Board", { $context: "kanban board layout" })}
                          >
                            <SquareKanbanIcon />
                            <T context="kanban board layout">Board</T>
                          </Toggle>
                        </ToggleGroup>
                      </div>
                      <DateFilterBar
                        filter={dateFilter}
                        count={
                          filtered
                            ? show === "all"
                              ? gt(
                                  "{count, plural, one {{count} task changed} other {{count} tasks changed}}",
                                  { count: filtered.matches },
                                )
                              : gt("{count, plural, one {{count} task} other {{count} tasks}}", {
                                  count: filtered.matches,
                                })
                            : undefined
                        }
                      />
                    </div>
                  ) : null}
                  {inProjects.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      <T>No project picked. Pick one in the projects filter to see its tasks.</T>
                    </p>
                  ) : null}
                  {inMilestones && inMilestones.length === 0 && filtered?.items.length !== 0 ? (
                    <p className="text-muted-foreground text-sm">
                      {show === "all" && !timeWindow ? (
                        <T>No task in the milestones you picked.</T>
                      ) : (
                        <T>No task in the milestones you picked matches the other filters.</T>
                      )}
                    </p>
                  ) : null}
                  {filtered && filtered.items.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      {show === "working"
                        ? gt("No chat is working on a task right now.")
                        : show === "waiting"
                          ? gt("Nothing is waiting on you.")
                          : gt("No task was added, changed or ticked off in this time.")}
                    </p>
                  ) : null}
                  {isBoard ? (
                    <KanbanView board={{ ...board, items: projects }} live={live} />
                  ) : null}
                  {isBoard
                    ? null
                    : projects.map((project) => (
                        <ProjectSection
                          key={project.id}
                          project={project}
                          board={board}
                          live={live}
                          // With dates picked, a done task shows when it was ticked off in them.
                          showDone={showDone || filtered !== null}
                          focusId={focusId}
                          setFocusId={setFocusId}
                        />
                      ))}
                  {isBoard ? null : (
                    <NewItemInput placeholder={gt("New project…")} onSubmit={addProject} />
                  )}
                </>
              )}
            </WorkspacePageContainer>
          </div>
        </div>
        {planningOpen ? <PlanningChatColumn onClose={() => setPlanningOpen(false)} /> : null}
      </SidebarInset>
    </TaskProjectIconsContext>
  );
}

const SORT_LABEL: Record<TaskSort, string> = {
  board: msg("Board order"),
  updated: msg("Last updated"),
  created: msg("Newest added"),
};

/** How the List view orders projects and tasks. Moving tasks by hand changes the board order. */
function SortMenu({ sort, onChange }: { sort: TaskSort; onChange: (sort: TaskSort) => void }) {
  const gt = useGT();
  const messages = useMessages();
  return (
    <Menu>
      <MenuTrigger render={<Button size="compact" variant="ghost" aria-label={gt("Sort tasks")} />}>
        <ArrowDownUpIcon />
        {messages(SORT_LABEL[sort])}
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuRadioGroup
          value={sort}
          onValueChange={(value) => {
            if (value === "board" || value === "updated" || value === "created") onChange(value);
          }}
        >
          {(Object.keys(SORT_LABEL) as TaskSort[]).map((value) => (
            <MenuRadioItem key={value} value={value} closeOnClick>
              {messages(SORT_LABEL[value])}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

/**
 * The right panel's Tasks tab: the board project this chat's work is filed under, editable just
 * like on the Tasks page. A chat no task links yet gets a pointer to the full page.
 */
export function ThreadTasksPanel({ threadRef }: { threadRef: ScopedThreadRef }) {
  const navigate = useNavigate();
  const { board, loaded } = useTaskBoard();
  const [focusId, setFocusId] = useState<string | null>(null);
  const { entries } = useTaskQuestions();
  const project = projectForThread(board, threadRef.environmentId, threadRef.threadId);
  const live = useTaskLiveStates(board.items);
  // A chat with no task yet may still have logged questions; they name its project.
  const projectName =
    project?.text ??
    entries.find(
      (entry) =>
        entry.threadId === threadRef.threadId && entry.environmentId === threadRef.environmentId,
    )?.project ??
    null;
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-4">
      {project ? (
        <ProjectSection
          project={project}
          board={board}
          live={live}
          showDone={false}
          focusId={focusId}
          setFocusId={setFocusId}
        />
      ) : loaded ? (
        <div className="flex flex-col items-start gap-2 text-sm">
          <p className="font-medium">
            <T>This chat isn&rsquo;t on your task board yet</T>
          </p>
          <p className="text-muted-foreground">
            <T>
              With &ldquo;Watch my chats&rdquo; on, it gets filed under its project after its next
              reply.
            </T>
          </p>
        </div>
      ) : null}
      {projectName ? (
        <div className="mt-6">
          <ProjectQuestions
            project={projectName}
            environmentId={threadRef.environmentId}
            threadId={threadRef.threadId}
          />
        </div>
      ) : null}
      <Button
        size="compact"
        variant="ghost-muted"
        className="mt-4 self-start"
        onClick={() => void navigate({ to: "/tasks" })}
      >
        <ListTodoIcon />
        <T>Open all tasks</T>
      </Button>
    </div>
  );
}

function WatcherState() {
  const gt = useGT();
  const watcher = useTaskWatcherStatus();
  const enabled = useClientSettings((settings) => settings.taskWatcherEnabled);
  if (!enabled) return null;
  const text = watcher.running
    ? gt("Checking…")
    : watcher.queued > 0
      ? gt("{count, plural, one {{count} chat to check} other {{count} chats to check}}", {
          count: watcher.queued,
        })
      : watcher.lastFailed
        ? gt("Last check failed")
        : watcher.lastRunAt
          ? gt("Checked {time}", {
              time: new Date(watcher.lastRunAt).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              }),
            })
          : gt("Waiting for a chat to finish");
  return (
    <span className={cn("text-muted-foreground text-xs", watcher.lastFailed && "text-destructive")}>
      {text}
    </span>
  );
}

const RECENT_CALLS = 30;

function UsageButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { records } = useTaskUsage();
  const today = summarizeTaskUsage(records).today;
  const gt = useGT();
  return (
    <Button
      size="compact"
      variant={open ? "secondary" : "ghost"}
      onClick={onToggle}
      aria-pressed={open}
      aria-label={gt("Watcher usage")}
    >
      <CoinsIcon />
      <span className="tabular-nums">
        <T>
          <Var>{formatUsd(today.costUsd)}</Var> today
        </T>
      </span>
    </Button>
  );
}

function UsagePanel({ onClose }: { onClose: () => void }) {
  const { records, loaded } = useTaskUsage();
  const [showAll, setShowAll] = useState(false);
  const gt = useGT();
  // Read the clock once per open, not on every render.
  const [now] = useState(() => new Date());
  const todayLabel = now.toDateString();
  const summary = summarizeTaskUsage(records, now);
  const shown = showAll ? records : records.slice(0, RECENT_CALLS);
  return (
    <section className="flex flex-col gap-4 rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2">
        <h2 className="font-medium">
          <T>Watcher usage</T>
        </h2>
        <span className="text-muted-foreground text-xs">
          <T>Claude Haiku, one call per batch of chats</T>
        </span>
        <div className="flex-1" />
        <Button size="compact" variant="ghost" onClick={onClose}>
          <T>Hide</T>
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <UsageTotals label={gt("Today")} totals={summary.today} />
        <UsageTotals label={gt("Last 7 days")} totals={summary.week} />
        <UsageTotals label={gt("All time")} totals={summary.all} />
      </div>
      {loaded && records.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          <T>
            No calls yet. One runs about 20 seconds after a chat finishes while &ldquo;Watch my
            chats&rdquo; is on.
          </T>
        </p>
      ) : null}
      {shown.length > 0 ? (
        <div className="flex flex-col">
          <div className="grid grid-cols-[4.5rem_1fr_7.5rem_4.5rem_5rem] gap-3 border-b pb-1.5 text-muted-foreground text-xs">
            <span>
              <T>Time</T>
            </span>
            <span>
              <T>Chats</T>
            </span>
            <span className="text-right">
              <T>Tokens in / out</T>
            </span>
            <span className="text-right">
              <T>Cost</T>
            </span>
            <span className="text-right">
              <T>Result</T>
            </span>
          </div>
          {shown.map((record) => (
            <UsageRow
              key={`${record.at}-${record.chats.join()}`}
              record={record}
              today={todayLabel}
            />
          ))}
          {records.length > RECENT_CALLS ? (
            <Button
              size="compact"
              variant="ghost"
              className="mt-2 self-start"
              onClick={() => setShowAll((value) => !value)}
            >
              {showAll ? gt("Show fewer") : gt("Show all {count} calls", { count: records.length })}
            </Button>
          ) : null}
        </div>
      ) : null}
      <p className="text-muted-foreground text-xs">
        <T>
          Cost is what the Claude CLI reports at list price. It is billed to your ANTHROPIC_API_KEY,
          not your Claude plan. Log: ~/.config/t3code-tasks/usage.jsonl
        </T>
      </p>
    </section>
  );
}

function UsageTotals({ label, totals }: { label: string; totals: TaskUsageTotals }) {
  const gt = useGT();
  const calls =
    totals.failed > 0
      ? gt("{calls, plural, one {{calls} call} other {{calls} calls}}, {failed} failed", {
          calls: totals.calls,
          failed: totals.failed,
        })
      : gt("{calls, plural, one {{calls} call} other {{calls} calls}}", { calls: totals.calls });
  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-muted/50 px-3 py-2">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-semibold text-lg tabular-nums">{formatUsd(totals.costUsd)}</span>
      <span className="text-muted-foreground text-xs tabular-nums">{calls}</span>
      <span className="text-muted-foreground text-xs tabular-nums">
        <T>
          <Var>{formatTokens(totals.inputTokens)}</Var> in ·{" "}
          <Var>{formatTokens(totals.outputTokens)}</Var> out
        </T>
      </span>
    </div>
  );
}

function UsageRow({ record, today }: { record: TaskUsageRecord; today: string }) {
  const gt = useGT();
  const at = new Date(record.at);
  const sameDay = at.toDateString() === today;
  const time = sameDay
    ? at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : at.toLocaleDateString([], { month: "short", day: "numeric" });
  const result = !record.ok
    ? gt("Failed")
    : record.changes === 0
      ? gt("No change")
      : gt("{count, plural, one {{count} change} other {{count} changes}}", {
          count: record.changes,
        });
  return (
    <div className="grid grid-cols-[4.5rem_1fr_7.5rem_4.5rem_5rem] items-baseline gap-3 border-b py-1.5 text-sm last:border-b-0">
      <span className="text-muted-foreground text-xs tabular-nums">{time}</span>
      <span className="min-w-0 truncate">
        {record.chats.join(", ") || gt("(no chat)")}
        {record.error ? (
          <span className="block truncate text-destructive text-xs">{record.error}</span>
        ) : null}
      </span>
      <span className="text-right text-xs tabular-nums">
        {formatTokens(totalInputTokens(record))} / {formatTokens(record.outputTokens)}
      </span>
      <span className="text-right text-xs tabular-nums">{formatUsd(record.costUsd)}</span>
      <span
        className={cn(
          "text-right text-xs",
          record.ok ? "text-muted-foreground" : "text-destructive",
        )}
      >
        {result}
      </span>
    </div>
  );
}

function EmptyBoard({ onCopy, copied }: { onCopy: () => void; copied: boolean }) {
  const gt = useGT();
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-6">
      <ListTodoIcon className="size-5 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <p className="font-medium">
          <T>Nothing tracked yet</T>
        </p>
        <p className="text-muted-foreground text-sm">
          <T>
            Add a project below and type tasks under it, or ask any chat to fill it in. With
            &ldquo;Watch my chats&rdquo; on, a small model reads each finished prompt and adds new
            work, links the chat and ticks it off when it&rsquo;s done.
          </T>
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={onCopy}>
        <ClipboardCopyIcon />
        {copied ? gt("Copied") : gt("Copy a prompt for an agent")}
      </Button>
    </div>
  );
}

interface RowContext {
  readonly board: TaskBoard;
  /** Open tasks' live state from their chats, by task id. */
  readonly live: ReadonlyMap<string, TaskLiveState>;
  readonly showDone: boolean;
  readonly focusId: string | null;
  readonly setFocusId: (id: string | null) => void;
}

function visibleChildren(item: TaskItem, showDone: boolean): ReadonlyArray<TaskItem> {
  const now = Date.now();
  return item.children.filter((child) => showDone || isRecentlyDone(child, now, KEEP_DONE_MS));
}

function countWorking(item: TaskItem, live: ReadonlyMap<string, TaskLiveState>): number {
  return item.children.reduce(
    (total, child) => total + (live.get(child.id)?.working ? 1 : 0) + countWorking(child, live),
    0,
  );
}

function ProjectSection({ project, ...context }: RowContext & { project: TaskItem }) {
  // While you type, the field shows your draft; otherwise the saved name, which an agent or the
  // watcher may change.
  const [draft, setDraft] = useState<string | null>(null);
  const open = countOpenTasks(project.children);
  const workingCount = countWorking(project, context.live);
  const children = visibleChildren(project, context.showDone);
  const gt = useGT();

  const addFirst = (text: string) => {
    const task = makeTask(text, "you");
    void changeTaskBoard((current) => addTask(current, project.id, task));
  };
  const addInMilestone = (milestoneId: string) => (text: string) => {
    const task = makeTask(text, "you", undefined, { milestone: milestoneId });
    void changeTaskBoard((current) => addTask(current, project.id, task));
  };
  // Headers count every task in a milestone, so they read the project as saved, not filtered.
  const savedProject = context.board.items.find((item) => item.id === project.id) ?? project;
  const groups = milestoneGroups(savedProject, children);
  const grouped = groups.length > 1 || groups[0]?.milestone != null;

  return (
    <section className="flex flex-col gap-1">
      <div className="group flex items-center gap-2">
        <button
          type="button"
          className="text-muted-foreground"
          aria-label={project.collapsed ? gt("Expand project") : gt("Collapse project")}
          onClick={() =>
            void changeTaskBoard((current) =>
              updateTask(current, project.id, (item) => ({
                ...item,
                collapsed: item.collapsed ? undefined : true,
              })),
            )
          }
        >
          <ChevronRightIcon
            className={cn("size-4 transition-transform", !project.collapsed && "rotate-90")}
          />
        </button>
        <TaskProjectIcon name={project.text} className="size-4" />
        <input
          value={draft ?? project.text}
          onFocus={() => setDraft(project.text)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            const text = (draft ?? "").trim();
            if (text && text !== project.text) {
              void changeTaskBoard((current) =>
                updateTask(current, project.id, (item) => ({ ...item, text })),
              );
            }
            setDraft(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className="min-w-0 flex-1 bg-transparent font-semibold text-base outline-none"
          aria-label={gt("Project name")}
        />
        <span className="text-muted-foreground text-xs tabular-nums">
          {open > 0 ? gt("{count} open", { count: open }) : ""}
          {workingCount > 0 ? (
            <span className="text-info-foreground">{` · ${gt("{count} working", { count: workingCount })}`}</span>
          ) : null}
        </span>
        <ItemMenu item={project} project={project} isProject />
      </div>
      {project.collapsed ? null : (
        <div className="flex flex-col">
          {grouped
            ? groups.map((group) => (
                <div key={group.milestone?.id ?? "none"} className="flex flex-col">
                  <MilestoneGroupHeader
                    project={savedProject}
                    milestone={group.milestone}
                    live={context.live}
                  />
                  {group.tasks.map((child) => (
                    <TaskRow key={child.id} item={child} depth={1} {...context} />
                  ))}
                  {group.milestone && group.milestone.state === "open" ? (
                    <div className="ps-6">
                      <NewItemInput
                        placeholder={gt("Add a task to {name}…", { name: group.milestone.name })}
                        onSubmit={addInMilestone(group.milestone.id)}
                        compact
                      />
                    </div>
                  ) : null}
                </div>
              ))
            : children.map((child) => (
                <TaskRow key={child.id} item={child} depth={1} {...context} />
              ))}
          {grouped && !groups.some((group) => group.milestone === null) ? (
            <MilestoneGroupHeader project={savedProject} milestone={null} live={context.live} />
          ) : null}
          <div className="ps-6">
            <NewItemInput placeholder={gt("Add a task…")} onSubmit={addFirst} compact />
          </div>
        </div>
      )}
    </section>
  );
}

function TaskRow({ item, depth, ...context }: RowContext & { item: TaskItem; depth: number }) {
  const gt = useGT();
  const openThread = useOpenTaskThread();
  const live = context.live.get(item.id);
  const workingOn = live?.working ?? null;
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? item.text;
  const [adding, setAdding] = useState(false);
  const { focusId, setFocusId } = context;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves DOM focus to this row after Enter, Tab or Alt+arrow re-renders it
  useEffect(() => {
    if (focusId === item.id) {
      inputRef.current?.focus();
      setFocusId(null);
    }
  }, [focusId, item.id, setFocusId]);

  const done = item.status === "done";
  const children = visibleChildren(item, context.showDone);

  const save = () => {
    const next = text.trim();
    if (next && next !== item.text) {
      void changeTaskBoard((current) =>
        updateTask(current, item.id, (entry) => ({
          ...entry,
          text: next,
          updatedAt: new Date().toISOString(),
        })),
      );
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      save();
      void changeTaskBoard((current) => setTaskStatus(current, item.id, done ? "active" : "done"));
    } else if (event.key === "Enter") {
      event.preventDefault();
      save();
      setAdding(true);
    } else if (event.key === "Tab") {
      event.preventDefault();
      save();
      // Shift+Tab never lifts a task out to the project level.
      if (event.shiftKey && depth <= 1) return;
      void changeTaskBoard((current) =>
        event.shiftKey ? outdentTask(current, item.id) : indentTask(current, item.id),
      );
      setFocusId(item.id);
    } else if (event.key === "Backspace" && text === "") {
      event.preventDefault();
      void changeTaskBoard((current) => removeTask(current, item.id));
    } else if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      void changeTaskBoard((current) =>
        moveTask(current, item.id, event.key === "ArrowUp" ? -1 : 1),
      );
      setFocusId(item.id);
    }
  };

  return (
    <>
      <div
        className="group relative isolate flex items-start gap-2 rounded-md py-1 pe-1 hover:bg-accent/40"
        style={{ paddingInlineStart: `${(depth - 1) * 20 + 4}px` }}
      >
        {workingOn ? <WorkingGlow /> : null}
        <span className="flex h-6 w-4 shrink-0 items-center justify-center">
          {item.children.length > 0 ? (
            <button
              type="button"
              className="text-muted-foreground"
              aria-label={item.collapsed ? gt("Expand") : gt("Collapse")}
              onClick={() =>
                void changeTaskBoard((current) =>
                  updateTask(current, item.id, (entry) => ({
                    ...entry,
                    collapsed: entry.collapsed ? undefined : true,
                  })),
                )
              }
            >
              <ChevronRightIcon
                className={cn("size-3.5 transition-transform", !item.collapsed && "rotate-90")}
              />
            </button>
          ) : null}
        </span>
        <span className="flex h-6 items-center">
          <Checkbox
            checked={done}
            onCheckedChange={(checked) =>
              void changeTaskBoard((current) =>
                setTaskStatus(current, item.id, checked ? "done" : "active"),
              )
            }
            aria-label={done ? gt("Mark as not done") : gt("Mark as done")}
          />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <input
            ref={inputRef}
            value={text}
            onFocus={() => setDraft(item.text)}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              save();
              setDraft(null);
            }}
            onKeyDown={onKeyDown}
            className={cn(
              "h-6 min-w-0 bg-transparent text-sm outline-none",
              done && "text-muted-foreground line-through",
            )}
            aria-label={gt("Task")}
          />
          {item.note || item.threads.length > 0 ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pb-0.5 text-muted-foreground text-xs">
              {item.note ? <span>{item.note}</span> : null}
              {item.threads.map((thread) => (
                <ThreadChip
                  key={`${thread.environmentId}:${thread.threadId}`}
                  thread={thread}
                  working={
                    workingOn?.threadId === thread.threadId &&
                    workingOn.environmentId === thread.environmentId
                  }
                  onOpen={() => openThread(thread.environmentId, thread.threadId)}
                />
              ))}
            </div>
          ) : null}
        </div>
        <span className="flex h-6 items-center">
          <LabelChips labels={item.labels} />
        </span>
        {workingOn ? <TaskWorkingBadge working={workingOn} /> : null}
        {/* Done tasks have no live state; open ones always do. */}
        <StatusBadge
          waiting={live ? live.waiting : item.status === "waiting"}
          review={item.status === "review" && !workingOn}
        />
        <TaskAge item={item} />
        <span className="flex h-6 items-center">
          <LabelMenu
            task={item}
            known={labelsIn(context.board.items)}
            className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 has-data-popup-open:opacity-100"
          />
        </span>
        <ItemMenu
          item={item}
          // Only a project's direct tasks go in milestones; sub-tasks follow their task.
          project={
            depth === 1
              ? context.board.items.find((entry) =>
                  entry.children.some((child) => child.id === item.id),
                )
              : undefined
          }
        />
      </div>
      {item.collapsed
        ? null
        : children.map((child) => (
            <TaskRow key={child.id} item={child} depth={depth + 1} {...context} />
          ))}
      {adding ? (
        <div style={{ paddingInlineStart: `${(depth - 1) * 20 + 30}px` }}>
          <NewItemInput
            placeholder={gt("New task… (Esc to stop)")}
            compact
            autoFocus
            onCancel={() => setAdding(false)}
            onSubmit={(value) => {
              const task = makeTask(value, "you");
              void changeTaskBoard((current) => addTaskAfter(current, item.id, task));
              setAdding(false);
              setFocusId(task.id);
            }}
          />
        </div>
      ) : null}
    </>
  );
}

function shortDate(iso: string, nowMs: number, resolve: MessageResolver): string {
  const date = new Date(iso);
  const now = new Date(nowMs);
  if (date.toDateString() === now.toDateString()) {
    const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return resolve(msg("today {time}", { time }));
  }
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/**
 * The task's age on the far right, like the sidebar's thread times: when it last changed ("25m",
 * "3h", "2d"), or when it was ticked off. Amber when an open task has sat for 3+ days. Hover for
 * the full dates.
 */
function TaskAge({ item }: { item: TaskItem }) {
  // The minute clock is UTC without a zone mark ("2026-11-22T08:52").
  const nowMs = Date.parse(`${useNowMinute()}:00Z`);
  const gt = useGT();
  const messages = useMessages();
  const stale = isStaleTask(item, nowMs);
  const at = item.status === "done" && item.doneAt ? item.doneAt : item.updatedAt;
  const relative = formatRelativeTime(at, nowMs, messages);
  const short = relative
    ? relative.suffix
      ? relative.value
      : gt("now", { $context: "relative time, just happened" })
    : "";
  const changed = wasUpdatedSinceAdded(item);
  const added = shortDate(item.createdAt, nowMs, messages);
  const dates =
    item.status === "done" && item.doneAt
      ? gt("Added {added}, done {done}", {
          added,
          done: formatRelativeTimeLabel(item.doneAt, nowMs, messages),
        })
      : changed
        ? gt("Added {added}, updated {updated}", {
            added,
            updated: formatRelativeTimeLabel(item.updatedAt, nowMs, messages),
          })
        : gt("Added {added}", { added });
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "flex h-6 w-9 shrink-0 cursor-default items-center justify-end text-muted-foreground text-xs tabular-nums",
              stale && "text-warning-foreground",
            )}
          />
        }
      >
        {short}
      </TooltipTrigger>
      <TooltipPopup side="top">
        <span className="tabular-nums">{dates}</span>
      </TooltipPopup>
    </Tooltip>
  );
}

function ThreadChip({
  thread,
  working,
  onOpen,
}: {
  thread: TaskThreadRef;
  working: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "inline-flex max-w-56 items-center gap-1 rounded border px-1.5 py-px hover:bg-accent hover:text-foreground",
        // The chat working on this task now.
        working && "border-info-foreground/40 text-info-foreground",
      )}
    >
      <MessageSquareIcon className="size-3 shrink-0" />
      <span className="truncate">{thread.title}</span>
    </button>
  );
}

function StatusBadge({ waiting, review }: { waiting: boolean; review: boolean }) {
  if (review && !waiting) {
    return (
      <span className="mt-0.5 shrink-0 rounded-full bg-info/8 px-2 py-0.5 text-2xs text-info-foreground dark:bg-info/16">
        <T>In review</T>
      </span>
    );
  }
  if (!waiting) return null;
  return (
    <span className="mt-0.5 shrink-0 rounded-full bg-warning-surface px-2 py-0.5 text-2xs text-warning-foreground">
      <T>Waiting on you</T>
    </span>
  );
}

function ItemMenu({
  item,
  project,
  isProject = false,
}: {
  item: TaskItem;
  /** The project a direct task is in (or the project itself), for milestones. */
  project?: TaskItem | undefined;
  isProject?: boolean;
}) {
  const [newMilestone, setNewMilestone] = useState(false);
  const gt = useGT();
  const set = (status: TaskStatus) =>
    void changeTaskBoard((current) => setTaskStatus(current, item.id, status));
  return (
    <>
      <Menu>
        <span className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 has-data-popup-open:opacity-100">
          <MenuTrigger
            render={<Button size="icon-xs" variant="ghost" aria-label={gt("Task options")} />}
          >
            <EllipsisIcon />
          </MenuTrigger>
        </span>
        <MenuPopup align="end">
          {isProject ? (
            <>
              <MenuItem onClick={() => setNewMilestone(true)}>
                <PlusIcon />
                <T>New milestone…</T>
              </MenuItem>
              <MenuSeparator />
            </>
          ) : (
            <>
              {project ? (
                <>
                  <TaskMilestoneSubmenu
                    project={project}
                    task={item}
                    onNew={() => setNewMilestone(true)}
                  />
                  <MenuSeparator />
                </>
              ) : null}
              <MenuItem onClick={() => set("active")} disabled={item.status === "active"}>
                <T>Mark active</T>
              </MenuItem>
              <MenuItem onClick={() => set("waiting")} disabled={item.status === "waiting"}>
                <T>Mark waiting on me</T>
              </MenuItem>
              <MenuItem onClick={() => set("review")} disabled={item.status === "review"}>
                <T>Mark in review</T>
              </MenuItem>
              <MenuItem onClick={() => set("done")} disabled={item.status === "done"}>
                <T>Mark done</T>
              </MenuItem>
              {item.note ? (
                <MenuItem
                  onClick={() =>
                    void changeTaskBoard((current) =>
                      updateTask(current, item.id, (entry) => ({
                        ...entry,
                        note: undefined,
                        updatedAt: new Date().toISOString(),
                      })),
                    )
                  }
                >
                  <T>Clear note</T>
                </MenuItem>
              ) : null}
              <MenuSeparator />
            </>
          )}
          <MenuItem
            variant="destructive"
            onClick={() => void changeTaskBoard((current) => removeTask(current, item.id))}
          >
            {isProject ? gt("Delete project and its tasks") : gt("Delete")}
          </MenuItem>
        </MenuPopup>
      </Menu>
      {project ? (
        <MilestoneDialog
          open={newMilestone}
          onOpenChange={setNewMilestone}
          onSave={(draft) => createMilestone(project.id, draft, isProject ? undefined : item.id)}
        />
      ) : null}
    </>
  );
}

function NewItemInput({
  placeholder,
  onSubmit,
  onCancel,
  autoFocus = false,
  compact = false,
}: {
  placeholder: string;
  onSubmit: (text: string) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  compact?: boolean;
}) {
  const [value, setValue] = useState("");
  return (
    <div className={cn("flex items-center gap-2 text-muted-foreground", compact ? "py-1" : "py-2")}>
      <PlusIcon className={compact ? "size-3.5" : "size-4"} />
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && value.trim()) {
            onSubmit(value.trim());
            setValue("");
          } else if (event.key === "Escape") onCancel?.();
        }}
        onBlur={() => {
          if (!value.trim()) onCancel?.();
        }}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className={cn(
          "min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground",
          compact ? "text-sm" : "font-semibold text-base",
        )}
      />
    </div>
  );
}
