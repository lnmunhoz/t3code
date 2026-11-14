import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";

import type { BackgroundProgressLine } from "../BackgroundProgress.ts";
import {
  claudeTaskOutputRoot,
  tailClaudeTaskOutput,
  watchClaudeTaskProgress,
} from "./ClaudeTaskOutputTail.ts";

const SESSION_ID = "0c91bb28-9e89-4889-bd22-3de9880233d3";
const TASK_ID = "bk6xreeye";

const makeTaskFile = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "claude-task-output-" });
  const tasks = path.join(root, "-private-tmp-project", SESSION_ID, "tasks");
  return { root, tasks, file: path.join(tasks, `${TASK_ID}.output`) };
});

// TestClock cannot interleave with real filesystem I/O; tests that wait on a poll use the live clock.
describe("tailClaudeTaskOutput", () => {
  it.live("follows a file that appears after the task starts, across split characters", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const { root, tasks, file } = yield* makeTaskFile;
        const chunks = yield* Queue.unbounded<string>();
        yield* tailClaudeTaskOutput({
          root,
          sessionId: SESSION_ID,
          taskId: TASK_ID,
          stop: yield* Deferred.make<void>(),
          onChunk: (chunk) => Queue.offer(chunks, chunk),
        }).pipe(Effect.forkScoped);

        yield* fileSystem.makeDirectory(tasks, { recursive: true });
        // Split the two-byte é across writes.
        const encoded = new TextEncoder().encode("café 1\n");
        yield* fileSystem.writeFile(file, encoded.subarray(0, 4));
        assert.equal(yield* Queue.take(chunks), "caf");

        yield* fileSystem.writeFile(file, encoded);
        assert.equal(yield* Queue.take(chunks), "é 1\n");
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("drops a split character when the file is truncated and rewritten", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const { root, tasks, file } = yield* makeTaskFile;
        yield* fileSystem.makeDirectory(tasks, { recursive: true });
        // End the first read inside the two-byte é.
        yield* fileSystem.writeFile(file, new TextEncoder().encode("café").subarray(0, 4));
        const chunks = yield* Queue.unbounded<string>();
        const stop = yield* Deferred.make<void>();
        yield* tailClaudeTaskOutput({
          root,
          sessionId: SESSION_ID,
          taskId: TASK_ID,
          stop,
          onChunk: (chunk) => Queue.offer(chunks, chunk),
        }).pipe(Effect.forkScoped);
        assert.equal(yield* Queue.take(chunks), "caf");

        yield* fileSystem.writeFileString(file, "ok\n");
        yield* Deferred.succeed(stop, undefined);
        assert.equal(yield* Queue.take(chunks), "ok\n");
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("skips ahead when the command writes faster than it is read", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const { root, tasks, file } = yield* makeTaskFile;
        yield* fileSystem.makeDirectory(tasks, { recursive: true });
        yield* fileSystem.writeFileString(file, "start\n");
        const chunks = yield* Queue.unbounded<string>();
        yield* tailClaudeTaskOutput({
          root,
          sessionId: SESSION_ID,
          taskId: TASK_ID,
          stop: yield* Deferred.make<void>(),
          onChunk: (chunk) => Queue.offer(chunks, chunk),
        }).pipe(Effect.forkScoped);
        assert.equal(yield* Queue.take(chunks), "start\n");

        // The skip lands on the second byte of a two-byte é.
        yield* fileSystem.writeFileString(file, `start\n${"é\n".repeat(1_000_000)}end.\n`);
        const flooded = yield* Queue.take(chunks);
        assert.isAtMost(flooded.length, 256 * 1024 + 1);
        assert.equal(flooded.slice(0, 3), "\n\né");
        assert.isTrue(flooded.endsWith("é\nend.\n"));
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("reads what was written last when the tool result stops it", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const { root, tasks, file } = yield* makeTaskFile;
      yield* fileSystem.makeDirectory(tasks, { recursive: true });
      yield* fileSystem.writeFileString(file, "one\n");
      const chunks: Array<string> = [];
      const stop = yield* Deferred.make<void>();
      const first = yield* Deferred.make<void>();
      const fiber = yield* tailClaudeTaskOutput({
        root,
        sessionId: SESSION_ID,
        taskId: TASK_ID,
        stop,
        onChunk: (chunk) =>
          Effect.sync(() => chunks.push(chunk)).pipe(
            Effect.andThen(Deferred.succeed(first, undefined)),
          ),
      }).pipe(Effect.forkScoped);
      yield* Deferred.await(first);
      yield* fileSystem.writeFileString(file, "one\ntwo\n");
      yield* Deferred.succeed(stop, undefined);
      yield* Fiber.join(fiber);
      assert.deepEqual(chunks, ["one\n", "two\n"]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("watchClaudeTaskProgress", () => {
  it.live("reports each new progress line, keeps it through other output, and clears on stop", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const { root, tasks, file } = yield* makeTaskFile;
        yield* fileSystem.makeDirectory(tasks, { recursive: true });
        yield* fileSystem.writeFileString(file, "> npm test\n::progress:: 0/1484 Unit tests\n");
        const reports = yield* Queue.unbounded<BackgroundProgressLine | null>();
        const stop = yield* Deferred.make<void>();
        const fiber = yield* watchClaudeTaskProgress({
          root,
          sessionId: SESSION_ID,
          taskId: TASK_ID,
          stop,
          onProgress: (progress) => Queue.offer(reports, progress),
        }).pipe(Effect.forkScoped);
        assert.deepEqual(yield* Queue.take(reports), { done: 0, total: 1484, label: "Unit tests" });

        // More output than the read window pushes the progress line out of view.
        const noise = "✔ renders the dot\n".repeat(1_000);
        yield* fileSystem.writeFileString(
          file,
          `::progress:: 0/1484 Unit tests\n::progress:: 412/1484 Unit tests\n${noise}`,
        );
        yield* fileSystem.writeFileString(
          file,
          `::progress:: 412/1484 Unit tests\n${noise}::progress:: 31/84 E2E\n`,
        );
        assert.deepEqual(yield* Queue.take(reports), { done: 31, total: 84, label: "E2E" });

        yield* Deferred.succeed(stop, undefined);
        yield* Fiber.join(fiber);
        assert.isNull(yield* Queue.take(reports));
        assert.isTrue(Option.isNone(yield* Queue.poll(reports)));
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
});

describe("claudeTaskOutputRoot", () => {
  it.effect.skipIf(process.getuid === undefined)(
    "uses the temp dir Claude Code resolves from its environment on each platform",
    () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const user = `claude-${process.getuid?.()}`;
        const root = (
          environment: Record<string, string>,
          platform: NodeJS.Platform,
          cwd: string | null = null,
        ) => claudeTaskOutputRoot(environment, path, cwd, platform);
        assert.equal(root({ TMPDIR: "/var/folders/x/T/" }, "linux"), `/var/folders/x/T/${user}`);
        assert.equal(root({ TMP: "/tmp/user/1000" }, "linux"), `/tmp/user/1000/${user}`);
        assert.equal(root({}, "linux"), `/tmp/${user}`);
        assert.equal(root({ TMPDIR: "/var/folders/x/T/" }, "darwin"), `/tmp/${user}`);
        assert.equal(
          root({ CLAUDE_CODE_TMPDIR: "/srv/claude", TMPDIR: "/var/folders/x/T/" }, "linux"),
          `/srv/claude/${user}`,
        );
        assert.equal(
          root({ CLAUDE_CODE_TMPDIR: "/srv/claude", TMPDIR: "/var/folders/x/T/" }, "darwin"),
          `/srv/claude/${user}`,
        );
        assert.equal(
          root({ TMPDIR: "tmp" }, "linux", "/work/project"),
          `/work/project/tmp/${user}`,
        );
        assert.equal(
          root({ CLAUDE_CODE_TMPDIR: "../claude" }, "darwin", "/work/project"),
          `/work/claude/${user}`,
        );
      }).pipe(Effect.provide(NodeServices.layer)),
  );
});
