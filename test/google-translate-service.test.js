import assert from "node:assert/strict";
import test from "node:test";

import {
  TranslationProviderError,
  UnsupportedLanguageError,
} from "../src/errors.js";
import { GoogleTranslateService } from "../src/google-translate-service.js";

function createClient({ detections = [], translations = [] } = {}) {
  const detectRequests = [];
  const translateRequests = [];
  let closed = false;

  return {
    detectRequests,
    translateRequests,
    get closed() {
      return closed;
    },
    async detectLanguage(request, options) {
      detectRequests.push({ request, options });
      const detection = detections.shift();

      if (detection instanceof Error) {
        throw detection;
      }

      return [{ languages: detection ? [detection] : [] }];
    },
    async translateText(request, options) {
      translateRequests.push({ request, options });
      const translation = translations.shift();

      if (translation instanceof Error) {
        throw translation;
      }

      return [{ translations: translation ? [translation] : [] }];
    },
    async close() {
      closed = true;
    },
  };
}

test("detect rồi dịch tiếng Việt sang tiếng Trung giản thể", async () => {
  const client = createClient({
    detections: [{ languageCode: "vi", confidence: 0.99 }],
    translations: [{ translatedText: "你好" }],
  });
  const service = new GoogleTranslateService({ projectId: "project-id", client });

  const result = await service.translateBidirectional("Xin chào");

  assert.equal(result.translatedText, "你好");
  assert.equal(result.targetLanguageCode, "zh-CN");
  assert.equal(result.detectedLanguageCode, "vi");
  assert.equal(result.detectionConfidence, 0.99);
  assert.equal(client.detectRequests[0].request.parent, "projects/project-id/locations/global");
  assert.equal(client.detectRequests[0].request.mimeType, "text/plain");
  assert.equal(client.detectRequests[0].options.timeout, 15_000);
  assert.equal(client.translateRequests[0].request.sourceLanguageCode, "vi");
  assert.equal(client.translateRequests[0].request.targetLanguageCode, "zh-CN");
});

test("detect rồi dịch tiếng Trung phồn thể sang tiếng Việt", async () => {
  const client = createClient({
    detections: [{ languageCode: "zh-TW", confidence: 0.98 }],
    translations: [{ translatedText: "Xin chào" }],
  });
  const service = new GoogleTranslateService({ projectId: "project-id", client });

  const result = await service.translateBidirectional("你好");

  assert.equal(result.translatedText, "Xin chào");
  assert.equal(result.targetLanguageCode, "vi");
  assert.equal(client.translateRequests[0].request.sourceLanguageCode, "zh-TW");
  assert.equal(client.translateRequests.length, 1);
});

test("tin nhắn hỗn hợp dùng kết quả detect làm nguồn duy nhất", async () => {
  const client = createClient({
    detections: [{ languageCode: "vi", confidence: 0.91 }],
    translations: [{ translatedText: "今天发布" }],
  });
  const service = new GoogleTranslateService({ projectId: "project-id", client });

  const result = await service.translateBidirectional("Hôm nay dùng 发布 nhé");

  assert.equal(result.targetLanguageCode, "zh-CN");
  assert.equal(client.detectRequests.length, 1);
  assert.equal(client.translateRequests.length, 1);
  assert.equal(client.translateRequests[0].request.sourceLanguageCode, "vi");
});

test("từ chối ngôn ngữ ngoài tiếng Trung và tiếng Việt trước khi dịch", async () => {
  const client = createClient({
    detections: [{ languageCode: "en", confidence: 0.99 }],
  });
  const service = new GoogleTranslateService({ projectId: "project-id", client });

  await assert.rejects(
    () => service.translateBidirectional("Hello world"),
    UnsupportedLanguageError,
  );
  assert.equal(client.translateRequests.length, 0);
});

test("từ chối kết quả detect có confidence thấp", async () => {
  const client = createClient({
    detections: [{ languageCode: "vi", confidence: 0.4 }],
  });
  const service = new GoogleTranslateService({
    projectId: "project-id",
    minimumConfidence: 0.6,
    client,
  });

  await assert.rejects(
    () => service.translateBidirectional("alo"),
    (error) => {
      assert.ok(error instanceof UnsupportedLanguageError);
      assert.equal(error.detectedLanguageCode, "vi");
      assert.equal(error.confidence, 0.4);
      return true;
    },
  );
  assert.equal(client.translateRequests.length, 0);
});

test("bọc lỗi provider nhưng giữ mã lỗi để quan sát", async () => {
  const providerError = Object.assign(new Error("deadline exceeded"), { code: 4 });
  const client = createClient({ detections: [providerError] });
  const service = new GoogleTranslateService({ projectId: "project-id", client });

  await assert.rejects(
    () => service.translateBidirectional("Xin chào"),
    (error) => {
      assert.ok(error instanceof TranslationProviderError);
      assert.equal(error.providerCode, "4");
      assert.equal(error.cause, providerError);
      return true;
    },
  );
});

test("coi response dịch rỗng là lỗi provider", async () => {
  const client = createClient({
    detections: [{ languageCode: "vi", confidence: 0.99 }],
    translations: [null],
  });
  const service = new GoogleTranslateService({ projectId: "project-id", client });

  await assert.rejects(
    () => service.translateBidirectional("Xin chào"),
    TranslationProviderError,
  );
});

test("coi confidence không hữu hạn là response provider hỏng", async () => {
  const client = createClient({
    detections: [{ languageCode: "vi", confidence: Number.NaN }],
  });
  const service = new GoogleTranslateService({ projectId: "project-id", client });

  await assert.rejects(
    () => service.translateBidirectional("Xin chào"),
    TranslationProviderError,
  );
  assert.equal(client.translateRequests.length, 0);
});

test("đóng Google client khi shutdown", async () => {
  const client = createClient();
  const service = new GoogleTranslateService({ projectId: "project-id", client });

  await service.close();

  assert.equal(client.closed, true);
});
