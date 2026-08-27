import { setTimeout as wait } from "node:timers/promises";

export class RunnerDrainTimeoutError extends Error {
  constructor(pendingUpdates, timeoutMs) {
    super(`Hết ${timeoutMs} ms nhưng runner vẫn còn ${pendingUpdates} update đang xử lý.`);
    this.name = "RunnerDrainTimeoutError";
    this.code = "RUNNER_DRAIN_TIMEOUT";
    this.pendingUpdates = pendingUpdates;
  }
}

export async function waitForRunnerToDrain(
  runner,
  {
    timeoutMs = 120_000,
    pollIntervalMs = 100,
    clock = Date.now,
    delay = wait,
  } = {},
) {
  const deadline = clock() + timeoutMs;

  while (runner.size() > 0) {
    const remainingMs = deadline - clock();
    if (remainingMs <= 0) {
      throw new RunnerDrainTimeoutError(runner.size(), timeoutMs);
    }

    await delay(Math.min(pollIntervalMs, remainingMs));
  }
}

export async function drainRunnerAndCloseTranslator(runner, translator) {
  let runnerCleanupError;
  let translatorCloseError;

  try {
    if (runner?.isRunning()) {
      await runner.stop();
    }

    if (runner) {
      await waitForRunnerToDrain(runner);
    }
  } catch (error) {
    runnerCleanupError = error;
  }

  try {
    await translator.close();
  } catch (error) {
    translatorCloseError = error;
  }

  if (runnerCleanupError && translatorCloseError) {
    throw new AggregateError(
      [runnerCleanupError, translatorCloseError],
      "Dừng Telegram runner và đóng Google client đều thất bại.",
    );
  }

  if (runnerCleanupError) {
    throw runnerCleanupError;
  }

  if (translatorCloseError) {
    throw translatorCloseError;
  }
}
