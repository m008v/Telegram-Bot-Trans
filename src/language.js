import {
  UnsupportedInputError,
  UnsupportedLanguageError,
} from "./errors.js";

export const VIETNAMESE_LANGUAGE = "vi";
export const DEFAULT_CHINESE_LANGUAGE = "zh-CN";

const HAN_CHARACTER_PATTERN = /\p{Script=Han}/u;
const LATIN_CHARACTER_PATTERN = /\p{Script=Latin}/u;
const JAPANESE_CHARACTER_PATTERN = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const KOREAN_CHARACTER_PATTERN = /\p{Script=Hangul}/u;
const DISTINCTIVE_VIETNAMESE_PATTERN =
  /[ảạẻẹỉịỏọủụỷỵắằẳẵặấầẩẫậếềểễệốồổỗộớờởỡợứừửữự]/iu;
const VIETNAMESE_ASCII_WORDS = new Set([
  "cam",
  "chao",
  "cho",
  "cua",
  "dang",
  "dep",
  "dich",
  "duoc",
  "giup",
  "hom",
  "khong",
  "muon",
  "nay",
  "nguoi",
  "nhieu",
  "nhung",
  "noi",
  "phai",
  "roi",
  "toi",
  "troi",
  "trung",
  "viet",
  "xin",
]);

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

export function getTargetLanguageForSource(sourceFamily, chineseTargetLanguage) {
  if (sourceFamily === "vi") {
    return chineseTargetLanguage;
  }

  if (sourceFamily === "zh") {
    return VIETNAMESE_LANGUAGE;
  }

  return null;
}

export function getSupportedLanguageFamily(languageCode) {
  const normalizedCode = languageCode?.trim().toLowerCase();

  if (normalizedCode === "vi" || normalizedCode?.startsWith("vi-")) {
    return "vi";
  }

  if (normalizedCode === "zh" || normalizedCode?.startsWith("zh-")) {
    return "zh";
  }

  return null;
}

export function hasLikelyVietnameseEvidence(text) {
  const normalizedText = text.normalize("NFC");

  if (DISTINCTIVE_VIETNAMESE_PATTERN.test(normalizedText)) {
    return true;
  }

  const words = normalizedText
    .toLocaleLowerCase("vi-VN")
    .match(/\p{Script=Latin}+/gu) ?? [];
  let matchingWords = 0;

  for (const word of words) {
    const normalizedWord = word
      .normalize("NFD")
      .replace(/\p{Mark}/gu, "")
      .replaceAll("đ", "d");

    if (VIETNAMESE_ASCII_WORDS.has(normalizedWord)) {
      matchingWords += 1;
    }
  }

  return matchingWords >= 2;
}

export function inferSourceLanguageFamily(text) {
  assertContainsSupportedScript(text);

  if (JAPANESE_CHARACTER_PATTERN.test(text)) {
    throw new UnsupportedLanguageError("ja");
  }

  if (KOREAN_CHARACTER_PATTERN.test(text)) {
    throw new UnsupportedLanguageError("ko");
  }

  let hanCount = 0;
  let latinCount = 0;

  for (const character of text) {
    if (HAN_CHARACTER_PATTERN.test(character)) {
      hanCount += 1;
    } else if (LATIN_CHARACTER_PATTERN.test(character)) {
      latinCount += 1;
    }
  }

  return hanCount >= latinCount ? "zh" : "vi";
}
