import assert from "node:assert/strict";
import test from "node:test";

import { AsyncSemaphore } from "../src/async-semaphore.js";
import { createTextMessageHandler, createTranslationBot } from "../src/bot.js";
import {
  TranslationCapacityError,
  UnsupportedLanguageError,
} from "../src/errors.js";

function createContext(text, overrides = {}) {
  const replies = [];
  const chatActions = [];

  return {
    replies,
    chatActions,
    from: { is_bot: false },
    chat: { id: 123 },
    msg: { message_id: 456, text },
    async sendChatAction(action) {
      chatActions.push(action);
    },
    async reply(replyText, options) {
      replies.push({ text: replyText, options });
    },
    ...overrides,
  };
}

test("handler dịch và reply trực tiếp vào tin nhắn gốc", async () => {
  const ctx = createContext("Xin chào");
  const translator = {
    async translateBidirectional(text) {
      assert.equal(text, "Xin chào");
      return { translatedText: "你好" };
    },
  };
  const handler = createTextMessageHandler({ translator });

  await handler(ctx);

  assert.deepEqual(ctx.chatActions, ["typing"]);
  assert.equal(ctx.replies.length, 1);
  assert.equal(ctx.replies[0].text, "你好");
  assert.equal(ctx.replies[0].options.reply_parameters.message_id, 456);
});

test("handler chia bản dịch dài và chỉ reply-reference ở chunk đầu", async () => {
  const ctx = createContext("dịch đoạn dài");
  const translator = {
    async translateBidirectional() {
      return { translatedText: "中".repeat(4_000) };
    },
  };
  const handler = createTextMessageHandler({ translator });

  await handler(ctx);

  assert.equal(ctx.replies.length, 2);
  assert.equal(Array.from(ctx.replies[0].text).length, 3_900);
  assert.equal(Array.from(ctx.replies[1].text).length, 100);
  assert.equal(ctx.replies[0].options.reply_parameters.message_id, 456);
  assert.equal(ctx.replies[1].options, undefined);
});

test("handler báo đúng khi Google phát hiện ngôn ngữ không hỗ trợ", async () => {
  const ctx = createContext("Hello world");
  const logEntries = [];
  const translator = {
    async translateBidirectional() {
      throw new UnsupportedLanguageError("en");
    },
  };
  const handler = createTextMessageHandler({
    translator,
    logger: { error: (entry) => logEntries.push(entry) },
  });

  await handler(ctx);

  assert.match(ctx.replies[0].text, /ngôn ngữ khác/u);
  assert.equal(logEntries.length, 0);
});

test("handler báo bận nhưng không log như lỗi provider khi semaphore đầy", async () => {
  const ctx = createContext("Xin chào");
  const logEntries = [];
  const translator = { translateBidirectional: async () => ({ translatedText: "unused" }) };
  const translationSemaphore = {
    async run() {
      throw new TranslationCapacityError();
    },
  };
  const handler = createTextMessageHandler({
    translator,
    translationSemaphore,
    logger: { error: (entry) => logEntries.push(entry) },
  });

  await handler(ctx);

  assert.match(ctx.replies[0].text, /đang xử lý nhiều/u);
  assert.equal(logEntries.length, 0);
});

test("handler bỏ qua command và tin nhắn do bot gửi", async () => {
  let translationCalls = 0;
  const translator = {
    async translateBidirectional() {
      translationCalls += 1;
      return { translatedText: "unused" };
    },
  };
  const handler = createTextMessageHandler({ translator });
  const commandContext = createContext("/help");
  const botContext = createContext("你好", { from: { is_bot: true } });

  await handler(commandContext);
  await handler(botContext);

  assert.equal(translationCalls, 0);
  assert.equal(commandContext.replies.length, 0);
  assert.equal(botContext.replies.length, 0);
});

