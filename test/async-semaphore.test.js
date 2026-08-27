import assert from "node:assert/strict";
import test from "node:test";

import { AsyncSemaphore } from "../src/async-semaphore.js";
import { TranslationCapacityError } from "../src/errors.js";

test("semaphore hard-cap concurrency và từ chối khi hàng chờ đầy", async () => {
  const semaphore = new AsyncSemaphore(8);
  let active = 0;
  let maxActive = 0;
  let releaseGate;
  let markEightStarted;
  const gate = new Promise((resolve) => {
    releaseGate = resolve;
  });
  const eightStarted = new Promise((resolve) => {
    markEightStarted = resolve;
  });

  const jobs = Array.from({ length: 100 }, () => semaphore.run(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    if (active === 8) {
      markEightStarted();
    }
    await gate;
    active -= 1;
  }));
  const settledJobs = Promise.allSettled(jobs);

  await eightStarted;
  assert.equal(semaphore.activeCount, 8);
  assert.equal(semaphore.pendingCount, 16);

  releaseGate();
  const results = await settledJobs;
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");

  assert.equal(maxActive, 8);
  assert.equal(fulfilled.length, 24);
  assert.equal(rejected.length, 76);
  assert.ok(rejected.every((result) => result.reason instanceof TranslationCapacityError));
  assert.equal(semaphore.activeCount, 0);
  assert.equal(semaphore.pendingCount, 0);
});

test("semaphore nhả permit cả khi task lỗi", async () => {
  const semaphore = new AsyncSemaphore(1, { maxPending: 0 });

  await assert.rejects(
    () => semaphore.run(async () => {
      throw new Error("boom");
    }),
    /boom/u,
  );

  assert.equal(await semaphore.run(async () => "ok"), "ok");
});
