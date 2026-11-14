import {
  CommandId,
  MessageId,
  type OrchestrationV2ThreadShell,
  ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { threadHasUnfinishedWork } from "../orchestration-v2/Orchestrator.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as ManagedProjectFolders from "./ManagedProjectFolders.ts";
import * as ProjectService from "./ProjectService.ts";

export class ScratchThreadPromotionError extends Schema.TaggedError<ScratchThreadPromotionError>()(
  "ScratchThreadPromotionError",
  {
    reason: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.reason;
  }
}

export class ScratchThreadPromotion extends Context.Service<
  ScratchThreadPromotion,
  {
    /**
     * Turns a No project thread's folder into a project, in place, and moves every
     * thread working in that folder into it. Running it again finishes a partial move.
     */
    readonly promote: (input: {
      readonly threadId: ThreadId;
    }) => Effect.Effect<{ readonly projectId: ProjectId }, ScratchThreadPromotionError>;
    /**
     * Moves one No project thread into an existing project's root folder. Its live session
     * ends and the next turn resumes the conversation there; the old folder stays on disk.
     * `fromOwnTurn` lets a thread move itself: the move then happens when its turn ends.
     * `continuation` is queued as the thread's next message once it has moved.
     */
    readonly moveToProject: (input: {
      readonly threadId: ThreadId;
      readonly projectId: ProjectId;
      readonly fromOwnTurn: boolean;
      readonly continuation?: string | undefined;
    }) => Effect.Effect<
      {
        readonly projectId: ProjectId;
        readonly workspaceRoot: string;
        readonly movesWhenTurnEnds: boolean;
      },
      ScratchThreadPromotionError
    >;
  }
>()("t3/project/ScratchThreadPromotion") {}

const OWN_TURN_WAIT_MS = 24 * 60 * 60 * 1_000;

const make = Effect.gen(function* () {
  const layerScope = yield* Effect.scope;
  const managedFolders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const projects = yield* ProjectService.ProjectService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const scheduledTasks = yield* ScheduledTaskService.ScheduledTaskService;
  const random = yield* SecureRandom.SecureRandom;
  const path = yield* Path.Path;

  const fail = (reason: string) => (cause: unknown) =>
    new ScratchThreadPromotionError({ reason, cause });

  const promote: ScratchThreadPromotion["Service"]["promote"] = Effect.fn(
    "ScratchThreadPromotion.promote",
  )(function* (input) {
    const thread = yield* threads.getThreadShell(input.threadId).pipe(
      Effect.mapError(fail("Could not read the thread.")),
      Effect.filterOrFail(
        (shell) => shell !== null,
        () => new ScratchThreadPromotionError({ reason: "Thread not found." }),
      ),
    );
    const project = yield* projects
      .getById(thread.projectId)
      .pipe(Effect.mapError(fail("Could not read the thread's project.")));
    const folder = thread.worktreePath ?? Option.getOrUndefined(project)?.workspaceRoot;
    const scratchRoot = Option.getOrUndefined(yield* managedFolders.scratchRoot);
    const isScratch = yield* managedFolders.isScratchProject(thread.projectId);
    // A thread already rooted at its folder is a partial earlier promotion; finish it.
    const alreadyPromoted =
      Option.isSome(project) && project.value.workspaceRoot === folder && !isScratch;
    if (
      folder === undefined ||
      scratchRoot === undefined ||
      path.dirname(folder) !== scratchRoot ||
      !(isScratch || alreadyPromoted)
    ) {
      return yield* new ScratchThreadPromotionError({
        reason: "Only a No project thread with its own folder can become a project.",
      });
    }

    const snapshot = yield* Effect.flatten(
      threads.readShellSnapshot({ worktreePath: folder }),
    ).pipe(Effect.mapError(fail("Could not read the threads in this folder.")));
    const moveSet = new Map<ThreadId, OrchestrationV2ThreadShell>();
    if (isScratch) moveSet.set(thread.id, thread);
    for (const candidate of [...snapshot.threads, ...snapshot.archivedThreads]) {
      if (yield* managedFolders.isScratchProject(candidate.projectId)) {
        moveSet.set(candidate.id, candidate);
      }
    }

    for (const candidate of moveSet.values()) {
      const records = yield* threads
        .getThreadRecords(candidate.id, ["runs", "runtimeRequests"], { turnItemTypes: [] })
        .pipe(Effect.mapError(fail(`Could not read "${candidate.title}".`)));
      if (threadHasUnfinishedWork(records)) {
        return yield* new ScratchThreadPromotionError({
          reason: `"${candidate.title}" is still working. Finish or stop it first.`,
        });
      }
    }

    return yield* Effect.uninterruptible(
      Effect.gen(function* () {
        const projectId = yield* createProject(thread.title, folder);
        yield* scheduledTasks
          .moveThreadTasks({ threadIds: [...moveSet.keys()], projectId })
          .pipe(Effect.mapError(fail("Could not move the thread's scheduled tasks.")));
        for (const candidate of moveSet.values()) {
          const commandId = CommandId.make(`scratch-promotion:${yield* randomId}`);
          yield* threads
            .dispatch({
              type: "thread.project.adopt-folder",
              commandId,
              threadId: candidate.id,
              projectId,
            })
            .pipe(Effect.mapError(fail(`Could not move "${candidate.title}". Try again.`)));
        }
        return { projectId };
      }),
    );
  });

  const moveToProject: ScratchThreadPromotion["Service"]["moveToProject"] = Effect.fn(
    "ScratchThreadPromotion.moveToProject",
  )(function* (input) {
    const thread = yield* threads.getThreadShell(input.threadId).pipe(
      Effect.mapError(fail("Could not read the thread.")),
      Effect.filterOrFail(
        (shell): shell is OrchestrationV2ThreadShell => shell !== null && shell.deletedAt === null,
        () => new ScratchThreadPromotionError({ reason: "Thread not found." }),
      ),
    );
    const target = yield* projects.getById(input.projectId).pipe(
      Effect.mapError(fail("Could not read the project.")),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(new ScratchThreadPromotionError({ reason: "Project not found." })),
          onSome: Effect.succeed,
        }),
      ),
    );
    if (yield* managedFolders.isScratchProject(target.id)) {
      return yield* new ScratchThreadPromotionError({
        reason: "Pick a project other than No project.",
      });
    }
    const moved = { projectId: target.id, workspaceRoot: target.workspaceRoot };
    const moveTasks = scheduledTasks
      .moveThreadTasks({ threadIds: [thread.id], projectId: target.id })
      .pipe(Effect.mapError(fail("Could not move the thread's scheduled tasks.")));
    // Already there: a retry after a lost reply, which only needs its tasks moved.
    if (thread.projectId === target.id) {
      yield* moveTasks;
      return { ...moved, movesWhenTurnEnds: false };
    }
    if (!(yield* managedFolders.isScratchProject(thread.projectId))) {
      return yield* new ScratchThreadPromotionError({
        reason: "Only a No project thread can move into a project.",
      });
    }
    const records = yield* threads
      .getThreadRecords(thread.id, ["runs", "runtimeRequests"], { turnItemTypes: [] })
      .pipe(Effect.mapError(fail(`Could not read "${thread.title}".`)));
    const busy = threadHasUnfinishedWork(records);
    if (busy && !input.fromOwnTurn) {
      return yield* new ScratchThreadPromotionError({
        reason: `"${thread.title}" is still working. Finish or stop it first.`,
      });
    }
    const move = Effect.gen(function* () {
      yield* threads
        .dispatch({
          type: "thread.project.move",
          commandId: CommandId.make(`scratch-move:${yield* randomId}`),
          threadId: thread.id,
          projectId: target.id,
        })
        .pipe(Effect.mapError(fail(`Could not move "${thread.title}". Try again.`)));
      yield* moveTasks;
    });
    const continueThere = Effect.gen(function* () {
      if (input.continuation === undefined) return;
      const id = yield* randomId;
      yield* threads
        .sendToThread({
          projectId: target.id,
          commandId: CommandId.make(`scratch-move-continuation:${id}`),
          threadId: thread.id,
          messageId: MessageId.make(`scratch-move-continuation:${id}`),
          text: input.continuation,
          attachments: [],
          mode: "queue",
          createdBy: "agent",
          creationSource: "mcp",
        })
        .pipe(Effect.mapError(fail("Moved, but the continuation was not queued.")));
    });
    if (!busy) {
      yield* move;
      yield* continueThere;
      return { ...moved, movesWhenTurnEnds: false };
    }
    // Moving ends the live session, so a thread moving itself waits for its turn to end:
    // cutting the turn off leaves its tool call open and reads as a failed turn.
    yield* threads
      .waitForThread({
        projectId: thread.projectId,
        threadId: thread.id,
        ...(thread.activeRunId === null ? {} : { runId: thread.activeRunId }),
        timeoutMs: OWN_TURN_WAIT_MS,
      })
      .pipe(
        Effect.flatMap(({ run, timedOut }) =>
          timedOut
            ? Effect.void
            : move.pipe(Effect.andThen(run?.status === "completed" ? continueThere : Effect.void)),
        ),
        Effect.ignoreCause({ log: true }),
        Effect.forkIn(layerScope),
      );
    return { ...moved, movesWhenTurnEnds: true };
  });

  const randomId = random.uuidV4();

  // bootstrap returns the project that already owns the folder, so retries reuse it.
  const createProject = Effect.fn("ScratchThreadPromotion.createProject")(function* (
    title: string,
    workspaceRoot: string,
  ) {
    const id = yield* randomId;
    return yield* projects
      .bootstrap({
        commandId: CommandId.make(`scratch-promotion-project:${id}`),
        projectId: ProjectId.make(id),
        title,
        workspaceRoot,
      })
      .pipe(
        Effect.map(({ project }) => project.id),
        // bootstrap reads before locking; racing creates return the winner in a conflict.
        Effect.catchTags({
          ProjectConflictError: (conflict) => Effect.succeed(conflict.conflictingProjectId),
        }),
        Effect.mapError(fail("Could not create the project.")),
      );
  });

  return ScratchThreadPromotion.of({ promote, moveToProject });
});

export const layer = Layer.effect(ScratchThreadPromotion, make);
