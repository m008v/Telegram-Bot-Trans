import { v3 } from "@google-cloud/translate";

import {
  TranslationProviderError,
  UnsupportedLanguageError,
} from "./errors.js";
import {
  assertContainsSupportedScript,
  getSupportedLanguageFamily,
  getTargetLanguageForSource,
} from "./language.js";

const { TranslationServiceClient } = v3;

function normalizeProviderCode(error) {
  if (typeof error?.code === "number" || typeof error?.code === "string") {
    return String(error.code);
  }

  return undefined;
}

export class GoogleTranslateService {
  constructor({
    projectId,
    location = "global",
    chineseTargetLanguage = "zh-CN",
    timeoutMs = 15_000,
    minimumConfidence = 0.6,
    client,
  }) {
    this.parent = `projects/${projectId}/locations/${location}`;
    this.chineseTargetLanguage = chineseTargetLanguage;
    this.timeoutMs = timeoutMs;
    this.minimumConfidence = minimumConfidence;
    this.client = client ?? new TranslationServiceClient(
      location === "global"
        ? {}
        : { apiEndpoint: `${location}-translate.googleapis.com` },
    );
  }

  async translateBidirectional(text) {
    assertContainsSupportedScript(text);
    const detection = await this.detectSourceLanguage(text);
    const sourceFamily = getSupportedLanguageFamily(detection.languageCode);

    if (!sourceFamily || detection.confidence < this.minimumConfidence) {
      throw new UnsupportedLanguageError(detection.languageCode, detection.confidence);
    }

    const targetLanguageCode = getTargetLanguageForSource(
      sourceFamily,
      this.chineseTargetLanguage,
    );
    const translatedText = await this.translateText(
      text,
      detection.languageCode,
      targetLanguageCode,
    );

    return {
      translatedText,
      detectedLanguageCode: detection.languageCode,
      detectionConfidence: detection.confidence,
      targetLanguageCode,
    };
  }

  async detectSourceLanguage(text) {
    try {
      const [response] = await this.client.detectLanguage(
        {
          parent: this.parent,
          content: text,
          mimeType: "text/plain",
        },
        { timeout: this.timeoutMs },
      );
      const detections = response.languages ?? [];
      const detection = detections.reduce((best, candidate) => {
        if (!best || (candidate.confidence ?? -1) > (best.confidence ?? -1)) {
          return candidate;
        }

        return best;
      }, null);

      if (
        typeof detection?.languageCode !== "string"
        || detection.languageCode.trim().length === 0
        || !Number.isFinite(detection.confidence)
        || detection.confidence < 0
        || detection.confidence > 1
      ) {
        throw new TranslationProviderError("Google không trả về kết quả nhận diện hợp lệ.");
      }

      return {
        languageCode: detection.languageCode,
        confidence: detection.confidence,
      };
    } catch (error) {
      throw this.wrapProviderError(error, "Không thể nhận diện ngôn ngữ bằng Google.");
    }
  }

  async translateText(text, sourceLanguageCode, targetLanguageCode) {
    try {
      const [response] = await this.client.translateText(
        {
          parent: this.parent,
          contents: [text],
          mimeType: "text/plain",
          sourceLanguageCode,
          targetLanguageCode,
        },
        { timeout: this.timeoutMs },
      );
      const translation = response.translations?.[0];

      if (
        typeof translation?.translatedText !== "string"
        || translation.translatedText.trim().length === 0
      ) {
        throw new TranslationProviderError("Google Cloud Translation trả về kết quả rỗng.");
      }

      return translation.translatedText;
    } catch (error) {
      throw this.wrapProviderError(error, "Không thể gọi Google Cloud Translation.");
    }
  }

  wrapProviderError(error, message) {
    if (error instanceof TranslationProviderError) {
      return error;
    }

    return new TranslationProviderError(message, {
      cause: error,
      providerCode: normalizeProviderCode(error),
    });
  }

  async close() {
    await this.client.close();
  }
}
