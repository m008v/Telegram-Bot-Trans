import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import {
  TranslationProviderError,
  UnsupportedInputError,
  UnsupportedLanguageError,
} from "../src/errors.js";
import {
  GTX_TRANSLATE_ENDPOINT,
  GtxTranslateService,
} from "../src/gtx-translate-service.js";

function createResponse(
  payload,
  {
    status = 200,
    contentType = "application/json; charset=utf-8",
    contentLength,
    raw,
    readError,
  } = {},
) {
  const responseText = raw ?? JSON.stringify(payload);
  const headers = new Map([
    ["content-type", contentType],
  ]);

  if (contentLength !== undefined) {
    headers.set("content-length", String(contentLength));
  }

  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headers.get(name.toLowerCase()) ?? null;
      },
    },
    async text() {
      if (readError) {
        throw readError;
      }

      return responseText;
    },
  };
}

function createFetch(responses) {
  const requests = [];
  const queue = [...responses];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    const next = queue.shift();

    if (next instanceof Error) {
      throw next;
    }

    return next;
  };

  fetchImpl.requests = requests;
  return fetchImpl;
}

function createReadableBody(
  chunks,
  { readError, onCancel = () => {}, onRelease = () => {} } = {},
) {
  return {
    async cancel() {
      onCancel();
    },
    getReader() {
      const queue = [...chunks];
      return {
        async read() {
          if (readError) {
            throw readError;
          }

          const value = queue.shift();
          return value ? { done: false, value } : { done: true };
        },
        async cancel() {
          onCancel();
        },
        releaseLock() {
          onRelease();
        },
      };
    },
  };
}

function translationPayload(...parts) {
  return [parts.map((part) => [part, "source"]), null, "vi"];
}

function translationPayloadWithDetectedLanguage(detectedLanguageCode, ...parts) {
  return [parts.map((part) => [part, "source"]), null, detectedLanguageCode];
}

test("dịch tiếng Việt sang Trung bằng POST form, không để nội dung trong URL", async () => {
  const fetchImpl = createFetch([createResponse(translationPayload("你好"))]);
  const service = new GtxTranslateService({ fetchImpl });

  const result = await service.translateBidirectional("Xin chào & hẹn + gặp\nlại");

  assert.equal(result.translatedText, "你好");
  assert.equal(result.sourceLanguageCode, "vi");
  assert.equal(result.targetLanguageCode, "zh-CN");
  assert.equal(fetchImpl.requests.length, 1);
  const [{ url, options }] = fetchImpl.requests;
  assert.equal(url, GTX_TRANSLATE_ENDPOINT);
  assert.equal(url.includes("Xin"), false);
  assert.equal(options.method, "POST");
  assert.equal(options.redirect, "error");
  assert.equal(options.headers.Accept, "application/json");
  assert.equal(options.body.get("client"), "gtx");
  assert.equal(options.body.get("sl"), "vi");
  assert.equal(options.body.get("tl"), "zh-CN");
  assert.equal(options.body.get("dt"), "t");
  assert.equal(options.body.get("q"), "Xin chào & hẹn + gặp\nlại");
  assert.ok(options.signal instanceof AbortSignal);
});

test("dịch cả Trung giản thể và phồn thể sang tiếng Việt", async () => {
  const fetchImpl = createFetch([
    createResponse(translationPayload("Xin chào")),
    createResponse(translationPayload("Bản dịch phồn thể")),
  ]);
  const service = new GtxTranslateService({ fetchImpl });

  const simplified = await service.translateBidirectional("你好");
  const traditional = await service.translateBidirectional("這是一個翻譯測試");

  assert.equal(simplified.targetLanguageCode, "vi");
  assert.equal(traditional.targetLanguageCode, "vi");
  assert.equal(fetchImpl.requests[0].options.body.get("sl"), "zh");
  assert.equal(fetchImpl.requests[1].options.body.get("sl"), "zh");
  assert.equal(fetchImpl.requests[1].options.body.get("tl"), "vi");
});

test("hỗ trợ cấu hình đầu ra Trung phồn thể", async () => {
  const fetchImpl = createFetch([createResponse(translationPayload("你好"))]);
  const service = new GtxTranslateService({
    chineseTargetLanguage: "zh-TW",
    fetchImpl,
  });

  const result = await service.translateBidirectional("Xin chào");

  assert.equal(result.targetLanguageCode, "zh-TW");
  assert.equal(fetchImpl.requests[0].options.body.get("tl"), "zh-TW");
});

test("tiếng Việt không dấu đủ dấu hiệu dùng source vi thay vì auto", async () => {
  const fetchImpl = createFetch([createResponse(translationPayload("你好朋友"))]);
  const service = new GtxTranslateService({ fetchImpl });

  await service.translateBidirectional("xin chao, cam on ban");

  assert.equal(fetchImpl.requests[0].options.body.get("sl"), "vi");
});

