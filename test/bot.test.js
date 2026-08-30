import assert from "node:assert/strict";
import test from "node:test";

import { AsyncSemaphore } from "../src/async-semaphore.js";
import { createTextMessageHandler, createTranslationBot } from "../src/bot.js";
import {
  TranslationCapacityError,
  UnsupportedInputError,
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

function createCommandHarness(options = {}) {
  const getChat = options.getChat ?? ((chatId) => ({
    id: chatId,
    type: "supergroup",
    title: `Nhóm ${chatId}`,
  }));
  const translator = options.translator ?? {
    async translateBidirectional(text) {
      return { translatedText: `dịch:${text}` };
    },
  };
  const bot = createTranslationBot({
    token: "123456789:abcdefghijklmnopqrstuvwxyz_ABCDE",
    translator,
    ...options,
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
  const getChatCalls = [];
  bot.api.config.use(async (_previous, method, payload) => {
    if (method === "getChat") {
      const chatId = String(payload.chat_id);
      getChatCalls.push(chatId);
      return { ok: true, result: await getChat(chatId) };
    }

    assert.equal(method, "sendMessage");
    sentMessages.push(payload);
    return {
      ok: true,
      result: {
        message_id: sentMessages.length,
        date: 0,
        chat: { id: payload.chat_id, type: "supergroup" },
        text: payload.text,
      },
    };
  });

  const handleMessage = async ({
    updateId,
    text,
    userId = 42,
    chatId = -100123,
    chatType = "supergroup",
    command = false,
  }) => bot.handleUpdate({
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 0,
      chat: { id: chatId, type: chatType, title: "Nhóm test" },
      from: { id: userId, is_bot: false, first_name: "Tester" },
      text,
      ...(command
        ? { entities: [{ type: "bot_command", offset: 0, length: text.length }] }
        : {}),
    },
  });

  return { bot, getChatCalls, handleMessage, sentMessages };
}

test("handler gửi bản dịch như tin nhắn thường, không reply tin gốc", async () => {
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
  assert.equal(ctx.replies[0].options, undefined);
});

test("handler chia bản dịch dài và gửi mọi chunk như tin nhắn thường", async () => {
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
  assert.equal(ctx.replies[0].options, undefined);
  assert.equal(ctx.replies[1].options, undefined);
});

test("handler im lặng khi provider phát hiện ngôn ngữ không hỗ trợ", async () => {
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

  assert.equal(ctx.replies.length, 0);
  assert.equal(logEntries.length, 0);
});

test("handler im lặng khi tin nhắn không có nội dung dịch hợp lệ", async () => {
  const ctx = createContext("🎉 123");
  const logEntries = [];
  const translator = {
    async translateBidirectional() {
      throw new UnsupportedInputError();
    },
  };
  const handler = createTextMessageHandler({
    translator,
    logger: { error: (entry) => logEntries.push(entry) },
  });

  await handler(ctx);

  assert.equal(ctx.replies.length, 0);
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
  assert.equal(ctx.replies[0].options, undefined);
  assert.equal(logEntries.length, 0);
});

test("handler gửi cảnh báo rate-limit như tin nhắn thường", async () => {
  const ctx = createContext("Xin chào");
  let translationCalls = 0;
  const translator = {
    async translateBidirectional() {
      translationCalls += 1;
      return { translatedText: "unused" };
    },
  };
  const rateLimiter = {
    tryAcquire() {
      return {
        allowed: false,
        retryAfterSeconds: 12,
        shouldNotify: true,
      };
    },
  };
  const handler = createTextMessageHandler({ translator, rateLimiter });

  await handler(ctx);

  assert.equal(translationCalls, 0);
  assert.match(ctx.replies[0].text, /12 giây/u);
  assert.equal(ctx.replies[0].options, undefined);
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

test("handler giữ cả typing và provider call trong hard concurrency cap", async () => {
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

test("admin dùng /addchat trong group thì mở quyền ngay cho group đó", async () => {
  const allowedChatIds = new Set();
  const persistedChatIds = [];
  const translatedTexts = [];
  const { handleMessage, sentMessages } = createCommandHarness({
    allowedChatIds,
    adminUserIds: new Set(["42"]),
    async addAllowedChatId(chatId) {
      persistedChatIds.push(String(chatId));
      allowedChatIds.add(String(chatId));
      return { added: true };
    },
    translator: {
      async translateBidirectional(text) {
        translatedTexts.push(text);
        return { translatedText: "你好" };
      },
    },
  });

  await handleMessage({ updateId: 1, text: "/addchat", command: true });
  await handleMessage({ updateId: 2, text: "Xin chào" });

  assert.deepEqual(persistedChatIds, ["-100123"]);
  assert.deepEqual(translatedTexts, ["Xin chào"]);
  assert.match(sentMessages[0].text, /Đã thêm nhóm -100123/u);
  assert.equal(sentMessages[1].text, "你好");
});

test("admin dùng /unchat trong group thì thu hồi quyền ngay", async () => {
  const allowedChatIds = new Set(["-100123"]);
  const removedChatIds = [];
  let translationCalls = 0;
  const { handleMessage, sentMessages } = createCommandHarness({
    allowedChatIds,
    adminUserIds: new Set(["42"]),
    async removeAllowedChatId(chatId) {
      removedChatIds.push(String(chatId));
      allowedChatIds.delete(String(chatId));
      return { removed: true };
    },
    translator: {
      async translateBidirectional() {
        translationCalls += 1;
        return { translatedText: "unused" };
      },
    },
  });

  await handleMessage({ updateId: 1, text: "/unchat", command: true });
  await handleMessage({ updateId: 2, text: "Xin chào" });

  assert.deepEqual(removedChatIds, ["-100123"]);
  assert.equal(allowedChatIds.has("-100123"), false);
  assert.equal(translationCalls, 0);
  assert.match(sentMessages[0].text, /Đã xoá nhóm -100123/u);
});

test("các lệnh quản trị bỏ qua người không có quyền", async () => {
  let persistenceCalls = 0;
  const { handleMessage, sentMessages } = createCommandHarness({
    allowedChatIds: new Set(["-100123"]),
    adminUserIds: new Set(["42"]),
    async addAllowedChatId() {
      persistenceCalls += 1;
      return { added: true };
    },
    async removeAllowedChatId() {
      persistenceCalls += 1;
      return { removed: true };
    },
  });

  for (const [index, command] of ["/addchat", "/unchat", "/list"].entries()) {
    await handleMessage({
      updateId: index + 1,
      text: command,
      userId: 84,
      command: true,
    });
  }

  assert.equal(persistenceCalls, 0);
  assert.equal(sentMessages.length, 0);
});

test("/addchat chỉ nhận group và từ chối khi bot đang public", async () => {
  let persistenceCalls = 0;
  const options = {
    adminUserIds: new Set(["42"]),
    async addAllowedChatId() {
      persistenceCalls += 1;
      return { added: true };
    },
  };
  const privateHarness = createCommandHarness(options);
  const publicHarness = createCommandHarness({ ...options, allowAllChats: true });

  await privateHarness.handleMessage({
    updateId: 1,
    text: "/addchat",
    chatId: 42,
    chatType: "private",
    command: true,
  });
  await publicHarness.handleMessage({ updateId: 2, text: "/addchat", command: true });

  assert.equal(persistenceCalls, 0);
  assert.match(privateHarness.sentMessages[0].text, /chỉ dùng trong nhóm/u);
  assert.match(publicHarness.sentMessages[0].text, /đang cho phép mọi chat/u);
});

test("/unchat chỉ nhận group, từ chối chế độ public và báo khi nhóm chưa được phép", async () => {
  let persistenceCalls = 0;
  const options = {
    adminUserIds: new Set(["42"]),
    async removeAllowedChatId() {
      persistenceCalls += 1;
      return { removed: false };
    },
  };
  const privateHarness = createCommandHarness(options);
  const publicHarness = createCommandHarness({ ...options, allowAllChats: true });
  const missingHarness = createCommandHarness(options);

  await privateHarness.handleMessage({
    updateId: 1,
    text: "/unchat",
    chatId: 42,
    chatType: "private",
    command: true,
  });
  await publicHarness.handleMessage({ updateId: 2, text: "/unchat", command: true });
  await missingHarness.handleMessage({ updateId: 3, text: "/unchat", command: true });

  assert.equal(persistenceCalls, 1);
  assert.match(privateHarness.sentMessages[0].text, /chỉ dùng trong nhóm/u);
  assert.match(publicHarness.sentMessages[0].text, /đang cho phép mọi chat/u);
  assert.match(missingHarness.sentMessages[0].text, /không có trong/u);
});

test("/list cho admin xem allowlist kể cả từ private chat chưa được phép", async () => {
  const allowedChatIds = new Set(["-100123", "-100456"]);
  const { getChatCalls, handleMessage, sentMessages } = createCommandHarness({
    allowedChatIds,
    adminUserIds: new Set(["42"]),
    getChat(chatId) {
      if (chatId === "-100123") {
        return { id: chatId, type: "supergroup", title: "\u202eNhóm Alpha\n nội bộ" };
      }

      return {
        id: chatId,
        type: "private",
        first_name: "Minh",
        last_name: "Huy",
      };
    },
  });

  await handleMessage({
    updateId: 1,
    text: "/list",
    chatId: 42,
    chatType: "private",
    command: true,
  });

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0].text, /được phép dùng bot \(2\)/u);
  assert.match(sentMessages[0].text, /- Nhóm Alpha nội bộ — ID: -100123/u);
  assert.match(sentMessages[0].text, /- Minh Huy — ID: -100456/u);
  assert.deepEqual(getChatCalls, ["-100123", "-100456"]);
});

test("/list báo allowlist rỗng, chế độ public và chia danh sách dài an toàn", async () => {
  const emptyHarness = createCommandHarness({ adminUserIds: new Set(["42"]) });
  const publicHarness = createCommandHarness({
    adminUserIds: new Set(["42"]),
    allowAllChats: true,
  });
  let activeLookups = 0;
  let maxActiveLookups = 0;
  const longHarness = createCommandHarness({
    allowedChatIds: new Set(
      Array.from({ length: 500 }, (_, index) => `-10012345${String(index).padStart(3, "0")}`),
    ),
    adminUserIds: new Set(["42"]),
    async getChat(chatId) {
      activeLookups += 1;
      maxActiveLookups = Math.max(maxActiveLookups, activeLookups);
      await Promise.resolve();
      activeLookups -= 1;
      return { id: chatId, type: "supergroup", title: `Nhóm ${chatId}` };
    },
  });

  await emptyHarness.handleMessage({ updateId: 1, text: "/list", command: true });
  await publicHarness.handleMessage({ updateId: 2, text: "/list", command: true });
  await longHarness.handleMessage({ updateId: 3, text: "/list", command: true });

  assert.match(emptyHarness.sentMessages[0].text, /Chưa có chat hoặc nhóm/u);
  assert.match(publicHarness.sentMessages[0].text, /đang cho phép mọi chat/u);
  assert.equal(emptyHarness.getChatCalls.length, 0);
  assert.equal(publicHarness.getChatCalls.length, 0);
  assert.equal(maxActiveLookups, 4);
  assert.ok(longHarness.sentMessages.length > 1);
  assert.ok(longHarness.sentMessages.every(({ text }) => Array.from(text).length <= 3_900));
});

test("/list giữ ID và tiếp tục khi Telegram không trả được tên chat", async () => {
  const logEntries = [];
  const { handleMessage, sentMessages } = createCommandHarness({
    allowedChatIds: new Set(["-100123", "-100456"]),
    adminUserIds: new Set(["42"]),
    logger: {
      error() {},
      warn: (entry) => logEntries.push(entry),
    },
    getChat(chatId) {
      if (chatId === "-100456") {
        throw new Error(
          "Telegram lỗi với token 123456789:abcdefghijklmnopqrstuvwxyz_ABCDE",
        );
      }

      return { id: chatId, type: "supergroup", title: "Nhóm còn hoạt động" };
    },
  });

  await handleMessage({ updateId: 1, text: "/list", command: true });

  assert.match(sentMessages[0].text, /Nhóm còn hoạt động — ID: -100123/u);
  assert.match(sentMessages[0].text, /Không lấy được tên — ID: -100456/u);
  assert.equal(logEntries[0].event, "allowed_chat_lookup_failed");
  assert.equal(logEntries[0].chatId, "-100456");
  assert.doesNotMatch(
    logEntries[0].error.message,
    /123456789:abcdefghijklmnopqrstuvwxyz_ABCDE/u,
  );
});

test("/addchat báo lỗi an toàn nếu không ghi được .env", async () => {
  const logEntries = [];
  const { handleMessage, sentMessages } = createCommandHarness({
    adminUserIds: new Set(["42"]),
    logger: { error: (entry) => logEntries.push(entry) },
    async addAllowedChatId() {
      throw new Error("permission denied: secret-value");
    },
  });

  await handleMessage({ updateId: 1, text: "/addchat", command: true });

  assert.equal(logEntries[0].event, "allowed_chat_persist_failed");
  assert.match(sentMessages[0].text, /Không thể lưu nhóm/u);
  assert.doesNotMatch(sentMessages[0].text, /secret-value/u);
});

test("/unchat báo lỗi an toàn nếu không ghi được .env", async () => {
  const logEntries = [];
  const { handleMessage, sentMessages } = createCommandHarness({
    allowedChatIds: new Set(["-100123"]),
    adminUserIds: new Set(["42"]),
    logger: { error: (entry) => logEntries.push(entry) },
    async removeAllowedChatId() {
      throw new Error("permission denied: secret-value");
    },
  });

  await handleMessage({ updateId: 1, text: "/unchat", command: true });

  assert.equal(logEntries[0].event, "allowed_chat_persist_failed");
  assert.equal(logEntries[0].operation, "remove");
  assert.match(sentMessages[0].text, /Không thể xoá nhóm/u);
  assert.doesNotMatch(sentMessages[0].text, /secret-value/u);
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
