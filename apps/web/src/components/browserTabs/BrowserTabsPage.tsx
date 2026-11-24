import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type EnvironmentId,
  type PreviewSessionSnapshot,
  type ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { AsyncResult, Atom } from "effect/reactivity";
import { BotIcon, GlobeIcon, UserIcon, XIcon } from "lucide-react";
import { T, useGT } from "gt-react";
import { useState } from "react";

import { closePreviewSession } from "~/components/preview/closePreviewSession";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "~/components/WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "~/components/WorkspacePageContainer";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { Button } from "~/components/ui/button";
import { SidebarInset } from "~/components/ui/sidebar";
import { isElectron } from "~/env";
import { useNowMinute } from "~/hooks/useNowMinute";
import { useThreadShell } from "~/state/entities";
import { useConnectedEnvironmentIds, useEnvironment } from "~/state/environments";
import { previewEnvironment } from "~/state/preview";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "~/timestampFormat";

// Any tab opening, navigating or closing anywhere re-reads the full list.
const allTabsAtom = Atom.family((environmentId: EnvironmentId) => {
  const listAtom = previewEnvironment.list({ environmentId, input: {} });
  const eventsAtom = previewEnvironment.events({ environmentId, input: {} });
  return Atom.make((get) => {
    get.subscribe(eventsAtom, () => get.refresh(listAtom));
    get.mount(eventsAtom);
    return get(listAtom);
  }).pipe(Atom.setIdleTTL(1_000), Atom.withLabel(`preview:all-tabs:${environmentId}`));
});

const EMPTY_TABS: ReadonlyArray<PreviewSessionSnapshot> = [];

function tabLabel(snapshot: PreviewSessionSnapshot) {
  const status = snapshot.navStatus;
  if (status._tag === "Idle") return null;
  return { title: status.title || status.url, url: status.url };
}

export function BrowserTabsPage() {
  const gt = useGT();
  const environmentIds = useConnectedEnvironmentIds();
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="bg-background">
          <WorkspaceBreadcrumb ariaLabel={gt("Browser tabs breadcrumb")}>
            <WorkspaceBreadcrumbItem current>
              <h1 className="truncate">
                <T>Browser tabs</T>
              </h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
        </WorkspacePageHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <WorkspacePageContainer width="wide">
            {environmentIds.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                <T>Connecting…</T>
              </p>
            ) : (
              environmentIds.map((environmentId) => (
                <EnvironmentTabs key={environmentId} environmentId={environmentId} />
              ))
            )}
          </WorkspacePageContainer>
        </div>
      </div>
    </SidebarInset>
  );
}

function EnvironmentTabs({ environmentId }: { environmentId: EnvironmentId }) {
  const gt = useGT();
  const environment = useEnvironment(environmentId);
  const result = useAtomValue(allTabsAtom(environmentId));
  const closePreview = useAtomCommand(previewEnvironment.close, "preview close");
  const [closingAll, setClosingAll] = useState(false);
  const tabs = AsyncResult.isSuccess(result) ? result.value.sessions : EMPTY_TABS;

  const byThread = new Map<string, Array<PreviewSessionSnapshot>>();
  for (const tab of tabs.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const list = byThread.get(tab.threadId) ?? [];
    list.push(tab);
    byThread.set(tab.threadId, list);
  }

  const close = (snapshot: PreviewSessionSnapshot) =>
    closePreviewSession({
      closePreview,
      snapshot,
      tabId: snapshot.tabId,
      threadRef: scopeThreadRef(environmentId, ThreadId.make(snapshot.threadId)),
    });

  const closeTabs = async () => {
    for (const tab of tabs) await close(tab);
  };

  const closeAll = () => {
    setClosingAll(true);
    return closeTabs().finally(() => setClosingAll(false));
  };

  const agentCount = tabs.filter((tab) => tab.automationOwner !== undefined).length;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-3 border-b pb-2">
        <h2 className="min-w-0 truncate text-base font-semibold">
          {environment?.label ?? environmentId}
        </h2>
        {AsyncResult.isSuccess(result) ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {gt("{open} open · {agents} by agents", { open: tabs.length, agents: agentCount })}
          </span>
        ) : null}
        <Button
          size="xs"
          variant="destructive-outline"
          className="ms-auto"
          disabled={tabs.length === 0 || closingAll}
          onClick={() => void closeAll()}
        >
          <XIcon />
          <T>Close all</T>
        </Button>
      </div>
      {AsyncResult.isFailure(result) ? (
        <p className="text-sm text-muted-foreground">
          <T>
            This server runs a T3 Code build that can't list every tab at once. It needs the update
            with this page.
          </T>
        </p>
      ) : tabs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {AsyncResult.isInitial(result) ? gt("Loading…") : gt("No browser tabs are open.")}
        </p>
      ) : (
        [...byThread].map(([threadId, threadTabs]) => (
          <ThreadTabs
            key={threadId}
            threadRef={scopeThreadRef(environmentId, ThreadId.make(threadId))}
            tabs={threadTabs}
            onClose={close}
          />
        ))
      )}
    </section>
  );
}

function ThreadTabs(props: {
  threadRef: ScopedThreadRef;
  tabs: ReadonlyArray<PreviewSessionSnapshot>;
  onClose: (snapshot: PreviewSessionSnapshot) => Promise<unknown>;
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const thread = useThreadShell(props.threadRef);
  const nowMs = Date.parse(`${useNowMinute()}:00Z`);
  return (
    <section className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="min-w-0 truncate text-start text-sm font-medium hover:underline"
          onClick={() =>
            void navigate({
              to: "/$environmentId/$threadId",
              params: {
                environmentId: props.threadRef.environmentId,
                threadId: props.threadRef.threadId,
              },
            })
          }
        >
          {thread?.title ?? gt("Deleted or unknown thread")}
        </button>
        {thread?.settledOverride === "settled" ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            <T>settled</T>
          </span>
        ) : null}
        <Button
          size="xs"
          variant="ghost-muted"
          className="ms-auto"
          onClick={() => void Promise.all(props.tabs.map((tab) => props.onClose(tab)))}
        >
          {props.tabs.length === 1
            ? gt("Close tab")
            : gt("Close {count} tabs", { count: props.tabs.length })}
        </Button>
      </div>
      <ul className="flex flex-col divide-y rounded-lg border">
        {props.tabs.map((tab) => {
          const label = tabLabel(tab);
          const title = label?.title ?? gt("New tab");
          const url = label?.url ?? "";
          return (
            <li key={tab.tabId} className="flex items-center gap-3 px-3 py-2">
              <GlobeIcon className="size-4 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm">{title}</span>
                {url ? <span className="truncate text-xs text-muted-foreground">{url}</span> : null}
              </div>
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                {tab.automationOwner === undefined ? (
                  <>
                    <UserIcon className="size-3.5" />
                    {gt("You", { $context: "who opened a browser tab" })}
                  </>
                ) : (
                  <>
                    <BotIcon className="size-3.5" />
                    {gt("Agent", { $context: "who opened a browser tab" })}
                  </>
                )}
                <span aria-hidden>·</span>
                {formatRelativeTimeLabel(tab.updatedAt, nowMs)}
              </span>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={gt("Close tab")}
                onClick={() => void props.onClose(tab)}
              >
                <XIcon />
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
