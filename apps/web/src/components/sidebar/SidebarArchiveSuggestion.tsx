import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { ArchiveIcon, CheckIcon, ChevronDownIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { comboStepDelayMs, createArchiveComboPlayer } from "../../archiveComboSound";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useNowMinute } from "../../hooks/useNowMinute";
import { getClientSettings, useClientSettings } from "../../hooks/useSettings";
import { useThreadActions } from "../../hooks/useThreadActions";
import { cn } from "../../lib/utils";
import { useServerConfigs } from "../../state/entities";
import { readEnvironmentScope } from "../../state/session";
import { formatRelativeElapsed } from "../../timestampFormat";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  formatIdleHours,
  keepIdleThreads,
  resolveIdleArchiveCandidates,
  type IdleArchiveCandidate,
  type KeptIdleThreads,
} from "./idleArchiveSuggestions";

const KEPT_IDLE_THREADS_KEY = "t3code:sidebar:kept-idle-threads";
const KeptIdleThreadsSchema = Schema.Record(Schema.String, Schema.String);
const NO_KEPT_THREADS: KeptIdleThreads = {};
const NO_EXCLUDED_KEYS: ReadonlySet<string> = new Set();
// How long the finished combo stays on screen before the card goes away.
const COMBO_RESULT_HOLD_MS = 1600;

const hoverRevealClassName =
  "pointer-events-none inline-flex shrink-0 cursor-pointer items-center rounded-md px-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100";

interface ComboRun {
  readonly items: ReadonlyArray<IdleArchiveCandidate>;
  readonly archivedKeys: ReadonlySet<string>;
  readonly failedKeys: ReadonlySet<string>;
  /** Archives in a row since the last failure; it sets the pitch. */
  readonly streak: number;
  readonly finished: boolean;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Suggests archiving threads that have sat idle past the threshold in Settings › General. */
export function SidebarArchiveSuggestion(props: {
  /** The threads the sidebar lists in the current project scope. */
  threads: ReadonlyArray<EnvironmentThreadShell>;
  /** Every loaded thread, so keeping a thread survives switching project scope. */
  allThreads: ReadonlyArray<EnvironmentThreadShell>;
  routeThreadKey: string | null;
  projectByKey: ReadonlyMap<string, EnvironmentProject>;
  onOpen: (threadRef: ScopedThreadRef) => void;
}) {
  const idleHours = useClientSettings((settings) => settings.sidebarArchiveSuggestionHours);
  // A minute clock, so threads cross the threshold without other sidebar activity.
  // Its snapshot is a UTC "YYYY-MM-DDTHH:MM" with no zone suffix.
  const nowMs = Date.parse(`${useNowMinute()}Z`);
  const serverConfigs = useServerConfigs();
  const [kept, setKept] = useLocalStorage(
    KEPT_IDLE_THREADS_KEY,
    NO_KEPT_THREADS,
    KeptIdleThreadsSchema,
  );
  const { archiveThread } = useThreadActions();
  const [expanded, setExpanded] = useState(false);
  const [run, setRun] = useState<ComboRun | null>(null);

  const candidates =
    idleHours === null
      ? []
      : resolveIdleArchiveCandidates({
          threads: props.threads.filter(
            (thread) =>
              serverConfigs.has(thread.environmentId) &&
              readEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope),
          ),
          idleHours,
          nowMs,
          kept,
          excludedKeys:
            props.routeThreadKey === null ? NO_EXCLUDED_KEYS : new Set([props.routeThreadKey]),
        });
  if (run !== null) {
    return <ComboRunCard run={run} projectByKey={props.projectByKey} />;
  }
  if (idleHours === null || candidates.length === 0) return null;

