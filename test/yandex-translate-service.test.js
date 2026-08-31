import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import {
  TranslationProviderError,
  UnsupportedInputError,
  UnsupportedLanguageError,
} from "../src/errors.js";
import {
  YANDEX_TRANSLATE_ENDPOINT,
  YandexTranslateService,
} from "../src/yandex-translate-service.js";

const API_KEY = "AQVN_test_api_key_without_secret_value";

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
  const headers = new Map([["content-type", contentType]]);

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

function translationPayload(text, detectedLanguageCode = "vi") {
  return {
    translations: [{ text, detectedLanguageCode }],
  };
}

function createService(fetchImpl, options = {}) {
  return new YandexTranslateService({
    apiKey: API_KEY,
    fetchImpl,
    ...options,
  });
}

test("dịch tiếng Việt sang Trung bằng POST JSON và giữ secret khỏi URL", async () => {
  const fetchImpl = createFetch([createResponse(translationPayload("你好"))]);
  const service = createService(fetchImpl);

  const result = await service.translateBidirectional("Xin chào & hẹn + gặp\nlại");

  assert.deepEqual(result, {
    translatedText: "你好",
    sourceLanguageCode: "vi",
    targetLanguageCode: "zh",
  });
  assert.equal(fetchImpl.requests.length, 1);
  const [{ url, options }] = fetchImpl.requests;
  const body = JSON.parse(options.body);
  assert.equal(url, YANDEX_TRANSLATE_ENDPOINT);
  assert.equal(url.includes("Xin"), false);
  assert.equal(url.includes(API_KEY), false);
  assert.equal(options.method, "POST");
  assert.equal(options.redirect, "error");
  assert.equal(options.headers.Authorization, `Api-Key ${API_KEY}`);
  assert.equal(options.headers["x-data-logging-enabled"], "false");
  assert.deepEqual(body, {
    sourceLanguageCode: "vi",
    targetLanguageCode: "zh",
    format: "PLAIN_TEXT",
    texts: ["Xin chào & hẹn + gặp\nlại"],
  });
  assert.ok(options.signal instanceof AbortSignal);
});

test("gửi folder ID khi được cấu hình", async () => {
  const fetchImpl = createFetch([createResponse(translationPayload("你好"))]);
  const service = createService(fetchImpl, { folderId: "b1gexamplefolder123" });

  await service.translateBidirectional("Xin chào");

  const body = JSON.parse(fetchImpl.requests[0].options.body);
  assert.equal(body.folderId, "b1gexamplefolder123");
});

test("dịch cả Trung giản thể và phồn thể sang tiếng Việt", async () => {
  const fetchImpl = createFetch([
    createResponse(translationPayload("Xin chào", "zh")),
    createResponse(translationPayload("Bản dịch phồn thể", "zh")),
  ]);
  const service = createService(fetchImpl);

  const simplified = await service.translateBidirectional("你好");
  const traditional = await service.translateBidirectional("這是一個翻譯測試");

  assert.equal(simplified.targetLanguageCode, "vi");
  assert.equal(traditional.targetLanguageCode, "vi");
  assert.equal(
    JSON.parse(fetchImpl.requests[0].options.body).sourceLanguageCode,
    "zh",
  );
  assert.equal(
    JSON.parse(fetchImpl.requests[1].options.body).targetLanguageCode,
    "vi",
  );
});

test("tiếng Việt ngắn hoặc không dấu đủ dấu hiệu dùng source vi", async () => {
  const cases = ["ê", "ơi", "đi", "hãy", "xin chao, cam on ban"];
  const fetchImpl = createFetch(
    cases.map(() => createResponse(translationPayload("你好"))),
  );
  const service = createService(fetchImpl);

  for (const sourceText of cases) {
    await service.translateBidirectional(sourceText);
  }

  assert.deepEqual(
    fetchImpl.requests.map(({ options }) => (
      JSON.parse(options.body).sourceLanguageCode
    )),
    cases.map(() => "vi"),
  );
});

