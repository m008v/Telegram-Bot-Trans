export const TELEGRAM_SAFE_MESSAGE_LENGTH = 3_900;

function findPreferredBoundary(characters, start, hardEnd) {
  const minimumBoundary = start + Math.floor((hardEnd - start) * 0.6);

  for (let index = hardEnd - 1; index >= minimumBoundary; index -= 1) {
    if (characters[index] === "\n") {
      return index + 1;
    }
  }

  for (let index = hardEnd - 1; index >= minimumBoundary; index -= 1) {
    if (/\s/u.test(characters[index])) {
      return index + 1;
    }
  }

  return hardEnd;
}

export function splitTelegramMessage(text, maxLength = TELEGRAM_SAFE_MESSAGE_LENGTH) {
  if (typeof text !== "string" || text.length === 0) {
    return [];
  }

  if (!Number.isInteger(maxLength) || maxLength < 1) {
    throw new RangeError("maxLength phải là số nguyên dương.");
  }

  const characters = Array.from(text);
  if (characters.length <= maxLength) {
    return [text];
  }

  const chunks = [];
  let start = 0;

  while (start < characters.length) {
    const hardEnd = Math.min(start + maxLength, characters.length);
    const end = hardEnd === characters.length
      ? hardEnd
      : findPreferredBoundary(characters, start, hardEnd);

    chunks.push(characters.slice(start, end).join(""));
    start = end;
  }

  return chunks;
}
