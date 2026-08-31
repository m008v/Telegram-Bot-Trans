import { Buffer } from "node:buffer";
import { TextDecoder } from "node:util";

import {
  TranslationProviderError,
  UnsupportedLanguageError,
} from "./errors.js";
import {
  getTargetLanguageForSource,
  getSupportedLanguageFamily,
  hasLikelyVietnameseEvidence,
  inferSourceLanguageFamily,
} from "./language.js";

export const YANDEX_TRANSLATE_ENDPOINT =
  "https://translate.api.cloud.yandex.net/translate/v2/translate";

const YANDEX_CHINESE_LANGUAGE = "zh";
const MAX_REQUEST_CHARACTERS = 10_000;
const MAX_RESPONSE_LENGTH = 256_000;

function createProviderError(message, providerCode, cause) {
  return new TranslationProviderError(message, { cause, providerCode });
}

function isTimeoutError(error) {
  return error?.name === "TimeoutError" || error?.name === "AbortError";
}

function assertValidApiKey(apiKey) {
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw new TypeError("YANDEX_TRANSLATE_API_KEY là bắt buộc.");
  }

  if (/\s/u.test(apiKey)) {
    throw new TypeError("YANDEX_TRANSLATE_API_KEY không được chứa khoảng trắng.");
  }
}

function assertValidFolderId(folderId) {
  if (folderId === undefined) {
    return;
  }

  if (
    typeof folderId !== "string"
    || !/^[A-Za-z0-9_-]{1,50}$/u.test(folderId)
  ) {
    throw new TypeError("YANDEX_TRANSLATE_FOLDER_ID không đúng định dạng.");
  }
}

async function cancelResponseBody(response) {
  if (typeof response?.body?.cancel !== "function") {
    return;
  }

  try {
    await response.body.cancel();
  } catch {
    // Cleanup best-effort không được che lỗi response gốc.
  }
}

async function readResponseText(response) {
  const reader = response.body?.getReader?.();

  if (!reader) {
    try {
      const responseText = await response.text();
      if (Buffer.byteLength(responseText, "utf8") > MAX_RESPONSE_LENGTH) {
        throw createProviderError(
          "Yandex Translate trả về response quá lớn.",
          "INVALID_RESPONSE",
        );
      }

      return responseText;
    } catch (error) {
      if (error instanceof TranslationProviderError) {
        throw error;
      }

      throw createProviderError(
        isTimeoutError(error)
          ? "Yandex Translate phản hồi quá thời gian cho phép."
          : "Không thể đọc response từ Yandex Translate.",
        isTimeoutError(error) ? "TIMEOUT" : "INVALID_RESPONSE",
        error,
      );
    }
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let responseText = "";
  let receivedBytes = 0;
  let completed = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (!(value instanceof Uint8Array)) {
        throw createProviderError(
          "Yandex Translate trả về stream không hợp lệ.",
          "INVALID_RESPONSE",
        );
      }

      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_RESPONSE_LENGTH) {
        throw createProviderError(
          "Yandex Translate trả về response quá lớn.",
          "INVALID_RESPONSE",
        );
      }

      responseText += decoder.decode(value, { stream: true });
    }

    responseText += decoder.decode();
    completed = true;
    return responseText;
  } catch (error) {
    if (error instanceof TranslationProviderError) {
      throw error;
    }

    throw createProviderError(
      isTimeoutError(error)
        ? "Yandex Translate phản hồi quá thời gian cho phép."
        : "Không thể đọc response từ Yandex Translate.",
      isTimeoutError(error) ? "TIMEOUT" : "INVALID_RESPONSE",
      error,
    );
  } finally {
    if (!completed) {
      try {
        await reader.cancel();
      } catch {
        // Hủy stream chỉ là cleanup best-effort, không che lỗi gốc.
      }
    }
    reader.releaseLock?.();
  }
}

function parseYandexPayload(payload, { requireDetectedLanguage = false } = {}) {
  if (
    typeof payload !== "object"
    || payload === null
    || !Array.isArray(payload.translations)
    || payload.translations.length !== 1
  ) {
    throw createProviderError(
      "Yandex Translate trả về dữ liệu không hợp lệ.",
      "INVALID_RESPONSE",
    );
  }

  const [translation] = payload.translations;
  if (
    typeof translation !== "object"
    || translation === null
    || typeof translation.text !== "string"
    || translation.text.trim().length === 0
  ) {
    throw createProviderError(
      "Yandex Translate trả về bản dịch không hợp lệ.",
      "INVALID_RESPONSE",
    );
  }

  const detectedLanguageCode =
    typeof translation.detectedLanguageCode === "string"
      ? translation.detectedLanguageCode.trim()
      : undefined;

  if (requireDetectedLanguage && !detectedLanguageCode) {
    throw createProviderError(
      "Yandex Translate không trả về ngôn ngữ nguồn.",
      "INVALID_RESPONSE",
    );
  }

  return {
    translatedText: translation.text,
    detectedLanguageCode,
  };
}

