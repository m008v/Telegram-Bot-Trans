import { autoRetry } from "@grammyjs/auto-retry";
import { Bot, GrammyError, HttpError } from "grammy";

import { AsyncSemaphore } from "./async-semaphore.js";
import {
  TranslationCapacityError,
  UnsupportedInputError,
  UnsupportedLanguageError,
} from "./errors.js";
import { splitTelegramMessage } from "./message-splitter.js";
import { PerKeySerialQueue } from "./per-key-serial-queue.js";
import { toSafeError } from "./safe-error.js";
import { TranslationRateLimiter } from "./translation-rate-limiter.js";

const START_MESSAGE = [
  "Gửi tiếng Việt để dịch sang tiếng Trung, hoặc gửi tiếng Trung để dịch sang tiếng Việt.",
  "",
  "Bot chỉ xử lý tin nhắn văn bản và gửi bản dịch thành một tin nhắn mới.",
].join("\n");

const PROVIDER_ERROR_MESSAGE =
  "Dịch vụ dịch đang bận, hết quota hoặc từ chối request. Vui lòng thử lại sau.";
const CAPACITY_ERROR_MESSAGE =
  "Bot đang xử lý nhiều tin nhắn. Vui lòng thử lại sau ít phút.";
const BOT_COMMAND_PATTERN =
  /^\/(start|help|id|addchat|unchat|list)(?:@([A-Za-z0-9_]+))?(?:\s|$)/u;
const ADMIN_COMMANDS = new Set(["addchat", "unchat", "list"]);
const PUBLIC_MODE_ALLOWLIST_MESSAGE =
  "Bot đang cho phép mọi chat; hãy tắt TELEGRAM_ALLOW_ALL_CHATS trước khi dùng allowlist.";
const CHAT_LOOKUP_CONCURRENCY = 4;
const CHAT_LOOKUP_TIMEOUT_MS = 10_000;
const MAX_CHAT_DISPLAY_NAME_LENGTH = 120;

function isChatAllowed(chatId, allowedChatIds, allowAllChats) {
  return allowAllChats || allowedChatIds.has(String(chatId));
}

function isAdminUser(userId, adminUserIds) {
  return userId !== undefined && adminUserIds.has(String(userId));
}

function isGroupChat(chat) {
  return chat?.type === "group" || chat?.type === "supergroup";
}

function normalizeChatDisplayName(value) {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value
    .replace(/[\u202a-\u202e\u2066-\u2069]/giu, "")
    .replace(/\s+/gu, " ")
    .trim();
  const characters = Array.from(normalized);
  if (characters.length <= MAX_CHAT_DISPLAY_NAME_LENGTH) {
    return normalized;
  }

  return `${characters.slice(0, MAX_CHAT_DISPLAY_NAME_LENGTH - 1).join("")}…`;
}

function getChatDisplayName(chat) {
  const title = normalizeChatDisplayName(chat?.title);
  if (title) {
    return title;
  }

  const fullName = normalizeChatDisplayName(
    [chat?.first_name, chat?.last_name].filter(Boolean).join(" "),
  );
  if (fullName) {
    return fullName;
  }

  const username = normalizeChatDisplayName(chat?.username);
  return username ? `@${username}` : "Không lấy được tên";
}

async function resolveAllowedChatEntries(chatIds, getChat, logger, secrets) {
  const entries = new Array(chatIds.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < chatIds.length) {
      const index = nextIndex;
      nextIndex += 1;
      const chatId = chatIds[index];

      try {
        const chat = await getChat(chatId);
        entries[index] = { chatId, name: getChatDisplayName(chat) };
      } catch (error) {
        logger.warn?.({
          event: "allowed_chat_lookup_failed",
          chatId,
          error: toSafeError(error, secrets),
        });
        entries[index] = { chatId, name: "Không lấy được tên" };
      }
    }
  }

  const workerCount = Math.min(CHAT_LOOKUP_CONCURRENCY, chatIds.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return entries;
}

function formatAllowedChatList(entries) {
  if (entries.length === 0) {
    return "Chưa có chat hoặc nhóm nào trong TELEGRAM_ALLOWED_CHAT_IDS.";
  }

  return [
    `Các chat/nhóm đang được phép dùng bot (${entries.length}):`,
    ...entries.map(({ chatId, name }) => `- ${name} — ID: ${chatId}`),
  ].join("\n");
}

function getKnownBotCommand(ctx) {
  const match = BOT_COMMAND_PATTERN.exec(ctx.msg?.text ?? "");
  if (!match) {
    return undefined;
  }

  const targetUsername = match[2];
  const botUsername = ctx.me?.username;
  if (targetUsername && (
    typeof botUsername !== "string"
    || targetUsername.toLowerCase() !== botUsername.toLowerCase()
  )) {
    return undefined;
  }

  return match[1];
}

