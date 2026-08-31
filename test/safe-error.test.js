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

test("ẩn API key Yandex khi caller truyền secret cần che", () => {
  const apiKey = "AQVN_test_api_key_without_secret_value";
  const error = new Error(`Yandex từ chối API key ${apiKey}`);
  error.providerCode = `HTTP_403_${apiKey}`;

  const safeError = toSafeError(error, [apiKey]);

  assert.equal(safeError.message.includes(apiKey), false);
  assert.match(safeError.message, /REDACTED/u);
  assert.equal(safeError.providerCode.includes(apiKey), false);
  assert.equal(safeError.providerCode, "HTTP_403_[REDACTED]");
});
