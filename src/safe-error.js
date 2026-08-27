const TELEGRAM_TOKEN_PATTERN = /\b\d+:[A-Za-z0-9_-]{20,}\b/gu;

function redact(value, secrets) {
  let result = String(value ?? "").replace(
    TELEGRAM_TOKEN_PATTERN,
    "[REDACTED_TELEGRAM_BOT_TOKEN]",
  );

  for (const secret of secrets) {
    if (secret) {
      result = result.replaceAll(secret, "[REDACTED]");
    }
  }

  return result;
}

export function toSafeError(error, secrets = []) {
  return {
    name: redact(error?.name || "Error", secrets),
    code: redact(error?.code || "UNKNOWN", secrets),
    message: redact(error?.message || "Lỗi không xác định.", secrets),
  };
}
