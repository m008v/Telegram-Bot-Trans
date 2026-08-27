import { TranslationCapacityError } from "./errors.js";

export class AsyncSemaphore {
  constructor(limit, { maxPending = limit * 2 } = {}) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError("Semaphore limit phải là số nguyên dương.");
    }

    if (!Number.isInteger(maxPending) || maxPending < 0) {
      throw new RangeError("Semaphore maxPending phải là số nguyên không âm.");
    }

    this.limit = limit;
    this.maxPending = maxPending;
    this.activeCount = 0;
    this.waiters = [];
  }

  async run(task) {
    await this.acquire();

    try {
      return await task();
    } finally {
      this.release();
    }
  }

  acquire() {
    if (this.activeCount < this.limit) {
      this.activeCount += 1;
      return Promise.resolve();
    }

    if (this.waiters.length >= this.maxPending) {
      return Promise.reject(new TranslationCapacityError());
    }

    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release() {
    const next = this.waiters.shift();

    if (next) {
      next();
      return;
    }

    this.activeCount -= 1;
  }

  get pendingCount() {
    return this.waiters.length;
  }
}
