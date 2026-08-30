import { randomUUID } from "node:crypto";
import {
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { TextDecoder } from "node:util";

const ALLOWED_CHAT_IDS_VARIABLE = "TELEGRAM_ALLOWED_CHAT_IDS";
const ALLOWED_CHAT_IDS_ASSIGNMENT = new RegExp(
  `^(\\s*(?:export\\s+)?${ALLOWED_CHAT_IDS_VARIABLE}\\s*=\\s*)(.*)$`,
  "u",
);
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function normalizeChatId(chatId) {
  const normalized = String(chatId).trim();
  if (!/^-?\d+$/u.test(normalized)) {
    throw new Error(`Chat ID không hợp lệ: ${normalized}`);
  }

  return normalized;
}

function splitValueAndComment(rawValue) {
  const trimmedValue = rawValue.trim();
  const quotedMatch = /^(["'])(.*?)\1(\s*(?:#.*)?)$/u.exec(trimmedValue);
  if (quotedMatch) {
    return { value: quotedMatch[2], comment: quotedMatch[3] };
  }

  const commentMatch = /^([^#]*?)(\s*#.*)?$/u.exec(rawValue);
  return {
    value: commentMatch[1].trim(),
    comment: commentMatch[2] ?? "",
  };
}

function parseChatIds(value) {
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return entries.map(normalizeChatId);
}

export function updateAllowedChatIdsEnv(content, chatIds) {
  const normalizedChatIds = new Set([...chatIds].map(normalizeChatId));
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/u);
  let assignmentIndex = -1;
  let assignmentPrefix = `${ALLOWED_CHAT_IDS_VARIABLE}=`;
  let assignmentComment = "";

  for (const [index, line] of lines.entries()) {
    const match = ALLOWED_CHAT_IDS_ASSIGNMENT.exec(line);
    if (!match) {
      continue;
    }

    if (assignmentIndex !== -1) {
      throw new Error(`${ALLOWED_CHAT_IDS_VARIABLE} bị khai báo nhiều lần trong .env.`);
    }

    assignmentIndex = index;
    assignmentPrefix = match[1];
    const parsedValue = splitValueAndComment(match[2]);
    assignmentComment = parsedValue.comment;
    for (const chatId of parseChatIds(parsedValue.value)) {
      normalizedChatIds.add(chatId);
    }
  }

  const assignment = `${assignmentPrefix}${[...normalizedChatIds].join(",")}${assignmentComment}`;
  if (assignmentIndex === -1) {
    const separator = content.length === 0 || content.endsWith("\n") ? "" : newline;
    return `${content}${separator}${assignment}${newline}`;
  }

  lines[assignmentIndex] = assignment;
  return lines.join(newline);
}

async function readUtf8File(filePath) {
  try {
    return UTF8_DECODER.decode(await readFile(filePath));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }

    throw error;
  }
}

async function getFileMode(filePath) {
  try {
    return (await stat(filePath)).mode;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return 0o600;
    }

    throw error;
  }
}

async function removeTemporaryFile(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

async function writeFileAtomically(filePath, content, mode) {
  const temporaryPath = join(
    dirname(filePath),
    `${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    await writeFile(temporaryPath, content, {
      encoding: "utf8",
      flag: "wx",
      mode,
    });
    await rename(temporaryPath, filePath);
  } catch (error) {
    try {
      await removeTemporaryFile(temporaryPath);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Không thể cập nhật .env và dọn file tạm.",
        { cause: cleanupError },
      );
    }

    throw error;
  }
}

export class AllowedChatStore {
  #pendingUpdate = Promise.resolve();

  constructor({ filePath, allowedChatIds }) {
    this.filePath = filePath;
    this.allowedChatIds = allowedChatIds;
  }

  add(chatId) {
    const update = this.#pendingUpdate.then(() => this.#add(chatId));
    this.#pendingUpdate = update.then(
      () => undefined,
      () => undefined,
    );
    return update;
  }

  async #add(chatId) {
    const normalizedChatId = normalizeChatId(chatId);
    const wasAllowed = this.allowedChatIds.has(normalizedChatId);
    const currentContent = await readUtf8File(this.filePath);
    const updatedContent = updateAllowedChatIdsEnv(
      currentContent,
      new Set([...this.allowedChatIds, normalizedChatId]),
    );

    if (updatedContent !== currentContent) {
      const mode = await getFileMode(this.filePath);
      await writeFileAtomically(this.filePath, updatedContent, mode);
    }

    this.allowedChatIds.add(normalizedChatId);
    return { added: !wasAllowed };
  }
}