export class YandexTranslateService {
  constructor({
    apiKey,
    folderId,
    chineseTargetLanguage = YANDEX_CHINESE_LANGUAGE,
    timeoutMs = 15_000,
    fetchImpl = globalThis.fetch,
  } = {}) {
    assertValidApiKey(apiKey);
    assertValidFolderId(folderId);

    if (chineseTargetLanguage !== YANDEX_CHINESE_LANGUAGE) {
      throw new RangeError("Yandex Translate chỉ hỗ trợ target tiếng Trung là zh.");
    }

    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
      throw new RangeError("timeoutMs phải là số nguyên từ 1000 đến 60000.");
    }

    if (typeof fetchImpl !== "function") {
      throw new TypeError("Môi trường chạy không hỗ trợ fetch.");
    }

    this.apiKey = apiKey;
    this.folderId = folderId;
    this.chineseTargetLanguage = chineseTargetLanguage;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async translateBidirectional(text) {
    const sourceFamily = inferSourceLanguageFamily(text);
    const shouldAutoDetect = sourceFamily === "vi"
      && !hasLikelyVietnameseEvidence(text);
    const sourceLanguageCode = shouldAutoDetect ? undefined : sourceFamily;
    const targetLanguageCode = getTargetLanguageForSource(
      sourceFamily,
      this.chineseTargetLanguage,
    );
    const translation = await this.translateText(
      text,
      sourceLanguageCode,
      targetLanguageCode,
      { requireDetectedLanguage: shouldAutoDetect },
    );

    if (
      shouldAutoDetect
      && getSupportedLanguageFamily(translation.detectedLanguageCode) !== "vi"
    ) {
      throw new UnsupportedLanguageError(translation.detectedLanguageCode);
    }

    return {
      translatedText: translation.translatedText,
      sourceLanguageCode: sourceFamily,
      targetLanguageCode,
    };
  }

  async translateText(
    text,
    sourceLanguageCode,
    targetLanguageCode,
    { requireDetectedLanguage = false } = {},
  ) {
    if (Array.from(text).length > MAX_REQUEST_CHARACTERS) {
      throw createProviderError(
        "Nội dung vượt giới hạn 10000 ký tự của Yandex Translate.",
        "INVALID_REQUEST",
      );
    }

    const requestBody = {
      targetLanguageCode,
      format: "PLAIN_TEXT",
      texts: [text],
    };

    if (sourceLanguageCode) {
      requestBody.sourceLanguageCode = sourceLanguageCode;
    }

    if (this.folderId) {
      requestBody.folderId = this.folderId;
    }

    let response;
    try {
      response = await this.fetchImpl(YANDEX_TRANSLATE_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Api-Key ${this.apiKey}`,
          "Content-Type": "application/json; charset=UTF-8",
          "x-data-logging-enabled": "false",
        },
        body: JSON.stringify(requestBody),
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timedOut = isTimeoutError(error);
      throw createProviderError(
        timedOut
          ? "Yandex Translate phản hồi quá thời gian cho phép."
          : "Không thể kết nối tới Yandex Translate.",
        timedOut ? "TIMEOUT" : "NETWORK",
        error,
      );
    }

    if (!response || typeof response.ok !== "boolean") {
      throw createProviderError(
        "Yandex Translate trả về HTTP response không hợp lệ.",
        "INVALID_RESPONSE",
      );
    }

    if (!response.ok) {
      await cancelResponseBody(response);
      throw createProviderError(
        "Yandex Translate từ chối hoặc không xử lý được request.",
        `HTTP_${response.status}`,
      );
    }

    const contentType = response.headers?.get?.("content-type");
    if (contentType && !contentType.toLowerCase().includes("application/json")) {
      await cancelResponseBody(response);
      throw createProviderError(
        "Yandex Translate trả về content type không hợp lệ.",
        "INVALID_RESPONSE",
      );
    }

    const declaredLength = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_LENGTH) {
      await cancelResponseBody(response);
      throw createProviderError(
        "Yandex Translate trả về response quá lớn.",
        "INVALID_RESPONSE",
      );
    }

    const responseText = await readResponseText(response);

    let payload;
    try {
      payload = JSON.parse(responseText);
    } catch (error) {
      throw createProviderError(
        "Yandex Translate trả về JSON không hợp lệ.",
        "INVALID_RESPONSE",
        error,
      );
    }

    return parseYandexPayload(payload, { requireDetectedLanguage });
  }

  async close() {
    // Native fetch không giữ client riêng cần đóng.
  }
}