test("câu Latin mơ hồ dùng auto-detect và chỉ chấp nhận tiếng Việt", async () => {
  const fetchImpl = createFetch([
    createResponse(translationPayload("再见", "vi")),
    createResponse(translationPayload("你好世界", "en")),
    createResponse(translationPayload("不想", "pt")),
  ]);
  const service = createService(fetchImpl);

  const vietnamese = await service.translateBidirectional("Hen gap lai");
  assert.equal(vietnamese.translatedText, "再见");
  assert.equal(
    Object.hasOwn(JSON.parse(fetchImpl.requests[0].options.body), "sourceLanguageCode"),
    false,
  );

  await assert.rejects(
    () => service.translateBidirectional("Hello world"),
    (error) => error instanceof UnsupportedLanguageError
      && error.detectedLanguageCode === "en",
  );
  await assert.rejects(
    () => service.translateBidirectional("não quero"),
    (error) => error instanceof UnsupportedLanguageError
      && error.detectedLanguageCode === "pt",
  );
});

test("tin hỗn hợp chọn source theo script chiếm ưu thế và ưu tiên Hán khi hòa", async () => {
  const fetchImpl = createFetch([
    createResponse(translationPayload("今天发布")),
    createResponse(translationPayload("Phát hành", "zh")),
  ]);
  const service = createService(fetchImpl);

  const latinDominant = await service.translateBidirectional("Hôm nay dùng 发布 nhé");
  const tied = await service.translateBidirectional("发布 ab");

  assert.equal(latinDominant.sourceLanguageCode, "vi");
  assert.equal(latinDominant.targetLanguageCode, "zh");
  assert.equal(tied.sourceLanguageCode, "zh");
  assert.equal(tied.targetLanguageCode, "vi");
});

test("đọc JSON UTF-8 thành công khi stream chẻ giữa ký tự Trung", async () => {
  const responseBytes = Buffer.from(
    JSON.stringify(translationPayload("你好，Việt Nam")),
    "utf8",
  );
  const offset = responseBytes.indexOf(Buffer.from("你", "utf8"));
  let released = false;
  const response = createResponse(null);
  response.body = createReadableBody([
    responseBytes.subarray(0, offset + 1),
    responseBytes.subarray(offset + 1),
  ], {
    onRelease() {
      released = true;
    },
  });
  const service = createService(createFetch([response]));

  const result = await service.translateBidirectional("Xin chào");

  assert.equal(result.translatedText, "你好，Việt Nam");
  assert.equal(released, true);
});

test("từ chối input rỗng, emoji và script Nhật trước khi gọi mạng", async () => {
  const fetchImpl = createFetch([]);
  const service = createService(fetchImpl);

  await assert.rejects(
    () => service.translateBidirectional("🎉 123"),
    UnsupportedInputError,
  );
  await assert.rejects(
    () => service.translateBidirectional("今日は元気ですか"),
    UnsupportedLanguageError,
  );
  assert.equal(fetchImpl.requests.length, 0);
});

test("giữ status auth, permission và quota làm provider code", async () => {
  let cancellationCount = 0;
  const responses = [401, 403, 429].map((status) => {
    const response = createResponse(null, { status });
    response.body = createReadableBody([], {
      onCancel() {
        cancellationCount += 1;
      },
    });
    return response;
  });
  const service = createService(createFetch(responses));

  for (const status of [401, 403, 429]) {
    await assert.rejects(
      () => service.translateBidirectional("Xin chào"),
      (error) => error instanceof TranslationProviderError
        && error.providerCode === `HTTP_${status}`,
    );
  }
  assert.equal(cancellationCount, responses.length);
});

test("phân biệt timeout và network error mà không lộ nội dung hoặc API key", async () => {
  const timeoutError = new Error(`request ${API_KEY} timed out`);
  timeoutError.name = "TimeoutError";
  const fetchImpl = createFetch([timeoutError, new Error(`socket ${API_KEY} failed`)]);
  const service = createService(fetchImpl);

  for (const expectedCode of ["TIMEOUT", "NETWORK"]) {
    await assert.rejects(
      () => service.translateBidirectional("Nội dung bí mật"),
      (error) => {
        assert.equal(error.providerCode, expectedCode);
        assert.equal(error.message.includes("Nội dung bí mật"), false);
        assert.equal(error.message.includes(API_KEY), false);
        return true;
      },
    );
  }
});

