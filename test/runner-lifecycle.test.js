import assert from "node:assert/strict";
import test from "node:test";

import {
  drainRunnerAndCloseTranslator,
  RunnerDrainTimeoutError,
  waitForRunnerToDrain,
} from "../src/runner-lifecycle.js";

test("waitForRunnerToDrain chờ đến khi toàn bộ handler hoàn tất", async () => {
  let now = 0;
  const sizes = [2, 1, 0];
  const runner = {
    size() {
      return sizes.shift() ?? 0;
    },
  };

  await waitForRunnerToDrain(runner, {
    timeoutMs: 1_000,
    pollIntervalMs: 10,
    clock: () => now,
    delay: async (milliseconds) => {
      now += milliseconds;
    },
  });

  assert.equal(now, 20);
});

test("waitForRunnerToDrain dừng chờ khi hết grace period", async () => {
  let now = 0;
  const runner = { size: () => 3 };

  await assert.rejects(
    () => waitForRunnerToDrain(runner, {
      timeoutMs: 25,
      pollIntervalMs: 10,
      clock: () => now,
      delay: async (milliseconds) => {
        now += milliseconds;
      },
    }),
    (error) => {
      assert.ok(error instanceof RunnerDrainTimeoutError);
      assert.equal(error.pendingUpdates, 3);
      return true;
    },
  );
});

test("shutdown dừng runner, đợi drain rồi mới đóng translation provider", async () => {
  const calls = [];
  const runner = {
    isRunning: () => true,
    async stop() {
      calls.push("stop");
    },
    size() {
      calls.push("size");
      return 0;
    },
  };
  const translator = {
    async close() {
      calls.push("close");
    },
  };

  await drainRunnerAndCloseTranslator(runner, translator);

  assert.deepEqual(calls, ["stop", "size", "close"]);
});

test("shutdown giữ cả lỗi runner và lỗi đóng translation provider", async () => {
  const runnerError = new Error("runner cleanup failed");
  const closeError = new Error("translator close failed");
  let closeCalls = 0;
  const runner = {
    isRunning: () => true,
    async stop() {
      throw runnerError;
    },
  };
  const translator = {
    async close() {
      closeCalls += 1;
      throw closeError;
    },
  };

  await assert.rejects(
    () => drainRunnerAndCloseTranslator(runner, translator),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [runnerError, closeError]);
      return true;
    },
  );
  assert.equal(closeCalls, 1);
});