  const keep = (keys: ReadonlyArray<string>) => {
    const liveKeys = new Set(
      props.allThreads.map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      ),
    );
    setKept(keepIdleThreads(kept, keys, new Date().toISOString(), liveKeys));
  };

  // Archives one at a time so each thread lands as its own hit of the combo.
  const archive = async (targets: ReadonlyArray<IdleArchiveCandidate>) => {
    const comboSettings = getClientSettings().archiveComboSound;
    const player = createArchiveComboPlayer(comboSettings);
    setExpanded(false);
    const archivedKeys = new Set<string>();
    const failedKeys = new Set<string>();
    let streak = 0;
    let lastHit = -1;
    let firstError: unknown = null;
    setRun({
      items: targets,
      archivedKeys: new Set(),
      failedKeys: new Set(),
      streak,
      finished: false,
    });
    for (let index = 0; index < targets.length; index++) {
      const { key, thread } = targets[index]!;
      const startedAt = performance.now();
      const result = await archiveThread(scopeThreadRef(thread.environmentId, thread.id));
      if (result._tag === "Failure") {
        failedKeys.add(key);
        streak = 0;
        if (firstError === null && !isAtomCommandInterrupted(result)) {
          firstError = squashAtomCommandFailure(result) ?? new Error("Failed to archive.");
        }
      } else {
        archivedKeys.add(key);
        player?.hit(streak);
        lastHit = streak;
        streak += 1;
      }
      setRun({
        items: targets,
        archivedKeys: new Set(archivedKeys),
        failedKeys: new Set(failedKeys),
        streak,
        finished: false,
      });
      const remaining =
        comboStepDelayMs(comboSettings.stepMs, index) - (performance.now() - startedAt);
      if (index < targets.length - 1 && remaining > 0) await wait(remaining);
    }
    if (lastHit >= 0) player?.finale(lastHit);
    setRun({ items: targets, archivedKeys, failedKeys, streak, finished: true });
    if (firstError !== null) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `Failed to archive ${failedKeys.size} thread${failedKeys.size === 1 ? "" : "s"}`,
          description: firstError instanceof Error ? firstError.message : "An error occurred.",
        }),
      );
    }
    setTimeout(() => setRun(null), COMBO_RESULT_HOLD_MS);
  };

  const count = candidates.length;
  const idleLabel = formatIdleHours(idleHours);
  return (
    <li className="list-none py-0.5" data-testid="sidebar-archive-suggestion">
      <div
        role="group"
        aria-label={`Archive suggestion: ${count} thread${count === 1 ? "" : "s"} idle for ${idleLabel}`}
        className="group/archive-suggestion rounded-md bg-muted/40 px-(--sidebar-row-content-inset) py-(--sidebar-content-inset) text-sidebar-foreground"
      >
        <div className="flex h-5 min-w-0 items-center gap-1.5">
          <ArchiveIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-secondary-label">
            Idle for {idleLabel}+
          </span>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Keep these threads"
                  onClick={() => keep(candidates.map((candidate) => candidate.key))}
                  className={`${hoverRevealClassName} group-hover/archive-suggestion:pointer-events-auto group-hover/archive-suggestion:opacity-100`}
                >
                  <XIcon className="size-3" />
                </button>
              }
            />
            <TooltipPopup side="top">Keep these threads</TooltipPopup>
          </Tooltip>
        </div>
        <div className="mt-0.5 truncate text-sm font-medium text-foreground/90">
          Archive {count} idle thread{count === 1 ? "" : "s"}?
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <Button size="xs" variant="secondary" onClick={() => void archive(candidates)}>
            {count === 1 ? "Archive" : "Archive all"}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            Review
            <ChevronDownIcon aria-hidden className={expanded ? "size-3 rotate-180" : "size-3"} />
          </Button>
        </div>
        {expanded ? (
          <ul className="mt-1.5 -mx-1 max-h-64 overflow-y-auto">
            {candidates.map((candidate) => {
              const { thread } = candidate;
              const project = props.projectByKey.get(`${thread.environmentId}:${thread.projectId}`);
              return (
                <li key={candidate.key} className="group/archive-candidate flex items-center">
                  <button
                    type="button"
                    onClick={() => props.onOpen(scopeThreadRef(thread.environmentId, thread.id))}
                    className="flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-1 text-left text-xs hover:bg-sidebar-row-hover"
                  >
                    {project ? (
                      <ProjectFavicon project={project} className="size-3.5 shrink-0" />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate text-foreground/90">
                      {thread.title}
                    </span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {formatRelativeElapsed(nowMs - candidate.idleSinceMs).value}
                    </span>
                  </button>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          aria-label={`Keep ${thread.title}`}
                          onClick={() => keep([candidate.key])}
                          className={`${hoverRevealClassName} h-7 group-hover/archive-candidate:pointer-events-auto group-hover/archive-candidate:opacity-100`}
                        >
                          <XIcon className="size-3" />
                        </button>
                      }
                    />
                    <TooltipPopup side="top">Keep</TooltipPopup>
                  </Tooltip>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

/** The card while a combo plays: rows check off and fold away as each archive lands. */
function ComboRunCard({
  run,
  projectByKey,
}: {
  run: ComboRun;
  projectByKey: ReadonlyMap<string, EnvironmentProject>;
}) {
  const total = run.items.length;
  const archived = run.archivedKeys.size;
  const failed = run.failedKeys.size;
  const done = archived + failed;
  const title = run.finished
    ? `Archived ${archived} thread${archived === 1 ? "" : "s"}${failed > 0 ? `, ${failed} failed` : ""}`
    : `Archiving ${Math.min(done + 1, total)} of ${total}`;
  return (
    <li className="list-none py-0.5" data-testid="sidebar-archive-combo">
      <div
        role="status"
        aria-live="polite"
        aria-label={title}
        className={cn(
          "rounded-md px-(--sidebar-row-content-inset) py-(--sidebar-content-inset) text-sidebar-foreground transition-colors duration-300 motion-reduce:transition-none",
          run.finished && failed === 0 ? "bg-success/8" : "bg-muted/40",
        )}
      >
        <div className="flex h-5 min-w-0 items-center gap-1.5">
          <ArchiveIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-secondary-label">
            {title}
          </span>
          {run.streak > 1 ? (
            // Keyed by streak so each hit remounts it and replays the pop.
            <span
              key={run.streak}
              aria-hidden
              className="shrink-0 text-xs font-semibold text-success tabular-nums transition-transform duration-200 ease-out starting:scale-150 motion-reduce:transition-none"
            >
              ×{run.streak}
            </span>
          ) : null}
        </div>
        <div aria-hidden className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full origin-left bg-success transition-transform duration-200 ease-out motion-reduce:transition-none"
            style={{ transform: `scaleX(${total === 0 ? 1 : done / total})` }}
          />
        </div>
        <ul aria-hidden className="mt-1 -mx-1 max-h-64 overflow-hidden">
          {run.items.map(({ key, thread }) => {
            const isArchived = run.archivedKeys.has(key);
            const isFailed = run.failedKeys.has(key);
            const project = projectByKey.get(`${thread.environmentId}:${thread.projectId}`);
            return (
              <li
                key={key}
                className={cn(
                  "grid transition-[grid-template-rows,opacity] delay-150 duration-300 ease-out motion-reduce:transition-none",
                  isArchived ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
                )}
              >
                <div className="min-h-0 overflow-hidden">
                  <div className="relative flex h-7 items-center gap-1.5 px-1 text-xs">
                    {isArchived ? (
                      <CheckIcon className="size-3.5 shrink-0 text-success" />
                    ) : isFailed ? (
                      <XIcon className="size-3.5 shrink-0 text-destructive-foreground" />
                    ) : project ? (
                      <ProjectFavicon project={project} className="size-3.5 shrink-0" />
                    ) : null}
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate",
                        isArchived ? "text-success" : "text-foreground/90",
                      )}
                    >
                      {thread.title}
                    </span>
                    {isArchived ? (
                      <span className="absolute right-1 text-xs font-semibold text-success opacity-0 -translate-y-2 transition-[opacity,translate] duration-500 ease-out starting:translate-y-0 starting:opacity-100 motion-reduce:hidden">
                        +1
                      </span>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </li>
  );
}
