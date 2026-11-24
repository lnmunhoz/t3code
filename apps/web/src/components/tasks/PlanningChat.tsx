import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import { ExternalLinkIcon, MessageSquarePlusIcon, SendIcon, XIcon } from "lucide-react";
import { useState, type CSSProperties, type KeyboardEvent } from "react";

import ChatView from "~/components/ChatView";
import { RightPanelResizeHandle } from "~/components/preview/RightPanelResizeHandle";
import { BackgroundThreadContext } from "~/components/chat/backgroundThread";
import { useOpenThreadFamily } from "~/components/ThreadRouteView";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import { ComposerHandleContext } from "~/composerHandleContext";
import { RESIZABLE_WIDTH_PROPERTY, useResizableWidth } from "~/hooks/useResizableWidth";
import { observeResize } from "~/lib/observeResize";
import type { SideChatParentPanel } from "~/lib/sideChatPane";
import { newMessageId, newThreadId } from "~/lib/utils";
import { useProjects, useQuietThreadShell, useQuietThreadShells } from "~/state/entities";
import { useEnvironmentShellStatus } from "~/state/shell";
import { threadEnvironment, useEnvironmentThread } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { isThreadRouteSnapshotAuthoritative, resolveThreadRouteRenderState } from "~/threadRoutes";

import { TaskMentionsContext } from "./taskMentionsContext";
import { useOpenTaskThread } from "./tasksPopout";

/** The planning chat's folder; its AGENTS.md keeps the agent on project management. */
const PLANNING_FOLDER = "/home/planning";
const STORAGE_KEY = "t3code:tasks:planning-thread";

function readStoredThread(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeThread(value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // The panel still works; it just picks the latest planning chat next time.
  }
}

const MIN_WIDTH = 320;
const DEFAULT_WIDTH = 440;
/** The board keeps at least this much room beside the chat. */
const BOARD_MIN_WIDTH = 360;

/**
 * The planning chat's column at the right of the Tasks page: resizable from its left edge like
 * the app's other side panels (drag or arrow keys), with the width saved.
 */
export function PlanningChatColumn({ onClose }: { onClose: () => void }) {
  const gt = useGT();
  const [maxWidth, setMaxWidth] = useState(720);
  const { width, setWidth, handlers } = useResizableWidth({
    storageKey: "t3code:tasks:planning-width",
    defaultWidth: DEFAULT_WIDTH,
    minWidth: MIN_WIDTH,
    maxWidth,
    edge: "left",
  });
  return (
    <div
      ref={(host) => {
        const row = host?.parentElement;
        if (!row) return;
        const measure = () => setMaxWidth(Math.max(MIN_WIDTH, row.clientWidth - BOARD_MIN_WIDTH));
        measure();
        return observeResize(row, measure);
      }}
      className="relative flex h-full min-h-0 shrink-0 flex-col"
      style={
        {
          [RESIZABLE_WIDTH_PROPERTY]: `${width}px`,
          width: `var(${RESIZABLE_WIDTH_PROPERTY})`,
        } as CSSProperties
      }
    >
      <RightPanelResizeHandle
        handlers={handlers}
        label={gt("Resize planning chat")}
        tabIndex={0}
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={maxWidth}
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          const next =
            event.key === "ArrowLeft"
              ? width + 16
              : event.key === "ArrowRight"
                ? width - 16
                : event.key === "Home"
                  ? MIN_WIDTH
                  : event.key === "End"
                    ? maxWidth
                    : null;
          if (next === null) return;
          event.preventDefault();
          event.stopPropagation();
          setWidth(next);
        }}
      />
      <PlanningChatPanel onClose={onClose} />
    </div>
  );
}

function findPlanningProject(
  projects: ReadonlyArray<EnvironmentProject>,
): EnvironmentProject | null {
  return (
    projects.find(
      (project) =>
        project.archivedAt === null &&
        project.workspaceRoot.replace(/\/+$/u, "").endsWith(PLANNING_FOLDER),
    ) ?? null
  );
}