test("từ tiếng Việt cực ngắn dùng source vi thay vì phụ thuộc auto-detect", async () => {
  const cases = [
    ["ê", "嘿"],
    ["ơi", "喂"],
    ["đi", "去"],
    ["hãy", "请"],
  ];
  const fetchImpl = createFetch(
    cases.map(([, translatedText]) => createResponse(
      translationPayload(translatedText),
    )),
  );
  const service = new GtxTranslateService({ fetchImpl });

  for (const [sourceText, translatedText] of cases) {
    const result = await service.translateBidirectional(sourceText);
    assert.equal(result.translatedText, translatedText);
  }

  assert.deepEqual(
    fetchImpl.requests.map(({ options }) => options.body.get("sl")),
    cases.map(() => "vi"),
  );
});

test("câu Latin mơ hồ dùng auto và chỉ chấp nhận kết quả phát hiện là tiếng Việt", async () => {
  const fetchImpl = createFetch([
    createResponse(translationPayloadWithDetectedLanguage("vi", "再见")),
    createResponse(translationPayloadWithDetectedLanguage("en", "你好世界")),
    createResponse(translationPayloadWithDetectedLanguage("pt", "不想")),
  ]);
  const service = new GtxTranslateService({ fetchImpl });

  const vietnamese = await service.translateBidirectional("Hen gap lai");
  assert.equal(vietnamese.translatedText, "再见");
  assert.equal(fetchImpl.requests[0].options.body.get("sl"), "auto");

  await assert.rejects(
    () => service.translateBidirectional("Hello world"),
    (error) => {
      assert.ok(error instanceof UnsupportedLanguageError);
      assert.equal(error.detectedLanguageCode, "en");
      return true;
    },
  );
  assert.equal(fetchImpl.requests[1].options.body.get("sl"), "auto");
  assert.equal(fetchImpl.requests[1].options.body.get("tl"), "zh-CN");

  await assert.rejects(
    () => service.translateBidirectional("não quero"),
    (error) => error instanceof UnsupportedLanguageError
      && error.detectedLanguageCode === "pt",
  );
  assert.equal(fetchImpl.requests[2].options.body.get("sl"), "auto");
});

test("tin hỗn hợp chọn source theo script chiếm ưu thế và ưu tiên Hán khi hòa", async () => {
  const fetchImpl = createFetch([
    createResponse(translationPayload("今天发布")),
    createResponse(translationPayload("Phát hành")),
  ]);
  const service = new GtxTranslateService({ fetchImpl });

  const latinDominant = await service.translateBidirectional("Hôm nay dùng 发布 nhé");
  const tied = await service.translateBidirectional("发布 ab");

  assert.equal(latinDominant.sourceLanguageCode, "vi");
  assert.equal(latinDominant.targetLanguageCode, "zh-CN");
  assert.equal(tied.sourceLanguageCode, "zh");
  assert.equal(tied.targetLanguageCode, "vi");
});

test("nối đầy đủ mọi segment bản dịch", async () => {
  const fetchImpl = createFetch([
    createResponse(translationPayload("你好。", "今天天气很好。")),
  ]);
  const service = new GtxTranslateService({ fetchImpl });

  const result = await service.translateBidirectional("Xin chào. Hôm nay trời đẹp.");

  assert.equal(result.translatedText, "你好。今天天气很好。");
});

test("đọc JSON UTF-8 thành công khi stream chẻ giữa một ký tự Trung", async () => {
  const responseBytes = Buffer.from(
    JSON.stringify(translationPayload("你好，Việt Nam")),
    "utf8",
  );
  const chineseCharacterOffset = responseBytes.indexOf(Buffer.from("你", "utf8"));
  assert.notEqual(chineseCharacterOffset, -1);
  let released = false;
  const response = createResponse(null);
  response.body = createReadableBody([
    responseBytes.subarray(0, chineseCharacterOffset + 1),
    responseBytes.subarray(chineseCharacterOffset + 1),
  ], {
    onRelease() {
      released = true;
    },
  });
  const service = new GtxTranslateService({
    fetchImpl: createFetch([response]),
  });

  const result = await service.translateBidirectional("Xin chào");

  assert.equal(result.translatedText, "你好，Việt Nam");
  assert.equal(released, true);
});

test("từ chối input rỗng, emoji và script Nhật trước khi gọi mạng", async () => {
  const fetchImpl = createFetch([]);
  const service = new GtxTranslateService({ fetchImpl });

  await assert.rejects(() => service.translateBidirectional("🎉 123"), UnsupportedInputError);
  await assert.rejects(
    () => service.translateBidirectional("今日は元気ですか"),
    UnsupportedLanguageError,
  );
  assert.equal(fetchImpl.requests.length, 0);
});

test("giữ HTTP status làm provider code", async () => {
  const fetchImpl = createFetch([createResponse(null, { status: 429 })]);
  const service = new GtxTranslateService({ fetchImpl });

  await assert.rejects(
    () => service.translateBidirectional("Xin chào"),
    (error) => {
      assert.ok(error instanceof TranslationProviderError);
      assert.equal(error.providerCode, "HTTP_429");
      return true;
    },
  );
});

