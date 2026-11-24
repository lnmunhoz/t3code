import { useAtomValue } from "@effect/atom-react";
import type { SideThreadOpenIntent } from "@t3tools/client-runtime/side-thread";
import type {
  EnvironmentId,
  OrchestrationV2Subagent,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { useGT } from "gt-react";

import { useSideThreadTrigger } from "../../hooks/useSideThreadTrigger";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
} from "../../providerInstances";
import { useEnvironmentProviders } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { ThreadHoverCardPopup } from "../ThreadHoverCard";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AgentElapsed } from "./AgentElapsed";
import { SubagentTooltipContent } from "./SubagentTooltipContent";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadRelationshipIcon } from "./ThreadRelationshipIcon";

export interface BackgroundSubagentRow {
  readonly taskId: string;
  readonly title: string;
  readonly childThreadId: ThreadId | null;
  readonly driver: ProviderDriverKind | undefined;
  readonly providerInstanceId: ProviderInstanceId | undefined;
  readonly origin: OrchestrationV2Subagent["origin"];
  readonly startedAt: string | null;
  readonly progress: string | null;
}

/** Subagents the thread waits on, drawn like the thread details panel's Lineage rows. */
export function BackgroundSubagentRows(props: {
  readonly environmentId: EnvironmentId;
  readonly rows: ReadonlyArray<BackgroundSubagentRow>;
  readonly onOpenThread: (threadId: ThreadId, intent: SideThreadOpenIntent) => void;
}) {
  const gt = useGT();
  const trigger = useSideThreadTrigger();
  const providers = useEnvironmentProviders().get(props.environmentId);
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(props.environmentId));
  const derivedEntries = deriveProviderInstanceEntries(providers ?? []);
  const providerEntries = settings
    ? applyProviderInstanceSettings(derivedEntries, settings, null)
    : derivedEntries;
  return (
    <ul
      aria-label={gt("Subagents")}
      // Four and a half rows, so a longer list shows it scrolls instead of pushing the composer.
      className="m-0 -mx-1 max-h-36 list-none overflow-y-auto p-0"
    >
      {props.rows.map((row) => {
        const { childThreadId, providerInstanceId } = row;
        const provider = providers?.find((entry) => entry.instanceId === providerInstanceId);
        const driver = row.driver ?? provider?.driver;
        // Pending work is still going, whatever the tool call that launched it reports.
        const agent = { status: "running", startedAt: row.startedAt, completedAt: null } as const;
        return (
          <li key={row.taskId}>
            <Tooltip>
              <TooltipTrigger
                delay={200}
                render={
                  <ThreadDetailsControl
                    part="row"
                    aria-label={gt("Open {title} chat", { title: row.title })}
                    disabled={childThreadId === null}
                    {...(childThreadId === null
                      ? {}
                      : trigger((intent) => props.onOpenThread(childThreadId, intent)))}
                  />
                }
              >
                <ThreadRelationshipIcon
                  driver={driver}
                  provider={provider}
                  providerEntries={providerEntries}
                  status={agent.status}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-left text-sm font-medium leading-4 text-foreground/85">
                    {row.title}
                  </span>
                </span>
                <span className="shrink-0 text-2xs font-normal tabular-nums text-muted-foreground empty:hidden">
                  <AgentElapsed agent={agent} compact />
                </span>
              </TooltipTrigger>
              {providerInstanceId === undefined ? (
                <TooltipPopup side="top">{row.title}</TooltipPopup>
              ) : (
                <ThreadHoverCardPopup side="top">
                  <SubagentTooltipContent
                    title={row.title}
                    model={null}
                    providerInstanceId={providerInstanceId}
                    origin={row.origin}
                    provider={provider}
                    providers={providers}
                    driver={driver}
                    elapsed={<AgentElapsed agent={agent} />}
                    status={agent.status}
                    progress={row.progress}
                  />
                </ThreadHoverCardPopup>
              )}
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}