test("handler xử lý hai chat song song nhưng giữ queue riêng", async () => {
  let releaseSlowTranslation;
  let markSlowTranslationStarted;
  const slowGate = new Promise((resolve) => {
    releaseSlowTranslation = resolve;
  });
  const slowStarted = new Promise((resolve) => {
    markSlowTranslationStarted = resolve;
  });
  const translator = {
    async translateBidirectional(text) {
      if (text === "chậm") {
        markSlowTranslationStarted();
        await slowGate;
      }

      return { translatedText: `dịch:${text}` };
    },
  };
  const handler = createTextMessageHandler({ translator });
  const slowContext = createContext("chậm", {
    chat: { id: 1 },
    msg: { message_id: 1, text: "chậm" },
  });
  const fastContext = createContext("nhanh", {
    chat: { id: 2 },
    msg: { message_id: 2, text: "nhanh" },
  });

  const slowTask = handler(slowContext);
  await slowStarted;
  await handler(fastContext);

  assert.equal(fastContext.replies[0].text, "dịch:nhanh");
  assert.equal(slowContext.replies.length, 0);

  releaseSlowTranslation();
  await slowTask;
  assert.equal(slowContext.replies[0].text, "dịch:chậm");
});

test("handler giữ cả typing và Google call trong hard concurrency cap", async () => {
  const translationSemaphore = new AsyncSemaphore(3, { maxPending: 6 });
  let activeTyping = 0;
  let maxActiveTyping = 0;
  let translationCalls = 0;
  let releaseTyping;
  let markThreeStarted;
  const typingGate = new Promise((resolve) => {
    releaseTyping = resolve;
  });
  const threeStarted = new Promise((resolve) => {
    markThreeStarted = resolve;
  });
  const translator = {
    async translateBidirectional(text) {
      translationCalls += 1;
      return { translatedText: `dịch:${text}` };
    },
  };
  const handler = createTextMessageHandler({ translator, translationSemaphore });
  const contexts = Array.from({ length: 20 }, (_, index) => createContext(`tin ${index}`, {
    chat: { id: index + 1 },
    msg: { message_id: index + 1, text: `tin ${index}` },
    async sendChatAction(action) {
      assert.equal(action, "typing");
      activeTyping += 1;
      maxActiveTyping = Math.max(maxActiveTyping, activeTyping);
      if (activeTyping === 3) {
        markThreeStarted();
      }
      await typingGate;
      activeTyping -= 1;
    },
  }));

  const jobs = contexts.map((ctx) => handler(ctx));
  const settledJobs = Promise.allSettled(jobs);

  await threeStarted;
  assert.equal(translationSemaphore.activeCount, 3);
  assert.equal(translationSemaphore.pendingCount, 6);

  releaseTyping();
  const results = await settledJobs;
  const capacityReplies = contexts.flatMap((ctx) => ctx.replies)
    .filter(({ text }) => /đang xử lý nhiều/u.test(text));

  assert.ok(results.every((result) => result.status === "fulfilled"));
  assert.equal(maxActiveTyping, 3);
  assert.equal(translationCalls, 9);
  assert.equal(capacityReplies.length, 11);
  assert.equal(translationSemaphore.activeCount, 0);
  assert.equal(translationSemaphore.pendingCount, 0);
});

test("bot hard-timeout HTTP, bỏ command nhắm bot khác và rate-limit command thật", async () => {
  const translator = {
    async translateBidirectional() {
      return { translatedText: "unused" };
    },
  };
  const bot = createTranslationBot({
    token: "123456789:abcdefghijklmnopqrstuvwxyz_ABCDE",
    translator,
    allowAllChats: true,
  });
  bot.botInfo = {
    id: 999,
    is_bot: true,
    first_name: "Trans Bot",
    username: "trans_test_bot",
    can_join_groups: true,
    can_read_all_group_messages: true,
    supports_inline_queries: false,
  };
  const sentMessages = [];
  bot.api.config.use(async (_previous, method, payload) => {
    assert.equal(method, "sendMessage");
    sentMessages.push(payload);
    return {
      ok: true,
      result: {
        message_id: sentMessages.length,
        date: 0,
        chat: { id: 123, type: "private" },
        text: payload.text,
      },
    };
  });

  const handleCommand = async (updateId, text) => {
    await bot.handleUpdate({
      update_id: updateId,
      message: {
        message_id: updateId,
        date: 0,
        chat: { id: 123, type: "private" },
        from: { id: 123, is_bot: false, first_name: "Tester" },
        text,
        entities: [{ type: "bot_command", offset: 0, length: text.length }],
      },
    });
  };

  for (let updateId = 1; updateId <= 3; updateId += 1) {
    await handleCommand(updateId, "/start@other_bot");
  }

  for (let updateId = 4; updateId <= 8; updateId += 1) {
    await handleCommand(updateId, "/start@trans_test_bot");
  }

  assert.equal(bot.clientConfig.timeoutSeconds, 45);
  assert.equal(sentMessages.length, 3);
});
