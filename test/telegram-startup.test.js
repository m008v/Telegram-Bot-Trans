import assert from "node:assert/strict";
import test from "node:test";

import { BOT_COMMANDS, initializeTelegramBot } from "../src/telegram-startup.js";

test("menu Telegram đăng ký lệnh quản trị allowlist", () => {
  assert.deepEqual(BOT_COMMANDS.slice(-3), [
    { command: "addchat", description: "Admin: cho phép nhóm hiện tại" },
    { command: "unchat", description: "Admin: xoá nhóm hiện tại" },
    { command: "list", description: "Admin: xem các chat được phép" },
  ]);
});

test("startup init, xóa webhook không drop update rồi mới đăng ký command", async () => {
  const calls = [];
  const signal = { name: "test-signal" };
  const botInfo = { id: 1, username: "trans_bot" };
  const bot = {
    botInfo,
    async init(receivedSignal) {
      calls.push(["init", receivedSignal]);
    },
    api: {
      async deleteWebhook(payload, receivedSignal) {
        calls.push(["deleteWebhook", payload, receivedSignal]);
      },
      async setMyCommands(commands, options, receivedSignal) {
        calls.push(["setMyCommands", commands, options, receivedSignal]);
      },
    },
  };

  const result = await initializeTelegramBot(bot, signal);

  assert.equal(result, botInfo);
  assert.deepEqual(calls, [
    ["init", signal],
    ["deleteWebhook", { drop_pending_updates: false }, signal],
    ["setMyCommands", BOT_COMMANDS, {}, signal],
  ]);
});
