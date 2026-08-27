import { Buffer } from "node:buffer";
import { URLSearchParams } from "node:url";
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

export const GTX_TRANSLATE_ENDPOINT =
  "https://translate.googleapis.com/translate_a/single";

const SUPPORTED_CHINESE_TARGETS = new Set(["zh-CN", "zh-TW"]);
const MAX_RESPONSE_LENGTH = 256_000;

function createProviderError(message, providerCode, cause) {
  return new TranslationProviderError(message, { cause, providerCode });
}

function isTimeoutError(error) {
  return error?.name === "TimeoutError" || error?.name === "AbortError";
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
          "Google GTX trả về response quá lớn.",
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
          ? "Google GTX phản hồi quá thời gian cho phép."
          : "Không thể đọc response từ Google GTX.",
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
          "Google GTX trả về stream không hợp lệ.",
          "INVALID_RESPONSE",
        );
      }

      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_RESPONSE_LENGTH) {
        throw createProviderError(
          "Google GTX trả về response quá lớn.",
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
        ? "Google GTX phản hồi quá thời gian cho phép."
        : "Không thể đọc response từ Google GTX.",
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

function parseGtxPayload(payload, { requireDetectedLanguage = false } = {}) {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) {
    throw createProviderError(
      "Google GTX trả về dữ liệu không hợp lệ.",
      "INVALID_RESPONSE",
    );
  }

  const translatedParts = payload[0].map((segment) => {
    if (!Array.isArray(segment) || typeof segment[0] !== "string") {
      throw createProviderError(
        "Google GTX trả về segment không hợp lệ.",
        "INVALID_RESPONSE",
      );
    }

    return segment[0];
  });
  const translatedText = translatedParts.join("");

  if (translatedText.trim().length === 0) {
    throw createProviderError(
      "Google GTX trả về bản dịch rỗng.",
      "INVALID_RESPONSE",
    );
  }

  const detectedLanguageCode = typeof payload[2] === "string"
    ? payload[2].trim()
    : undefined;

  if (requireDetectedLanguage && !detectedLanguageCode) {
    throw createProviderError(
      "Google GTX không trả về ngôn ngữ nguồn.",
      "INVALID_RESPONSE",
    );
  }

  return { translatedText, detectedLanguageCode };
}

export class GtxTranslateService {
  constructor({
    chineseTargetLanguage = "zh-CN",
    timeoutMs = 15_000,
    fetchImpl = globalThis.fetch,
  } = {}) {
    if (!SUPPORTED_CHINESE_TARGETS.has(chineseTargetLanguage)) {
      throw new RangeError("Chinese target chỉ nhận zh-CN hoặc zh-TW.");
    }

    if (typeof fetchImpl !== "function") {
      throw new TypeError("Môi trường chạy không hỗ trợ fetch.");
    }

    this.chineseTargetLanguage = chineseTargetLanguage;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async translateBidirectional(text) {
    const sourceFamily = inferSourceLanguageFamily(text);
    const shouldAutoDetect = sourceFamily === "vi"
      && !hasLikelyVietnameseEvidence(text);
    const requestSourceLanguageCode = sourceFamily === "zh"
      ? "zh"
      : shouldAutoDetect ? "auto" : "vi";
    const targetLanguageCode = getTargetLanguageForSource(
      sourceFamily,
      this.chineseTargetLanguage,
    );
    const translation = await this.translateText(
      text,
      requestSourceLanguageCode,
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
      sourceLanguageCode: sourceFamily === "zh" ? "zh" : "vi",
      targetLanguageCode,
    };
  }

  async translateText(
    text,
    sourceLanguageCode,
    targetLanguageCode,
    { requireDetectedLanguage = false } = {},
  ) {
    const body = new URLSearchParams({
      client: "gtx",
      sl: sourceLanguageCode,
      tl: targetLanguageCode,
      dt: "t",
      q: text,
    });
    let response;

    try {
      response = await this.fetchImpl(GTX_TRANSLATE_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timedOut = isTimeoutError(error);
      throw createProviderError(
        timedOut
          ? "Google GTX phản hồi quá thời gian cho phép."
          : "Không thể kết nối tới Google GTX.",
        timedOut ? "TIMEOUT" : "NETWORK",
        error,
      );
    }

    if (!response || typeof response.ok !== "boolean") {
      throw createProviderError(
        "Google GTX trả về HTTP response không hợp lệ.",
        "INVALID_RESPONSE",
      );
    }

    if (!response.ok) {
      await cancelResponseBody(response);
      throw createProviderError(
        "Google GTX từ chối hoặc không xử lý được request.",
        `HTTP_${response.status}`,
      );
    }

    const contentType = response.headers?.get?.("content-type");
    if (contentType && !contentType.toLowerCase().includes("application/json")) {
      await cancelResponseBody(response);
      throw createProviderError(
        "Google GTX trả về content type không hợp lệ.",
        "INVALID_RESPONSE",
      );
    }

    const declaredLength = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_LENGTH) {
      await cancelResponseBody(response);
      throw createProviderError(
        "Google GTX trả về response quá lớn.",
        "INVALID_RESPONSE",
      );
    }

    const responseText = await readResponseText(response);

    let payload;
    try {
      payload = JSON.parse(responseText);
    } catch (error) {
      throw createProviderError(
        "Google GTX trả về JSON không hợp lệ.",
        "INVALID_RESPONSE",
        error,
      );
    }

    return parseGtxPayload(payload, { requireDetectedLanguage });
  }

  async close() {
    // Native fetch không giữ client riêng cần đóng.
  }
}