async function bestEffortTyping(ctx) {
  try {
    await ctx.sendChatAction("typing");
  } catch {
    // Không để lỗi chat action làm hỏng luồng dịch chính.
  }
}

function getUserFacingError(error) {
  if (error instanceof TranslationCapacityError) {
    return CAPACITY_ERROR_MESSAGE;
  }

  return PROVIDER_ERROR_MESSAGE;
}

function isExpectedUserError(error) {
  return error instanceof UnsupportedInputError
    || error instanceof UnsupportedLanguageError
    || error instanceof TranslationCapacityError;
}

function getTelegramErrorKind(error) {
  if (error instanceof GrammyError) {
    return "telegram_api_error";
  }

  if (error instanceof HttpError) {
    return "telegram_network_error";
  }

  return "telegram_middleware_error";
}

export function createTextMessageHandler({
  translator,
  queue = new PerKeySerialQueue(),
  rateLimiter,
  translationSemaphore,
  logger = console,
}) {
  return async function handleTextMessage(ctx) {
    if (ctx.from?.is_bot || typeof ctx.msg?.text !== "string") {
      return;
    }

    if (ctx.msg.text.startsWith("/")) {
      return;
    }

    const chatId = String(ctx.chat.id);
    const rateLimit = rateLimiter?.tryAcquire(chatId) ?? { allowed: true };

    if (!rateLimit.allowed) {
      if (rateLimit.shouldNotify) {
        await ctx.reply(
          `Bạn gửi quá nhanh. Thử lại sau khoảng ${rateLimit.retryAfterSeconds} giây.`,
        );
      }
      return;
    }

    await queue.run(chatId, async () => {
      let result;
      try {
        const translate = async () => {
          await bestEffortTyping(ctx);
          return translator.translateBidirectional(ctx.msg.text);
        };
        result = translationSemaphore
          ? await translationSemaphore.run(translate)
          : await translate();
      } catch (error) {
        if (
          error instanceof UnsupportedInputError
          || error instanceof UnsupportedLanguageError
        ) {
          return;
        }

        if (!isExpectedUserError(error)) {
          logger.error({
            event: "translation_failed",
            chatId,
            messageId: ctx.msg.message_id,
            error: toSafeError(error),
          });
        }
        await ctx.reply(getUserFacingError(error));
        return;
      }

      const chunks = splitTelegramMessage(result.translatedText);
      for (const chunk of chunks) {
        await ctx.reply(chunk);
      }
    });
  };
}