test("phân biệt timeout và network error mà không làm lộ nội dung", async () => {
  const timeoutError = new Error("request timed out");
  timeoutError.name = "TimeoutError";
  const fetchImpl = createFetch([timeoutError, new Error("socket failed")]);
  const service = new GtxTranslateService({ fetchImpl });

  await assert.rejects(
    () => service.translateBidirectional("Nội dung bí mật"),
    (error) => {
      assert.equal(error.providerCode, "TIMEOUT");
      assert.equal(error.message.includes("Nội dung bí mật"), false);
      return true;
    },
  );
  await assert.rejects(
    () => service.translateBidirectional("Nội dung bí mật"),
    (error) => {
      assert.equal(error.providerCode, "NETWORK");
      assert.equal(error.message.includes("Nội dung bí mật"), false);
      return true;
    },
  );
});

test("từ chối JSON, content type, shape và bản dịch rỗng không hợp lệ", async (t) => {
  const cases = [
    ["JSON hỏng", createResponse(null, { raw: "not-json" })],
    ["HTML", createResponse(null, { contentType: "text/html" })],
    ["shape hỏng", createResponse({ translation: "你好" })],
    ["segment hỏng", createResponse([[null]])],
    ["bản dịch rỗng", createResponse(translationPayload("   "))],
  ];

  for (const [name, response] of cases) {
    await t.test(name, async () => {
      const service = new GtxTranslateService({
        fetchImpl: createFetch([response]),
      });

      await assert.rejects(
        () => service.translateBidirectional("Xin chào"),
        (error) => {
          assert.ok(error instanceof TranslationProviderError);
          assert.equal(error.providerCode, "INVALID_RESPONSE");
          return true;
        },
      );
    });
  }
});

test("từ chối response khai báo quá lớn và lỗi khi đọc body", async () => {
  const readError = new Error("stream failed");
  const fetchImpl = createFetch([
    createResponse(null, { contentLength: 300_000 }),
    createResponse(null, { readError }),
  ]);
  const service = new GtxTranslateService({ fetchImpl });

  await assert.rejects(
    () => service.translateBidirectional("Xin chào"),
    (error) => error.providerCode === "INVALID_RESPONSE",
  );
  await assert.rejects(
    () => service.translateBidirectional("Xin chào"),
    (error) => error.providerCode === "INVALID_RESPONSE" && error.cause === readError,
  );
});

test("chặn stream vượt giới hạn trước khi đọc hết và phân loại timeout đọc body", async () => {
  let cancelled = false;
  const oversizedResponse = createResponse(null);
  oversizedResponse.body = createReadableBody([Buffer.alloc(256_001)], {
    onCancel() {
      cancelled = true;
    },
  });

  const timeoutError = new Error("body timed out");
  timeoutError.name = "TimeoutError";
  const timeoutResponse = createResponse(null);
  timeoutResponse.body = createReadableBody([], { readError: timeoutError });

  const service = new GtxTranslateService({
    fetchImpl: createFetch([oversizedResponse, timeoutResponse]),
  });

  await assert.rejects(
    () => service.translateBidirectional("Xin chào"),
    (error) => error.providerCode === "INVALID_RESPONSE",
  );
  assert.equal(cancelled, true);
  await assert.rejects(
    () => service.translateBidirectional("Xin chào"),
    (error) => error.providerCode === "TIMEOUT" && error.cause === timeoutError,
  );
});

test("hủy body khi từ chối response trước khi đọc stream", async () => {
  let cancellationCount = 0;
  const responses = [
    createResponse(null, { status: 429 }),
    createResponse(null, { contentType: "text/html" }),
    createResponse(null, { contentLength: 300_000 }),
  ];

  for (const response of responses) {
    response.body = createReadableBody([], {
      onCancel() {
        cancellationCount += 1;
      },
    });
  }

  const service = new GtxTranslateService({
    fetchImpl: createFetch(responses),
  });

  for (let index = 0; index < responses.length; index += 1) {
    await assert.rejects(() => service.translateBidirectional("Xin chào"));
  }
  assert.equal(cancellationCount, responses.length);
});

test("auto-detect bắt buộc trả về mã ngôn ngữ nguồn", async () => {
  const payloadWithoutLanguage = [[[
    "再见",
    "Hen gap lai",
  ]]];
  const service = new GtxTranslateService({
    fetchImpl: createFetch([createResponse(payloadWithoutLanguage)]),
  });

  await assert.rejects(
    () => service.translateBidirectional("Hen gap lai"),
    (error) => error.providerCode === "INVALID_RESPONSE",
  );
});

test("constructor khóa target language và close là no-op an toàn", async () => {
  assert.throws(
    () => new GtxTranslateService({ chineseTargetLanguage: "cn" }),
    /zh-CN hoặc zh-TW/u,
  );
  const service = new GtxTranslateService({ fetchImpl: createFetch([]) });
  await assert.doesNotReject(() => service.close());
});