/** The planning project's chats, newest first; side chats and subagents left out. */
function planningThreads(
  shells: ReadonlyArray<EnvironmentThreadShell>,
  project: EnvironmentProject,
): EnvironmentThreadShell[] {
  return shells
    .filter(
      (shell) =>
        shell.environmentId === project.environmentId &&
        shell.projectId === project.id &&
        shell.archivedAt === null &&
        shell.lineage.sideChat !== true &&
        shell.lineage.parentThreadId === null,
    )
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * The planning chat beside the board: the real chat view of one chat in the Planning project
 * (`~/home/planning`), whose AGENTS.md makes the agent a project manager for the board. It shows
 * the chat picked last, else the newest one; "New chat" starts another with its first message.
 */
function PlanningChatPanel({ onClose }: { onClose: () => void }) {
  const gt = useGT();
  const project = findPlanningProject(useProjects());
  const shells = useQuietThreadShells();
  const [stored, setStored] = useState(readStoredThread);
  const threads = project ? planningThreads(shells, project) : [];
  const openThread = useOpenTaskThread();

  const storedRef = (() => {
    if (!project || stored === null || stored === "new") return null;
    const [environmentId, threadId] = stored.split("/");
    return environmentId === project.environmentId && threadId
      ? scopeThreadRef(environmentId as EnvironmentId, threadId as ThreadId)
      : null;
  })();
  const latest = threads[0];
  const threadRef =
    stored === "new"
      ? null
      : (storedRef ?? (latest ? scopeThreadRef(latest.environmentId, latest.id) : null));

  const choose = (value: string | null) => {
    storeThread(value);
    setStored(value);
  };

  return (
    <aside
      className="flex h-full min-h-0 w-full min-w-0 flex-col border-border border-s bg-background"
      aria-label={gt("Planning chat")}
    >
      <div className="flex h-11 shrink-0 items-center gap-1 border-border border-b ps-3 pe-1.5">
        <h2 className="min-w-0 flex-1 truncate font-medium text-sm">
          <T>Planning</T>
        </h2>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={gt("New planning chat")}
          disabled={!project || threadRef === null}
          onClick={() => choose("new")}
        >
          <MessageSquarePlusIcon />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={gt("Open in the main window")}
          disabled={threadRef === null}
          onClick={() => {
            if (threadRef) openThread(threadRef.environmentId, threadRef.threadId);
          }}
        >
          <ExternalLinkIcon />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={gt("Hide planning chat")}
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </div>
      {!project ? (
        <p className="p-4 text-muted-foreground text-sm">
          <T>
            Add a project for the folder <Var>{"~/home/planning"}</Var> to use the planning chat.
            Its <Var>{"AGENTS.md"}</Var> tells the agent to manage the board instead of writing
            code.
          </T>
        </p>
      ) : threadRef === null ? (
        <PlanningStarter
          project={project}
          modelFrom={latest ?? latestShellIn(shells, project.environmentId)}
          onStarted={(ref) => choose(`${ref.environmentId}/${ref.threadId}`)}
        />
      ) : (
        <PlanningThread
          key={`${threadRef.environmentId}/${threadRef.threadId}`}
          threadRef={threadRef}
        />
      )}
    </aside>
  );
}

function latestShellIn(
  shells: ReadonlyArray<EnvironmentThreadShell>,
  environmentId: EnvironmentId,
): EnvironmentThreadShell | null {
  let latest: EnvironmentThreadShell | null = null;
  for (const shell of shells) {
    if (shell.environmentId !== environmentId) continue;
    if (!latest || shell.createdAt > latest.createdAt) latest = shell;
  }
  return latest;
}

/** The first message of a new planning chat, which creates the chat as it sends. */
function PlanningStarter({
  project,
  modelFrom,
  onStarted,
}: {
  project: EnvironmentProject;
  /** The chat whose model and access a new chat copies: the last planning chat, else any. */
  modelFrom: EnvironmentThreadShell | null;
  onStarted: (ref: ScopedThreadRef) => void;
}) {
  const gt = useGT();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });

  const send = async () => {
    const message = text.trim();
    if (!message || sending || !modelFrom) return;
    setSending(true);
    const threadId = newThreadId();
    const createdAt = new Date().toISOString();
    const title = message.length > 60 ? `${message.slice(0, 57).trimEnd()}…` : message;
    const result = await startTurn({
      environmentId: project.environmentId,
      input: {
        threadId,
        message: { messageId: newMessageId(), role: "user", text: message, attachments: [] },
        modelSelection: modelFrom.modelSelection,
        runtimeMode: modelFrom.runtimeMode,
        interactionMode: "default",
        bootstrap: {
          createThread: {
            projectId: project.id,
            title,
            modelSelection: modelFrom.modelSelection,
            runtimeMode: modelFrom.runtimeMode,
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt,
          },
        },
        createdAt,
      },
    });
    setSending(false);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: gt("Could not start the planning chat"),
        ...(error instanceof Error ? { description: error.message } : {}),
      });
      return;
    }
    setText("");
    onStarted(scopeThreadRef(project.environmentId, threadId));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-muted-foreground text-sm">
        <T>
          Plan with an agent that keeps your board: brainstorm, break goals into tasks and
          milestones, ask what's next. It doesn't write code.
        </T>
      </p>
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={gt("What do you want to plan?")}
        rows={4}
        disabled={sending}
        autoFocus
      />
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-muted-foreground text-xs">
          {modelFrom
            ? gt("Uses the model of your last chat.")
            : gt("Start any chat first, to pick a model.")}
        </p>
        <Button
          size="compact"
          disabled={!text.trim() || sending || !modelFrom}
          onClick={() => void send()}
        >
          <SendIcon />
          <T>Start</T>
        </Button>
      </div>
    </div>
  );
}

