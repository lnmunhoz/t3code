import { toServerClock } from "@t3tools/client-runtime/clock";
import { formatWorkingDurationLabel } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId } from "@t3tools/contracts";
import { T, useGT, useMessages, Var } from "gt-react";
import { CircleDashedIcon } from "lucide-react";

import { EnvironmentMachineIcon } from "~/components/EnvironmentMachineIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useNowSecond } from "~/hooks/useNowSecond";
import {
  useEnvironmentIdentities,
  useEnvironmentMachines,
  usePrimaryEnvironmentId,
} from "~/state/environments";
import { useQuietThreadShells } from "~/state/entities";

import { chatLiveStates } from "./taskLive";
import {
  taskLiveStates,
  type TaskItem,
  type TaskLiveState,
  type WorkingTask,
} from "./taskBoard.logic";

/** Every open task's live state from its chats: working now, or really waiting on you. */
export function useTaskLiveStates(
  projects: ReadonlyArray<TaskItem>,
): ReadonlyMap<string, TaskLiveState> {
  const shells = useQuietThreadShells();
  return taskLiveStates(projects, chatLiveStates(shells));
}

/** "Working 7m", like the sidebar shows on the chat. */
export function TaskWorkingBadge({ working }: { working: WorkingTask }) {
  return (
    <span className="mt-0.5 flex shrink-0 items-center gap-1 text-info-foreground text-xs">
      <CircleDashedIcon aria-hidden className="size-3.5" />
      <T>Working</T>
      {working.startedAt ? (
        <WorkingDuration environmentId={working.environmentId} startedAt={working.startedAt} />
      ) : null}
      <RemoteMachine environmentId={working.environmentId} />
    </span>
  );
}

function WorkingDuration(props: { environmentId: string; startedAt: string }) {
  const nowMs = useNowSecond();
  const messages = useMessages();
  const startedMs = Date.parse(props.startedAt);
  if (Number.isNaN(startedMs)) return null;
  return (
    <span className="tabular-nums">
      {formatWorkingDurationLabel(
        toServerClock(props.environmentId as EnvironmentId, nowMs) - startedMs,
        messages,
      )}
    </span>
  );
}

/**
 * A soft pulse behind a row a chat is working on. Only this layer fades, so the row's text stays
 * steady. Its parent needs `relative isolate`, which keeps it behind the text.
 */
export function WorkingGlow() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 rounded-md bg-info/10 motion-safe:animate-pulse"
    />
  );
}

/**
 * "· [server] box" when the chat runs on another machine, with the icon and name the sidebar's
 * thread hover card uses. Nothing for this Mac.
 */
function RemoteMachine({ environmentId }: { environmentId: string }) {
  const primary = usePrimaryEnvironmentId();
  const identities = useEnvironmentIdentities();
  const machines = useEnvironmentMachines();
  const gt = useGT();
  if (primary === null || environmentId === primary) return null;
  const id = environmentId as EnvironmentId;
  const label =
    identities.find((identity) => identity.environmentId === id)?.label ??
    gt("Remote", { $context: "machine label" });
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="flex min-w-0 items-center gap-1 text-muted-foreground" />}
      >
        <EnvironmentMachineIcon
          aria-hidden
          kind={machines.get(id) ?? "server"}
          className="size-3 shrink-0"
        />
        <span className="max-w-24 truncate">{label}</span>
      </TooltipTrigger>
      <TooltipPopup side="top">
        <T>
          Running on <Var>{label}</Var>
        </T>
      </TooltipPopup>
    </Tooltip>
  );
}
