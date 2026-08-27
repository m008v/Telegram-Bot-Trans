import assert from "node:assert/strict";
import test from "node:test";

import { TranslationRateLimiter } from "../src/translation-rate-limiter.js";

test("giới hạn theo chat và chỉ thông báo một lần mỗi cửa sổ", () => {
  let now = 0;
  const limiter = new TranslationRateLimiter({
    perChatLimit: 2,
    globalLimit: 10,
    windowMs: 60_000,
    clock: () => now,
  });

  assert.equal(limiter.tryAcquire("chat-1").allowed, true);
  assert.equal(limiter.tryAcquire("chat-1").allowed, true);

  const firstRejection = limiter.tryAcquire("chat-1");
  const secondRejection = limiter.tryAcquire("chat-1");
  assert.equal(firstRejection.allowed, false);
  assert.equal(firstRejection.shouldNotify, true);
  assert.equal(firstRejection.retryAfterSeconds, 60);
  assert.equal(secondRejection.shouldNotify, false);

  now = 60_000;
  assert.equal(limiter.tryAcquire("chat-1").allowed, true);
});

test("giới hạn tổng áp dụng nguyên tử cho nhiều chat", () => {
  const limiter = new TranslationRateLimiter({
    perChatLimit: 5,
    globalLimit: 2,
    clock: () => 10_000,
  });

  assert.equal(limiter.tryAcquire("chat-1").allowed, true);
  assert.equal(limiter.tryAcquire("chat-2").allowed, true);
  const rejection = limiter.tryAcquire("chat-3");

  assert.equal(rejection.allowed, false);
  assert.equal(rejection.shouldNotify, true);
  assert.equal(rejection.retryAfterSeconds, 60);
});

test("giữ Map có giới hạn khi nhiều chat mới bị global limit chặn", () => {
  const limiter = new TranslationRateLimiter({
    perChatLimit: 5,
    globalLimit: 1,
    maxTrackedChats: 10,
    clock: () => 0,
  });

  assert.equal(limiter.tryAcquire("seed").allowed, true);
  for (let index = 0; index < 1_000; index += 1) {
    assert.equal(limiter.tryAcquire(`blocked-${index}`).allowed, false);
  }

  assert.equal(limiter.chatWindows.size, 10);
});
