import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AllowedChatStore,
  removeAllowedChatIdEnv,
  updateAllowedChatIdsEnv,
} from "../src/allowed-chat-store.js";

test("updateAllowedChatIdsEnv giữ nguyên secret, comment và CRLF", () => {
  const original = [
    "TELEGRAM_BOT_TOKEN=secret-khong-duoc-dung",
    "TELEGRAM_ALLOWED_CHAT_IDS=\"123,-100456\" # Các nhóm đã duyệt",
    "TELEGRAM_ADMIN_IDS=42",
    "",
  ].join("\r\n");

  const updated = updateAllowedChatIdsEnv(original, new Set(["123", "-100789"]));

  assert.equal(updated, [
    "TELEGRAM_BOT_TOKEN=secret-khong-duoc-dung",
    "TELEGRAM_ALLOWED_CHAT_IDS=123,-100789,-100456 # Các nhóm đã duyệt",
    "TELEGRAM_ADMIN_IDS=42",
    "",
  ].join("\r\n"));
});

test("updateAllowedChatIdsEnv thêm biến khi .env chưa khai báo allowlist", () => {
  assert.equal(
    updateAllowedChatIdsEnv("TELEGRAM_BOT_TOKEN=fixture", ["-100123"]),
    "TELEGRAM_BOT_TOKEN=fixture\nTELEGRAM_ALLOWED_CHAT_IDS=-100123\n",
  );
  assert.equal(
    updateAllowedChatIdsEnv("TELEGRAM_ALLOWED_CHAT_IDS=123# comment\n", ["-100456"]),
    "TELEGRAM_ALLOWED_CHAT_IDS=-100456,123# comment\n",
  );
});

test("updateAllowedChatIdsEnv từ chối cấu hình mơ hồ hoặc chat ID lỗi", () => {
  assert.throws(
    () => updateAllowedChatIdsEnv([
      "TELEGRAM_ALLOWED_CHAT_IDS=123",
      "TELEGRAM_ALLOWED_CHAT_IDS=456",
    ].join("\n"), ["789"]),
    /khai báo nhiều lần/u,
  );
  assert.throws(
    () => updateAllowedChatIdsEnv("TELEGRAM_ALLOWED_CHAT_IDS=abc\n", ["123"]),
    /Chat ID không hợp lệ/u,
  );
});

test("removeAllowedChatIdEnv xoá đúng ID và giữ nguyên secret, comment, CRLF", () => {
  const original = [
    "TELEGRAM_BOT_TOKEN=secret-khong-duoc-dung",
    "TELEGRAM_ALLOWED_CHAT_IDS=123,-100456,-100789 # Các nhóm đã duyệt",
    "TELEGRAM_ADMIN_IDS=42",
    "",
  ].join("\r\n");

  assert.equal(removeAllowedChatIdEnv(original, "-100456"), [
    "TELEGRAM_BOT_TOKEN=secret-khong-duoc-dung",
    "TELEGRAM_ALLOWED_CHAT_IDS=123,-100789 # Các nhóm đã duyệt",
    "TELEGRAM_ADMIN_IDS=42",
    "",
  ].join("\r\n"));
  assert.equal(removeAllowedChatIdEnv(original, "-100000"), original);
});

test("AllowedChatStore ghi tuần tự, áp dụng add/remove ngay và không để file tạm", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "trans-bot-allowlist-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const envPath = join(directory, ".env");
  await writeFile(envPath, [
    "TELEGRAM_BOT_TOKEN=fixture",
    "TELEGRAM_ALLOWED_CHAT_IDS=123",
    "",
  ].join("\n"), "utf8");
  const allowedChatIds = new Set(["123"]);
  const store = new AllowedChatStore({ filePath: envPath, allowedChatIds });

  const [first, second] = await Promise.all([
    store.add("-100456"),
    store.add("-100789"),
  ]);
  const duplicate = await store.add("-100456");
  const [removed, missing] = await Promise.all([
    store.remove("-100456"),
    store.remove("-100000"),
  ]);

  assert.deepEqual(first, { added: true });
  assert.deepEqual(second, { added: true });
  assert.deepEqual(duplicate, { added: false });
  assert.deepEqual(removed, { removed: true });
  assert.deepEqual(missing, { removed: false });
  assert.deepEqual([...allowedChatIds], ["123", "-100789"]);
  assert.match(
    await readFile(envPath, "utf8"),
    /^TELEGRAM_ALLOWED_CHAT_IDS=123,-100789$/mu,
  );
  assert.deepEqual(await readdir(directory), [".env"]);
});

test("AllowedChatStore không đổi quyền trong RAM nếu file không phải UTF-8", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "trans-bot-invalid-env-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const envPath = join(directory, ".env");
  await writeFile(envPath, Buffer.from([0xc3, 0x28]));
  const allowedChatIds = new Set();
  const store = new AllowedChatStore({ filePath: envPath, allowedChatIds });

  await assert.rejects(() => store.add("-100456"), /encoded data/u);
  assert.equal(allowedChatIds.size, 0);

  allowedChatIds.add("-100456");
  await assert.rejects(() => store.remove("-100456"), /encoded data/u);
  assert.equal(allowedChatIds.has("-100456"), true);
  assert.deepEqual(await readFile(envPath), Buffer.from([0xc3, 0x28]));
});
