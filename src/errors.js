export class UnsupportedInputError extends Error {
  constructor(message = "Tin nhắn không có nội dung ngôn ngữ để dịch.") {
    super(message);
    this.name = "UnsupportedInputError";
    this.code = "UNSUPPORTED_INPUT";
  }
}

export class UnsupportedLanguageError extends Error {
  constructor(detectedLanguageCode, confidence) {
    super("Bot chỉ hỗ trợ tiếng Trung và tiếng Việt.");
    this.name = "UnsupportedLanguageError";
    this.code = "UNSUPPORTED_LANGUAGE";
    this.detectedLanguageCode = detectedLanguageCode ?? "unknown";
    this.confidence = confidence;
  }
}

export class TranslationCapacityError extends Error {
  constructor() {
    super("Hàng đợi dịch đang đầy.");
    this.name = "TranslationCapacityError";
    this.code = "TRANSLATION_CAPACITY_EXCEEDED";
  }
}

export class TranslationProviderError extends Error {
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = "TranslationProviderError";
    this.code = "TRANSLATION_PROVIDER_ERROR";
    this.providerCode = options.providerCode;
  }
}
