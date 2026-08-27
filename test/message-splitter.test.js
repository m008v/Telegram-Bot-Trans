import assert from "node:assert/strict";
import test from "node:test";

import { splitTelegramMessage } from "../src/message-splitter.js";

test("không chia tin nhắn ngắn", () => {
  assert.deepEqual(splitTelegramMessage("Xin chào", 20), ["Xin chào"]);
});

test("chia ở khoảng trắng và không làm mất nội dung", () => {
  const text = "một hai ba bốn năm sáu";
  const chunks = splitTelegramMessage(text, 10);

  assert.equal(chunks.join(""), text);
  assert.ok(chunks.every((chunk) => Array.from(chunk).length <= 10));
});

test("không cắt đôi surrogate pair", () => {
  const text = "你好🙂🙂🙂🙂🙂世界";
  const chunks = splitTelegramMessage(text, 4);

  assert.equal(chunks.join(""), text);
  assert.ok(chunks.every((chunk) => !chunk.includes("�")));
  assert.ok(chunks.every((chunk) => Array.from(chunk).length <= 4));
});

test("từ chối giới hạn không hợp lệ", () => {
  assert.throws(() => splitTelegramMessage("abc", 0), RangeError);
});