/** One planning chat, shown like a side chat: the real chat view, embedded. */
function PlanningThread({ threadRef }: { threadRef: ScopedThreadRef }) {
  const openThread = useOpenTaskThread();
  const shell = useQuietThreadShell(threadRef);
  const bootstrapComplete = isThreadRouteSnapshotAuthoritative(
    useEnvironmentShellStatus(threadRef.environmentId),
  );
  // A settled chat can drop out of the shells; its own detail says whether it still exists.
  const unlistedDetail = useEnvironmentThread(
    shell === null ? threadRef.environmentId : null,
    shell === null ? threadRef.threadId : null,
  );
  useOpenThreadFamily(threadRef, bootstrapComplete && shell === null);
  const renderState = resolveThreadRouteRenderState({
    bootstrapComplete,
    serverThreadExists: shell !== null,
    serverThreadDeleted: shell?.deletedAt != null,
    unlistedThreadDetail: unlistedDetail,
    draftThreadExists: false,
  });
  const openInMain = () => openThread(threadRef.environmentId, threadRef.threadId);
  // Diffs and shell commands need the full chat screen, so they open the chat there.
  const panel: SideChatParentPanel = {
    hostRef: threadRef,
    openToolDiff: openInMain,
    runShellCommand: openInMain,
  };

  if (renderState === "missing") {
    return (
      <p className="p-4 text-muted-foreground text-sm">
        <T>This planning chat is gone. Start a new one with the button above.</T>
      </p>
    );
  }
  if (renderState === "loading" && shell === null) return null;
  return (
    <div
      data-side-chat-pane={threadRef.threadId}
      className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col"
    >
      <TaskMentionsContext value>
        <BackgroundThreadContext value>
          <ComposerHandleContext value={null}>
            <ChatView
              environmentId={threadRef.environmentId}
              threadId={threadRef.threadId}
              routeKind="server"
              embedded={panel}
            />
          </ComposerHandleContext>
        </BackgroundThreadContext>
      </TaskMentionsContext>
    </div>
  );
}
