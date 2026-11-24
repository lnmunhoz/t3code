import { ChevronRightIcon, CircleAlertIcon, RefreshCwIcon } from "lucide-react";
import * as Schema from "effect/Schema";
import type { ReactNode } from "react";

import { threadSyncLabel, type ThreadSyncPhase } from "../../threadSync";
import { cn } from "~/lib/utils";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useMessages } from "gt-react";

/** A line of thread state for the end of the timeline. */
export interface ThreadNowItem {
  readonly id: string;
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  /** Rows under the line, such as the subagents it waits on; the title expands them. */
  readonly body?: ReactNode;
}

// One device-wide choice, so the list stays open or closed from turn to turn.
const BODY_OPEN_STORAGE_KEY = "t3code:thread-now-body-open:v1";

/** Matches ThreadStatusLine, so every line at the end of the timeline reads as one family. */
const lineClassName = cn(
  "mx-auto flex w-full min-w-0 max-w-(--chat-content-max-width) items-center gap-1.5 px-1 pb-2 text-xs text-muted-foreground [&_svg]:size-3.5 [&_svg]:shrink-0",
  // Inline actions keep their text size but get a finger-sized hit area on touch.
  "pointer-coarse:[&_[data-slot=inline-button]]:relative pointer-coarse:[&_[data-slot=inline-button]]:after:absolute pointer-coarse:[&_[data-slot=inline-button]]:after:-inset-x-1.5 pointer-coarse:[&_[data-slot=inline-button]]:after:-inset-y-3.5",
  "transition-opacity duration-150 ease-out starting:opacity-0 motion-reduce:transition-none",
);

/** One line of thread state at the end of the timeline: icon, title, detail, then actions. */
function ThreadNowLine({
  item,
  announce = false,
}: {
  readonly item: ThreadNowItem;
  /** Announces the line when it appears; only for something that needs the user. */
  readonly announce?: boolean;
}) {
  const [bodyOpen, setBodyOpen] = useLocalStorage(BODY_OPEN_STORAGE_KEY, false, Schema.Boolean);
  const open = item.body !== undefined && bodyOpen;
  const text = (
    <>
      {item.title}
      {item.description ? (
        <>
          {" "}
          <span className="ms-0.5 text-muted-foreground/60 light:text-muted-foreground/80">
            {item.description}
          </span>
        </>
      ) : null}
    </>
  );
  const line = (
    <div
      role={announce ? "alert" : undefined}
      className={cn(lineClassName, "items-baseline", open && "pb-1")}
      data-thread-now-line="true"
    >
      <span aria-hidden className="flex size-3.5 shrink-0 self-center items-center justify-center">
        {item.icon}
      </span>
      {item.body === undefined ? (
        <span className="min-w-0 truncate">{text}</span>
      ) : (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setBodyOpen(!open)}
          className="flex min-w-0 cursor-pointer items-baseline gap-1 rounded-sm text-start outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <span className="min-w-0 truncate">{text}</span>
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "self-center transition-transform duration-150 motion-reduce:transition-none",
              open && "rotate-90",
            )}
          />
        </button>
      )}
      {item.actions ? (
        <span className="ms-1.5 flex shrink-0 items-baseline gap-2.5">{item.actions}</span>
      ) : null}
    </div>
  );
  if (!open) return line;
  return (
    <>
      {line}
      <div className="mx-auto w-full min-w-0 max-w-(--chat-content-max-width) px-1 pb-2">
        {item.body}
      </div>
    </>
  );
}

function ThreadSyncLine({ phase }: { readonly phase: ThreadSyncPhase }) {
  const m = useMessages();
  return (
    <div
      className={lineClassName}
      role={phase === "failed" ? "alert" : "status"}
      data-composer-sync-status={phase}
    >
      {phase === "failed" ? <CircleAlertIcon aria-hidden /> : <RefreshCwIcon aria-hidden />}
      <span className="truncate">{threadSyncLabel(phase, m)}</span>
    </div>
  );
}

/**
 * What the thread is doing now, at the end of the timeline: what needs you, background work,
 * the sync status while messages load, then the goal.
 */
export function ThreadNow({
  attention,
  work,
  syncPhase,
  goal,
}: {
  /** Something that needs you elsewhere, such as a subagent's question. */
  readonly attention: ThreadNowItem | null;
  readonly work: ThreadNowItem | null;
  readonly syncPhase: ThreadSyncPhase | null;
  readonly goal: ThreadNowItem | null;
}): ReactNode {
  return (
    <>
      {attention ? <ThreadNowLine item={attention} announce /> : null}
      {work ? <ThreadNowLine item={work} /> : null}
      {syncPhase ? <ThreadSyncLine phase={syncPhase} /> : null}
      {goal ? <ThreadNowLine item={goal} /> : null}
    </>
  );
}
