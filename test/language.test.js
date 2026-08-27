import assert from "node:assert/strict";
import test from "node:test";

import { UnsupportedInputError } from "../src/errors.js";
import {
  assertContainsSupportedScript,
  getSupportedLanguageFamily,
  getTargetLanguageForSource,
} from "../src/language.js";

test("assertContainsSupportedScript nhận chữ Latin hoặc chữ Hán", () => {
  assert.doesNotThrow(() => assertContainsSupportedScript("Xin chào bạn"));
  assert.doesNotThrow(() => assertContainsSupportedScript("你好，今天怎么样？"));
  assert.doesNotThrow(() => assertContainsSupportedScript("今天 release v2 nhé"));
});

test("assertContainsSupportedScript từ chối emoji và số thuần túy", () => {
  assert.throws(() => assertContainsSupportedScript("🎉 123"), UnsupportedInputError);
});

test("language family chỉ chấp nhận Trung và Việt", () => {
  assert.equal(getSupportedLanguageFamily("vi"), "vi");
  assert.equal(getSupportedLanguageFamily("zh-CN"), "zh");
  assert.equal(getSupportedLanguageFamily("zh-TW"), "zh");
  assert.equal(getSupportedLanguageFamily("en"), null);
  assert.equal(getTargetLanguageForSource("vi", "zh-TW"), "zh-TW");
  assert.equal(getTargetLanguageForSource("zh", "zh-TW"), "vi");
});
