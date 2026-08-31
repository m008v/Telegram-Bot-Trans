import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.js";

const VALID_ENV = {
  TELEGRAM_BOT_TOKEN: "123456789:abcdefghijklmnopqrstuvwxyz_ABCDE",
  YANDEX_TRANSLATE_API_KEY: "AQVN_test_api_key_without_secret_value",
  TELEGRAM_ALLOWED_CHAT_IDS: "123",
};

test("loadConfig áp dụng giá trị mặc định an toàn", () => {
  const config = loadConfig(VALID_ENV);

  assert.equal(config.yandexTranslateApiKey, VALID_ENV.YANDEX_TRANSLATE_API_KEY);
  assert.equal(config.yandexTranslateFolderId, undefined);
  assert.equal(config.chineseTargetLanguage, "zh");
  assert.equal(config.translationTimeoutMs, 15_000);
  assert.deepEqual([...config.allowedChatIds], ["123"]);
  assert.deepEqual([...config.adminUserIds], []);
  assert.equal(config.allowAllChats, false);
  assert.equal(config.perChatTranslationsPerMinute, 20);
  assert.equal(config.globalTranslationsPerMinute, 120);
  assert.equal(config.maxConcurrentTranslations, 8);
});

test("loadConfig chuẩn hóa allowlist chat", () => {
  const config = loadConfig({
    ...VALID_ENV,
    TELEGRAM_ALLOWED_CHAT_IDS: "123, -100456,123",
    CHINESE_TARGET_LANGUAGE: "zh-CN",
    TRANSLATION_TIMEOUT_MS: "5000",
    TELEGRAM_ADMIN_IDS: "42, 84,42",
    YANDEX_TRANSLATE_FOLDER_ID: "b1gexamplefolder123",
  });

  assert.deepEqual([...config.allowedChatIds], ["123", "-100456"]);
  assert.equal(config.chineseTargetLanguage, "zh");
  assert.equal(config.translationTimeoutMs, 5_000);
  assert.deepEqual([...config.adminUserIds], ["42", "84"]);
  assert.equal(config.yandexTranslateFolderId, "b1gexamplefolder123");
});

test("loadConfig từ chối cấu hình thiếu hoặc sai định dạng", () => {
  assert.throws(() => loadConfig({}), /TELEGRAM_BOT_TOKEN/u);
  assert.throws(
    () => loadConfig({ TELEGRAM_BOT_TOKEN: VALID_ENV.TELEGRAM_BOT_TOKEN }),
    /YANDEX_TRANSLATE_API_KEY/u,
  );
  assert.throws(
    () => loadConfig({ ...VALID_ENV, YANDEX_TRANSLATE_API_KEY: "bad key" }),
    /khoảng trắng/u,
  );
  assert.throws(
    () => loadConfig({ ...VALID_ENV, YANDEX_TRANSLATE_FOLDER_ID: "bad folder" }),
    /FOLDER_ID/u,
  );
  assert.throws(
    () => loadConfig({ ...VALID_ENV, TELEGRAM_ALLOWED_CHAT_IDS: "abc" }),
    /chat ID không hợp lệ/u,
  );
  assert.throws(
    () => loadConfig({ ...VALID_ENV, TELEGRAM_ADMIN_IDS: "-42" }),
    /user ID không hợp lệ/u,
  );
  assert.throws(
    () => loadConfig({ ...VALID_ENV, CHINESE_TARGET_LANGUAGE: "zh-TW" }),
    /chỉ nhận zh/u,
  );
  assert.throws(
    () => loadConfig({ ...VALID_ENV, TRANSLATION_TIMEOUT_MS: "999" }),
    /1000 đến 60000/u,
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
