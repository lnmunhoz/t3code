import type {
  EnvironmentId,
  OrchestrationV2BackgroundProgress,
  OrchestrationV2PendingBackgroundTask,
  ThreadId,
} from "@t3tools/contracts";

import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";

const NO_PROGRESS: OrchestrationV2BackgroundProgress = [];

/** Progress lines of the thread's running background commands, subscribed only while it has some. */
export function useBackgroundProgress(
  environmentId: EnvironmentId,
  threadId: ThreadId | null,
  tasks: ReadonlyArray<OrchestrationV2PendingBackgroundTask>,
): OrchestrationV2BackgroundProgress {
  const watched = threadId !== null && tasks.some((task) => task.kind === "command");
  const { data } = useEnvironmentQuery(
    watched
      ? orchestrationEnvironment.v2.backgroundProgress({ environmentId, input: { threadId } })
      : null,
  );
  // Servers without the method fail the subscription, which reads as no progress.
  return data ?? NO_PROGRESS;
}
