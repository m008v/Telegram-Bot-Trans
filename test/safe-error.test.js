import assert from "node:assert/strict";
import test from "node:test";

import { toSafeError } from "../src/safe-error.js";

test("ẩn Telegram token khỏi log", () => {
  const token = "123456789:abcdefghijklmnopqrstuvwxyz_ABCDE";
  const error = new Error(`Request tới https://api.telegram.org/bot${token}/sendMessage lỗi`);

  const safeError = toSafeError(error, [token]);

  assert.equal(safeError.message.includes(token), false);
  assert.match(safeError.message, /REDACTED/u);
});
