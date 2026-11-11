import {
  CommandId,
  isDelegatedAppThread,
  type OrchestrationV2DomainEvent,
  type ProjectId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import {
  buildReplyQuestionPrompt,
  classifyReplyQuestion,
  parseReplyQuestionAnswer,
  replyQuestionTail,
} from "./replyQuestion.ts";

/** Marks finished runs whose final reply asks the user something in plain text. */
export class ReplyQuestionReactor extends Context.Service<
  ReplyQuestionReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly handle: (event: OrchestrationV2DomainEvent) => Effect.Effect<void>;
  }
>()("t3/orchestration-v2/ReplyQuestionReactor") {}

const isCompletedRun = (event: OrchestrationV2DomainEvent) =>
  event.type === "run.updated" && event.payload.status === "completed";

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const fileSystem = yield* FileSystem.FileSystem;

  // The generic prompt-in, text-out operation; every text generation provider supports it.
  const askModel = Effect.fn("ReplyQuestionReactor.askModel")(function* (input: {
    readonly projectId: ProjectId;
    readonly tail: string;
  }) {
    const settings = resolveProjectSettings(
      yield* serverSettings.getSettings,
      input.projectId,
    ).settings;
    // Providers run in a working directory; this check must not read a checkout.
    const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-reply-question-" });
    const result = yield* textGeneration.generateTranscriptionPostProcessing({
      cwd,
      prompt: buildReplyQuestionPrompt(input.tail),
      modelSelection: settings.textGenerationModelSelection,
    });
    return parseReplyQuestionAnswer(result.transcription);
  }, Effect.scoped);

  const handle: ReplyQuestionReactor["Service"]["handle"] = Effect.fn(
    "ReplyQuestionReactor.handle",
  )(
    function* (event) {
      if (event.type !== "run.updated" || event.payload.status !== "completed") return;
      const runId = event.payload.id;
      const { thread, messages } = yield* projections.getThreadRecords(
        event.threadId,
        ["messages"],
        { messageRoles: ["assistant"], messageRunIds: [runId] },
      );
      if (thread.deletedAt !== null || thread.replyCheck?.runId === runId) return;
      const reply = messages
        .filter((message) => message.runId === runId && message.text.trim().length > 0)
        .toSorted((left, right) => DateTime.Order(right.createdAt, left.createdAt))[0];
      // Agent-driven threads report to their parent agent, not to the user.
      const verdict =
        reply === undefined || thread.archivedAt !== null || isDelegatedAppThread(thread)
          ? "none"
          : classifyReplyQuestion(reply.text);
      const asksUser =
        verdict === "question" ||
        (verdict === "unsure" &&
          reply !== undefined &&
          (yield* askModel({
            projectId: thread.projectId,
            tail: replyQuestionTail(reply.text),
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("reply question check failed", { threadId: thread.id, cause }).pipe(
                Effect.as(false),
              ),
            ),
          )));
      // Recorded for every run: clients hold the completion notice until this lands.
      yield* engine.dispatch({
        type: "thread.reply-check.record",
        commandId: CommandId.make(`server:reply-check:${runId}`),
        threadId: thread.id,
        runId,
        asksUser,
      });
    },
    (effect, event) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("recording a reply check failed", { threadId: event.threadId, cause }),
        ),
      ),
  );

  const start: ReplyQuestionReactor["Service"]["start"] = Effect.fn("ReplyQuestionReactor.start")(
    function* () {
      const scope = yield* Effect.scope;
      // A model check takes seconds; fork it so the event stream never waits on it.
      yield* forkParked(
        Stream.runForEach(engine.streamDomainEvents, (event) =>
          isCompletedRun(event)
            ? Effect.forkIn(handle(event), scope).pipe(Effect.asVoid)
            : Effect.void,
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("reply question event stream failed", { cause }),
          ),
        ),
      );
    },
  );

  return { start, handle } satisfies ReplyQuestionReactor["Service"];
});

export const layer = Layer.effect(ReplyQuestionReactor, make);
