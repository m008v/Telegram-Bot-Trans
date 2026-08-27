import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.js";

const VALID_ENV = {
  TELEGRAM_BOT_TOKEN: "123456789:abcdefghijklmnopqrstuvwxyz_ABCDE",
  GOOGLE_CLOUD_PROJECT: "trans-bot-project",
  TELEGRAM_ALLOWED_CHAT_IDS: "123",
};

test("loadConfig áp dụng giá trị mặc định an toàn", () => {
  const config = loadConfig(VALID_ENV);

  assert.equal(config.googleCloudLocation, "global");
  assert.equal(config.chineseTargetLanguage, "zh-CN");
  assert.equal(config.translationTimeoutMs, 15_000);
  assert.deepEqual([...config.allowedChatIds], ["123"]);
  assert.equal(config.allowAllChats, false);
  assert.equal(config.minimumLanguageConfidence, 0.6);
  assert.equal(config.perChatTranslationsPerMinute, 20);
  assert.equal(config.globalTranslationsPerMinute, 120);
  assert.equal(config.maxConcurrentTranslations, 8);
});

test("loadConfig chuẩn hóa allowlist chat", () => {
  const config = loadConfig({
    ...VALID_ENV,
    TELEGRAM_ALLOWED_CHAT_IDS: "123, -100456,123",
    CHINESE_TARGET_LANGUAGE: "zh-TW",
    TRANSLATION_TIMEOUT_MS: "5000",
  });

  assert.deepEqual([...config.allowedChatIds], ["123", "-100456"]);
  assert.equal(config.chineseTargetLanguage, "zh-TW");
  assert.equal(config.translationTimeoutMs, 5_000);
});

test("loadConfig từ chối cấu hình thiếu hoặc sai định dạng", () => {
  assert.throws(() => loadConfig({}), /TELEGRAM_BOT_TOKEN/u);
  assert.throws(
    () => loadConfig({ ...VALID_ENV, TELEGRAM_ALLOWED_CHAT_IDS: "abc" }),
    /chat ID không hợp lệ/u,
  );
  assert.throws(
    () => loadConfig({ ...VALID_ENV, CHINESE_TARGET_LANGUAGE: "zh" }),
    /zh-CN hoặc zh-TW/u,
  );
  assert.throws(
    () => loadConfig({ ...VALID_ENV, TRANSLATION_TIMEOUT_MS: "999" }),
    /1000 đến 60000/u,
  );
  assert.throws(
    () => loadConfig({ ...VALID_ENV, MIN_LANGUAGE_CONFIDENCE: "1.1" }),
    /số từ 0 đến 1/u,
  );
  assert.throws(
    () => loadConfig({
      ...VALID_ENV,
      TELEGRAM_MAX_TRANSLATIONS_PER_MINUTE: "21",
      TELEGRAM_GLOBAL_MAX_TRANSLATIONS_PER_MINUTE: "20",
    }),
    /không được lớn hơn/u,
  );
});

test("loadConfig vào bootstrap-only khi chưa chọn allowlist hoặc public", () => {
  const withoutAllowlist = { ...VALID_ENV };
  delete withoutAllowlist.TELEGRAM_ALLOWED_CHAT_IDS;

  const bootstrapConfig = loadConfig(withoutAllowlist);
  assert.equal(bootstrapConfig.bootstrapOnly, true);
  assert.equal(bootstrapConfig.allowAllChats, false);

  const publicConfig = loadConfig({
    ...withoutAllowlist,
    TELEGRAM_ALLOW_ALL_CHATS: "true",
  });
  assert.equal(publicConfig.allowAllChats, true);
  assert.equal(publicConfig.bootstrapOnly, false);
  assert.equal(publicConfig.allowedChatIds.size, 0);

  assert.throws(
    () => loadConfig({ ...VALID_ENV, TELEGRAM_ALLOW_ALL_CHATS: "true" }),
    /Chỉ chọn một chế độ/u,
  );
});
