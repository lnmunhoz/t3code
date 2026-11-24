import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, PreviewSessionSnapshot, ScopedThreadRef } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

import { useQuietThreadShells, useThreadShell } from "~/state/entities";
import { previewEnvironment } from "~/state/preview";

import { type PinnedTab, pinnedTabsForThread } from "./pinnedTabs.logic";

interface PinnedSessions {
  readonly serverEpoch: string | null;
  readonly sessions: ReadonlyArray<PreviewSessionSnapshot>;
}

const NO_PINS: PinnedSessions = { serverEpoch: null, sessions: [] };

// Navigation is the busiest event and never changes a pin, so only opens, closes and
// adjustments (where pinning happens) re-read the environment's tabs.
const pinnedSessionsAtom = Atom.family((environmentId: EnvironmentId) => {
  const listAtom = previewEnvironment.list({ environmentId, input: {} });
  const eventsAtom = previewEnvironment.events({ environmentId, input: {} });
  return Atom.make((get): PinnedSessions => {
    get.subscribe(eventsAtom, (event) => {
      if (!AsyncResult.isSuccess(event)) return;
      const type = event.value.type;
      if (type === "opened" || type === "closed" || type === "resized") get.refresh(listAtom);
    });
    get.mount(eventsAtom);
    const result = get(listAtom);
    // A server too old to list every thread's tabs fails here; it has no pins either.
    if (!AsyncResult.isSuccess(result)) return NO_PINS;
    return {
      serverEpoch: result.value.serverEpoch,
      sessions: result.value.sessions.filter((session) => session.pinned === true),
    };
  }).pipe(Atom.setIdleTTL(1_000), Atom.withLabel(`preview:pinned-tabs:${environmentId}`));
});

const NO_PINNED_TABS = { serverEpoch: null, tabs: [] as ReadonlyArray<PinnedTab> };
const EMPTY_ATOM = Atom.make(NO_PINS);

/** The live tabs other threads of `threadRef`'s project pinned, with their server epoch. */
export function useProjectPinnedTabs(threadRef: ScopedThreadRef | null): {
  readonly serverEpoch: string | null;
  readonly tabs: ReadonlyArray<PinnedTab>;
} {
  const thread = useThreadShell(threadRef);
  const shells = useQuietThreadShells();
  const pinned = useAtomValue(
    threadRef === null ? EMPTY_ATOM : pinnedSessionsAtom(threadRef.environmentId),
  );
  if (thread === null || pinned.sessions.length === 0) return NO_PINNED_TABS;
  return {
    serverEpoch: pinned.serverEpoch,
    tabs: pinnedTabsForThread(pinned.sessions, shells, thread),
  };
}