export function createTranslationBot({
  token,
  translator,
  allowedChatIds = new Set(),
  adminUserIds = new Set(),
  addAllowedChatId,
  removeAllowedChatId,
  allowAllChats = false,
  perChatTranslationsPerMinute = 20,
  globalTranslationsPerMinute = 120,
  maxConcurrentTranslations = 8,
  logger = console,
}) {
  const bot = new Bot(token, {
    client: { timeoutSeconds: 45 },
  });
  bot.api.config.use(autoRetry({
    maxRetryAttempts: 3,
    maxDelaySeconds: 10,
    rethrowHttpErrors: true,
  }));
  const rateLimiter = new TranslationRateLimiter({
    perChatLimit: perChatTranslationsPerMinute,
    globalLimit: globalTranslationsPerMinute,
  });
  const commandLimiter = new TranslationRateLimiter({
    perChatLimit: 3,
    globalLimit: 30,
  });
  const translationSemaphore = new AsyncSemaphore(maxConcurrentTranslations);

  bot.use(async (ctx, next) => {
    if (!ctx.chat) {
      return next();
    }

    const chatAllowed = isChatAllowed(ctx.chat.id, allowedChatIds, allowAllChats);
    const knownCommand = getKnownBotCommand(ctx);
    if (knownCommand) {
      const isAdminCommand = ADMIN_COMMANDS.has(knownCommand);
      const adminCommandAllowed = isAdminCommand
        && isAdminUser(ctx.from?.id, adminUserIds);
      if (isAdminCommand && !adminCommandAllowed) {
        return;
      }

      if (!chatAllowed && knownCommand !== "id" && !adminCommandAllowed) {
        return;
      }

      if (!commandLimiter.tryAcquire(ctx.chat.id).allowed) {
        return;
      }

      return next();
    }

    if (chatAllowed) {
      return next();
    }

    // Bỏ qua im lặng để người lạ không thể khuếch đại log hoặc đốt quota.
  });

  bot.command("start", (ctx) => ctx.reply(START_MESSAGE));
  bot.command("help", (ctx) => ctx.reply(START_MESSAGE));
  bot.command("id", (ctx) => ctx.reply(`Chat ID: ${ctx.chat.id}`));
  bot.command("addchat", async (ctx) => {
    if (!isAdminUser(ctx.from?.id, adminUserIds)) {
      return;
    }

    if (!isGroupChat(ctx.chat)) {
      await ctx.reply("Lệnh /addchat chỉ dùng trong nhóm hoặc siêu nhóm Telegram.");
      return;
    }

    if (allowAllChats) {
      await ctx.reply(PUBLIC_MODE_ALLOWLIST_MESSAGE);
      return;
    }

    if (typeof addAllowedChatId !== "function") {
      logger.error({
        event: "allowed_chat_store_missing",
        chatId: String(ctx.chat.id),
        userId: String(ctx.from.id),
      });
      await ctx.reply("Bot chưa được cấu hình nơi lưu allowlist. Không thể thêm nhóm này.");
      return;
    }

    let result;
    try {
      result = await addAllowedChatId(ctx.chat.id);
    } catch (error) {
      logger.error({
        event: "allowed_chat_persist_failed",
        chatId: String(ctx.chat.id),
        userId: String(ctx.from.id),
        error: toSafeError(error),
      });
      await ctx.reply("Không thể lưu nhóm vào allowlist. Vui lòng kiểm tra log và thử lại.");
      return;
    }

    await ctx.reply(result.added
      ? `Đã thêm nhóm ${ctx.chat.id} vào TELEGRAM_ALLOWED_CHAT_IDS.`
      : `Nhóm ${ctx.chat.id} đã có trong TELEGRAM_ALLOWED_CHAT_IDS.`);
  });
  bot.command("unchat", async (ctx) => {
    if (!isAdminUser(ctx.from?.id, adminUserIds)) {
      return;
    }

    if (!isGroupChat(ctx.chat)) {
      await ctx.reply("Lệnh /unchat chỉ dùng trong nhóm hoặc siêu nhóm Telegram.");
      return;
    }

    if (allowAllChats) {
      await ctx.reply(PUBLIC_MODE_ALLOWLIST_MESSAGE);
      return;
    }

    if (typeof removeAllowedChatId !== "function") {
      logger.error({
        event: "allowed_chat_store_missing",
        operation: "remove",
        chatId: String(ctx.chat.id),
        userId: String(ctx.from.id),
      });
      await ctx.reply("Bot chưa được cấu hình nơi lưu allowlist. Không thể xoá nhóm này.");
      return;
    }

    let result;
    try {
      result = await removeAllowedChatId(ctx.chat.id);
    } catch (error) {
      logger.error({
        event: "allowed_chat_persist_failed",
        operation: "remove",
        chatId: String(ctx.chat.id),
        userId: String(ctx.from.id),
        error: toSafeError(error),
      });
      await ctx.reply("Không thể xoá nhóm khỏi allowlist. Vui lòng kiểm tra log và thử lại.");
      return;
    }

    await ctx.reply(result.removed
      ? `Đã xoá nhóm ${ctx.chat.id} khỏi TELEGRAM_ALLOWED_CHAT_IDS.`
      : `Nhóm ${ctx.chat.id} không có trong TELEGRAM_ALLOWED_CHAT_IDS.`);
  });
  bot.command("list", async (ctx) => {
    if (!isAdminUser(ctx.from?.id, adminUserIds)) {
      return;
    }

    if (allowAllChats) {
      await ctx.reply(PUBLIC_MODE_ALLOWLIST_MESSAGE);
      return;
    }

    const chatIds = [...allowedChatIds];
    const lookupSignal = AbortSignal.timeout(CHAT_LOOKUP_TIMEOUT_MS);
    const entries = await resolveAllowedChatEntries(
      chatIds,
      (chatId) => ctx.api.getChat(chatId, lookupSignal),
      logger,
      [token],
    );
    const chunks = splitTelegramMessage(formatAllowedChatList(entries));
    for (const chunk of chunks) {
      await ctx.reply(chunk);
    }
  });
  bot.on("message:text", createTextMessageHandler({
    translator,
    rateLimiter,
    translationSemaphore,
    logger,
  }));

  bot.catch(({ error, ctx }) => {
    logger.error({
      event: "telegram_update_failed",
      kind: getTelegramErrorKind(error),
      updateId: ctx.update.update_id,
      chatId: ctx.chat ? String(ctx.chat.id) : undefined,
      error: toSafeError(error, [token]),
    });
  });

  return bot;
}

export { START_MESSAGE };
