import assert from "node:assert/strict";
import test from "node:test";

import { PerKeySerialQueue } from "../src/per-key-serial-queue.js";

test("giữ đúng thứ tự trong cùng chat và dọn queue", async () => {
  const queue = new PerKeySerialQueue();
  const events = [];
  let releaseFirst;
  let markFirstStarted;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const firstStarted = new Promise((resolve) => {
    markFirstStarted = resolve;
  });

  const first = queue.run("chat-1", async () => {
    events.push("first:start");
    markFirstStarted();
    await firstGate;
    events.push("first:end");
  });
  const second = queue.run("chat-1", async () => {
    events.push("second");
  });

  await firstStarted;
  assert.deepEqual(events, ["first:start"]);
  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(events, ["first:start", "first:end", "second"]);
  assert.equal(queue.size, 0);
});

test("không chặn hai chat khác nhau", async () => {
  const queue = new PerKeySerialQueue();
  const events = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const slow = queue.run("chat-1", async () => {
    await gate;
    events.push("slow");
  });
  const fast = queue.run("chat-2", async () => {
    events.push("fast");
  });

  await fast;
  assert.deepEqual(events, ["fast"]);
  release();
  await slow;
});

test("task sau vẫn chạy nếu task trước lỗi", async () => {
  const queue = new PerKeySerialQueue();
  const first = queue.run("chat", async () => {
    throw new Error("boom");
  });
  const second = queue.run("chat", async () => "ok");

  await assert.rejects(first, /boom/u);
  assert.equal(await second, "ok");
  assert.equal(queue.size, 0);
});