test("từ chối JSON, content type, shape và bản dịch rỗng không hợp lệ", async (t) => {
  const cases = [
    ["JSON hỏng", createResponse(null, { raw: "not-json" })],
    ["HTML", createResponse(null, { contentType: "text/html" })],
    ["shape hỏng", createResponse({ translation: "你好" })],
    ["nhiều kết quả", createResponse({ translations: [
      { text: "一" },
      { text: "二" },
    ] })],
    ["text hỏng", createResponse({ translations: [{ text: null }] })],
    ["bản dịch rỗng", createResponse(translationPayload("   "))],
  ];

  for (const [name, response] of cases) {
    await t.test(name, async () => {
      const service = createService(createFetch([response]));
      await assert.rejects(
        () => service.translateBidirectional("Xin chào"),
        (error) => error instanceof TranslationProviderError
          && error.providerCode === "INVALID_RESPONSE",
      );
    });
  }
});

test("auto-detect bắt buộc trả về mã ngôn ngữ nguồn", async () => {
  const service = createService(createFetch([
    createResponse({ translations: [{ text: "再见" }] }),
  ]));

  await assert.rejects(
    () => service.translateBidirectional("Hen gap lai"),
    (error) => error.providerCode === "INVALID_RESPONSE",
  );
});

test("chặn response quá lớn và phân loại lỗi đọc body", async () => {
  let cancelled = false;
  const declaredOversized = createResponse(null, { contentLength: 300_000 });
  declaredOversized.body = createReadableBody([], {
    onCancel() {
      cancelled = true;
    },
  });

  const streamOversized = createResponse(null);
  streamOversized.body = createReadableBody([Buffer.alloc(256_001)]);

  const timeoutError = new Error("body timed out");
  timeoutError.name = "TimeoutError";
  const timeoutResponse = createResponse(null);
  timeoutResponse.body = createReadableBody([], { readError: timeoutError });

  const service = createService(createFetch([
    declaredOversized,
    streamOversized,
    timeoutResponse,
  ]));

  await assert.rejects(
    () => service.translateBidirectional("Xin chào"),
    (error) => error.providerCode === "INVALID_RESPONSE",
  );
  assert.equal(cancelled, true);
  await assert.rejects(
    () => service.translateBidirectional("Xin chào"),
    (error) => error.providerCode === "INVALID_RESPONSE",
  );
  await assert.rejects(
    () => service.translateBidirectional("Xin chào"),
    (error) => error.providerCode === "TIMEOUT" && error.cause === timeoutError,
  );
});

test("chặn request vượt 10000 ký tự trước khi gọi mạng", async () => {
  const fetchImpl = createFetch([]);
  const service = createService(fetchImpl);

  await assert.rejects(
    () => service.translateBidirectional("a".repeat(10_001)),
    (error) => error.providerCode === "INVALID_REQUEST",
  );
  assert.equal(fetchImpl.requests.length, 0);
});

test("constructor kiểm tra credential, folder, timeout và target", async () => {
  assert.throws(
    () => new YandexTranslateService(),
    /YANDEX_TRANSLATE_API_KEY/u,
  );
  assert.throws(
    () => new YandexTranslateService({ apiKey: "key with space" }),
    /khoảng trắng/u,
  );
  assert.throws(
    () => new YandexTranslateService({ apiKey: API_KEY, folderId: "bad folder" }),
    /FOLDER_ID/u,
  );
  assert.throws(
    () => new YandexTranslateService({ apiKey: API_KEY, timeoutMs: 999 }),
    /1000 đến 60000/u,
  );
  assert.throws(
    () => new YandexTranslateService({
      apiKey: API_KEY,
      chineseTargetLanguage: "zh-TW",
    }),
    /chỉ hỗ trợ target/u,
  );

  const service = createService(createFetch([]));
  await assert.doesNotReject(() => service.close());
});
