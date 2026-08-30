export const BOT_COMMANDS = [
  { command: "start", description: "Hướng dẫn sử dụng" },
  { command: "help", description: "Xem trợ giúp" },
  { command: "id", description: "Xem chat ID hiện tại" },
  { command: "addchat", description: "Admin: cho phép nhóm hiện tại" },
  { command: "unchat", description: "Admin: xoá nhóm hiện tại" },
  { command: "list", description: "Admin: xem các chat được phép" },
];

export async function initializeTelegramBot(bot, signal) {
  await bot.init(signal);
  await bot.api.deleteWebhook({ drop_pending_updates: false }, signal);
  await bot.api.setMyCommands(BOT_COMMANDS, {}, signal);

  return bot.botInfo;
}
