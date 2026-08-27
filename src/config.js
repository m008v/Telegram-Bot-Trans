const SUPPORTED_CHINESE_TARGETS = new Set(["zh-CN", "zh-TW"]);

function readRequired(env, name) {
  const value = env[name]?.trim();

  if (!value) {
    throw new Error(`Thiếu biến môi trường bắt buộc: ${name}`);
  }

  return value;
}

function parseTelegramToken(value) {
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(value)) {
    throw new Error("TELEGRAM_BOT_TOKEN không đúng định dạng token của Telegram.");
  }

  return value;
}

function parseTimeout(value) {
  const timeoutMs = Number(value);

  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
    throw new Error("TRANSLATION_TIMEOUT_MS phải là số nguyên từ 1000 đến 60000.");
  }

  return timeoutMs;
}

function parseIntegerInRange(value, name, minimum, maximum) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} phải là số nguyên từ ${minimum} đến ${maximum}.`);
  }

  return parsed;
}

function parseBoolean(value, name) {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`${name} chỉ nhận true hoặc false.`);
}

function parseAllowedChatIds(value = "") {
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const invalidEntry = entries.find((entry) => !/^-?\d+$/.test(entry));
  if (invalidEntry) {
    throw new Error(`TELEGRAM_ALLOWED_CHAT_IDS chứa chat ID không hợp lệ: ${invalidEntry}`);
  }

  return new Set(entries);
}

export function loadConfig(env = process.env) {
  const telegramToken = parseTelegramToken(readRequired(env, "TELEGRAM_BOT_TOKEN"));
  const chineseTargetLanguage = env.CHINESE_TARGET_LANGUAGE?.trim() || "zh-CN";

  if (!SUPPORTED_CHINESE_TARGETS.has(chineseTargetLanguage)) {
    throw new Error("CHINESE_TARGET_LANGUAGE chỉ nhận zh-CN hoặc zh-TW.");
  }

  const allowedChatIds = parseAllowedChatIds(env.TELEGRAM_ALLOWED_CHAT_IDS);
  const allowAllChats = parseBoolean(
    env.TELEGRAM_ALLOW_ALL_CHATS?.trim() || "false",
    "TELEGRAM_ALLOW_ALL_CHATS",
  );

  if (allowAllChats && allowedChatIds.size > 0) {
    throw new Error(
      "Chỉ chọn một chế độ: TELEGRAM_ALLOW_ALL_CHATS=true hoặc TELEGRAM_ALLOWED_CHAT_IDS.",
    );
  }

  const perChatTranslationsPerMinute = parseIntegerInRange(
    env.TELEGRAM_MAX_TRANSLATIONS_PER_MINUTE?.trim() || "20",
    "TELEGRAM_MAX_TRANSLATIONS_PER_MINUTE",
    1,
    100,
  );
  const globalTranslationsPerMinute = parseIntegerInRange(
    env.TELEGRAM_GLOBAL_MAX_TRANSLATIONS_PER_MINUTE?.trim() || "120",
    "TELEGRAM_GLOBAL_MAX_TRANSLATIONS_PER_MINUTE",
    1,
    1_000,
  );

  if (perChatTranslationsPerMinute > globalTranslationsPerMinute) {
    throw new Error(
      "TELEGRAM_MAX_TRANSLATIONS_PER_MINUTE không được lớn hơn giới hạn toàn bot.",
    );
  }

  return {
    telegramToken,
    chineseTargetLanguage,
    allowedChatIds,
    allowAllChats,
    bootstrapOnly: !allowAllChats && allowedChatIds.size === 0,
    translationTimeoutMs: parseTimeout(env.TRANSLATION_TIMEOUT_MS?.trim() || "15000"),
    perChatTranslationsPerMinute,
    globalTranslationsPerMinute,
    maxConcurrentTranslations: parseIntegerInRange(
      env.MAX_CONCURRENT_TRANSLATIONS?.trim() || "8",
      "MAX_CONCURRENT_TRANSLATIONS",
      1,
      50,
    ),
  };
}
