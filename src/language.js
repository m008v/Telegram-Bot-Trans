import { UnsupportedInputError } from "./errors.js";

export const VIETNAMESE_LANGUAGE = "vi";
export const DEFAULT_CHINESE_LANGUAGE = "zh-CN";

const HAN_CHARACTER_PATTERN = /\p{Script=Han}/u;
const LATIN_CHARACTER_PATTERN = /\p{Script=Latin}/u;

export function assertContainsSupportedScript(text) {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new UnsupportedInputError();
  }

  for (const character of text) {
    if (HAN_CHARACTER_PATTERN.test(character) || LATIN_CHARACTER_PATTERN.test(character)) {
      return;
    }
  }

  throw new UnsupportedInputError();
}

export function getSupportedLanguageFamily(languageCode) {
  const normalizedCode = languageCode?.trim().toLowerCase();

  if (normalizedCode === "vi") {
    return "vi";
  }

  if (normalizedCode === "zh" || normalizedCode?.startsWith("zh-")) {
    return "zh";
  }

  return null;
}

export function getTargetLanguageForSource(sourceFamily, chineseTargetLanguage) {
  if (sourceFamily === "vi") {
    return chineseTargetLanguage;
  }

  if (sourceFamily === "zh") {
    return VIETNAMESE_LANGUAGE;
  }

  return null;
}
