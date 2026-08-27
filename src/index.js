import {
  clearTimeout as cancelTimeout,
  setTimeout as scheduleTimeout,
} from "node:timers";

import { run } from "@grammyjs/runner";

import { createTranslationBot } from "./bot.js";
import { loadConfig } from "./config.js";
import { GtxTranslateService } from "./gtx-translate-service.js";
import { drainRunnerAndCloseTranslator } from "./runner-lifecycle.js";
import { toSafeError } from "./safe-error.js";
import { initializeTelegramBot } from "./telegram-startup.js";

const STARTUP_TIMEOUT_MS = 45_000;
const FORCE_SHUTDOWN_TIMEOUT_MS = 130_000;
const RUNNER_CAPACITY = 100;

async function main() {
  const config = loadConfig();
  const translator = new GtxTranslateService({
    chineseTargetLanguage: config.chineseTargetLanguage,
    timeoutMs: config.translationTimeoutMs,
  });
  const bot = createTranslationBot({
    token: config.telegramToken,
    translator,
    allowedChatIds: config.allowedChatIds,
    allowAllChats: config.allowAllChats,
    perChatTranslationsPerMinute: config.perChatTranslationsPerMinute,
    globalTranslationsPerMinute: config.globalTranslationsPerMinute,
    maxConcurrentTranslations: config.maxConcurrentTranslations,
  });

  const startupController = new AbortController();
  let runner;
  let shutdownPromise;
  let shutdownRequested = false;
  let forceShutdownTimer;
  let operationError;
  let cleanupError;

  const requestStop = (signal) => {
    if (shutdownRequested) {
      return;
    }

    shutdownRequested = true;
    console.info({ event: "bot_stopping", signal });
    startupController.abort(new Error(`Nhận tín hiệu ${signal}.`));

    forceShutdownTimer = scheduleTimeout(() => {
      console.error({
        event: "bot_forced_shutdown",
        reason: "grace_period_exceeded",
      });
      process.exit(1);
    }, FORCE_SHUTDOWN_TIMEOUT_MS);
    forceShutdownTimer.unref();

    if (runner?.isRunning()) {
      shutdownPromise = runner.stop();
    }
  };
  const stopOnSigint = () => requestStop("SIGINT");
  const stopOnSigterm = () => requestStop("SIGTERM");

  process.once("SIGINT", stopOnSigint);
  process.once("SIGTERM", stopOnSigterm);

  try {
    const startupSignal = AbortSignal.any([
      startupController.signal,
      AbortSignal.timeout(STARTUP_TIMEOUT_MS),
    ]);
    const botInfo = await initializeTelegramBot(bot, startupSignal);

    if (!shutdownRequested) {
      console.info({
        event: "bot_starting",
        username: botInfo.username,
        allowedChatCount: config.allowedChatIds.size,
        allowAllChats: config.allowAllChats,
        bootstrapOnly: config.bootstrapOnly,
        chineseTargetLanguage: config.chineseTargetLanguage,
        maxConcurrentTranslations: config.maxConcurrentTranslations,
        runnerCapacity: RUNNER_CAPACITY,
      });

      runner = run(bot, {
        runner: {
          fetch: { allowed_updates: ["message"] },
          maxRetryTime: 300_000,
          retryInterval: "quadratic",
          silent: true,
        },
        sink: { concurrency: RUNNER_CAPACITY },
      });

      await runner.task();
      if (shutdownPromise) {
        await shutdownPromise;
      } else {
        throw new Error("Telegram runner đã dừng ngoài quy trình shutdown.");
      }
    }
  } catch (error) {
    if (!shutdownRequested || runner) {
      operationError = error;
    }
  } finally {
    process.removeListener("SIGINT", stopOnSigint);
    process.removeListener("SIGTERM", stopOnSigterm);

    try {
      await drainRunnerAndCloseTranslator(runner, translator);
    } catch (error) {
      cleanupError = error;
    } finally {
      if (forceShutdownTimer) {
        cancelTimeout(forceShutdownTimer);
      }
    }
  }

  if (operationError && cleanupError) {
    console.error({
      event: "bot_cleanup_failed",
      error: toSafeError(cleanupError, [config.telegramToken]),
    });
  }

  if (operationError) {
    throw operationError;
  }

  if (cleanupError) {
    throw cleanupError;
  }
}

main().catch((error) => {
  console.error({
    event: "bot_fatal_error",
    error: toSafeError(error, [process.env.TELEGRAM_BOT_TOKEN]),
  });
  process.exitCode = 1;
});
