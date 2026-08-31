import assert from "node:assert/strict";
import test from "node:test";

import {
  UnsupportedInputError,
  UnsupportedLanguageError,
} from "../src/errors.js";
import {
  assertContainsSupportedScript,
  getSupportedLanguageFamily,
  getTargetLanguageForSource,
  hasLikelyVietnameseEvidence,
  inferSourceLanguageFamily,
} from "../src/language.js";

test("assertContainsSupportedScript nhận chữ Latin hoặc chữ Hán", () => {
  assert.doesNotThrow(() => assertContainsSupportedScript("Xin chào bạn"));
  assert.doesNotThrow(() => assertContainsSupportedScript("你好，今天怎么样？"));
  assert.doesNotThrow(() => assertContainsSupportedScript("今天 release v2 nhé"));
});

test("assertContainsSupportedScript từ chối emoji và số thuần túy", () => {
  assert.throws(() => assertContainsSupportedScript("🎉 123"), UnsupportedInputError);
});

test("chọn đúng target cho source Trung và Việt", () => {
  assert.equal(getTargetLanguageForSource("vi", "zh"), "zh");
  assert.equal(getTargetLanguageForSource("zh", "zh"), "vi");
});

test("chuẩn hóa family từ mã ngôn ngữ provider", () => {
  assert.equal(getSupportedLanguageFamily("vi"), "vi");
  assert.equal(getSupportedLanguageFamily("vi-Latn"), "vi");
  assert.equal(getSupportedLanguageFamily("zh-TW"), "zh");
  assert.equal(getSupportedLanguageFamily("en"), null);
});

test("nhận diện bằng chứng tiếng Việt rõ ràng và không đoán tiếng Anh", () => {
  assert.equal(hasLikelyVietnameseEvidence("Tôi muốn dịch câu này"), true);
  assert.equal(hasLikelyVietnameseEvidence("xin chao, cam on ban"), true);
  for (const shortText of ["ê", "Ê!", "ơi", "đi", "ăn", "cô", "hãy"]) {
    assert.equal(hasLikelyVietnameseEvidence(shortText), true, shortText);
  }
  assert.equal(hasLikelyVietnameseEvidence("Hello world"), false);
  assert.equal(hasLikelyVietnameseEvidence("Bonjour le monde"), false);
  assert.equal(hasLikelyVietnameseEvidence("Hôtel de Paris"), false);
  assert.equal(hasLikelyVietnameseEvidence("être"), false);
  assert.equal(hasLikelyVietnameseEvidence("não quero"), false);
  assert.equal(hasLikelyVietnameseEvidence("avô querido"), false);
});

test("suy luận chiều dịch theo script chiếm ưu thế", () => {
  assert.equal(inferSourceLanguageFamily("Xin chào bạn"), "vi");
  assert.equal(inferSourceLanguageFamily("你好，今天怎么样？"), "zh");
  assert.equal(inferSourceLanguageFamily("Hôm nay dùng 发布 nhé"), "vi");
  assert.equal(inferSourceLanguageFamily("发布 ab"), "zh");
  assert.throws(
    () => inferSourceLanguageFamily("今日は元気ですか"),
    UnsupportedLanguageError,
  );
});
