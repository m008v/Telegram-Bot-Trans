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
  "Bot chỉ xử lý tin nhắn văn bản và sẽ trả lời ngay dưới tin nhắn gốc.",
].join("\n");

const UNSUPPORTED_INPUT_MESSAGE =
  "Bot chỉ dịch văn bản tiếng Trung ↔ tiếng Việt. Hãy gửi một câu có nội dung rõ ràng.";
const UNSUPPORTED_LANGUAGE_MESSAGE =
  "Bot phát hiện ngôn ngữ khác tiếng Trung hoặc tiếng Việt nên không dịch tin nhắn này.";
const PROVIDER_ERROR_MESSAGE =
  "Google Dịch đang bận hoặc chưa được cấu hình đúng. Vui lòng thử lại sau.";
const CAPACITY_ERROR_MESSAGE =
  "Bot đang xử lý nhiều tin nhắn. Vui lòng thử lại sau ít phút.";
const BOT_COMMAND_PATTERN = /^\/(start|help|id)(?:@([A-Za-z0-9_]+))?(?:\s|$)/u;

function isChatAllowed(chatId, allowedChatIds, allowAllChats) {
  return allowAllChats || allowedChatIds.has(String(chatId));
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

function getReplyOptions(messageId) {
  return {
    reply_parameters: {
      message_id: messageId,
      allow_sending_without_reply: true,
    },
  };
}

async function bestEffortTyping(ctx) {
  try {
    await ctx.sendChatAction("typing");
  } catch {
    // Không để lỗi chat action làm hỏng luồng dịch chính.
  }
}

function getUserFacingError(error) {
  if (error instanceof UnsupportedInputError) {
    return UNSUPPORTED_INPUT_MESSAGE;
  }

  if (error instanceof UnsupportedLanguageError) {
    return UNSUPPORTED_LANGUAGE_MESSAGE;
  }

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
          getReplyOptions(ctx.msg.message_id),
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
        if (!isExpectedUserError(error)) {
          logger.error({
            event: "translation_failed",
            chatId,
            messageId: ctx.msg.message_id,
            error: toSafeError(error),
          });
        }
        await ctx.reply(getUserFacingError(error), getReplyOptions(ctx.msg.message_id));
        return;
      }

      const chunks = splitTelegramMessage(result.translatedText);
      for (const [index, chunk] of chunks.entries()) {
        const replyOptions = index === 0
          ? getReplyOptions(ctx.msg.message_id)
          : undefined;
        await ctx.reply(chunk, replyOptions);
      }
    });
  };
}

export function createTranslationBot({
  token,
  translator,
  allowedChatIds = new Set(),
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
      if (!commandLimiter.tryAcquire(ctx.chat.id).allowed) {
        return;
      }

      if (chatAllowed || knownCommand === "id") {
        return next();
      }

      return;
    }

    if (chatAllowed) {
      return next();
    }

    // Bỏ qua im lặng để người lạ không thể khuếch đại log hoặc đốt quota.
  });

  bot.command("start", (ctx) => ctx.reply(START_MESSAGE));
  bot.command("help", (ctx) => ctx.reply(START_MESSAGE));
  bot.command("id", (ctx) => ctx.reply(`Chat ID: ${ctx.chat.id}`));
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
