const ONE_MINUTE_MS = 60_000;

function createWindow(now) {
  return { startedAt: now, count: 0, rejectionNotified: false };
}

export class TranslationRateLimiter {
  constructor({
    perChatLimit,
    globalLimit,
    windowMs = ONE_MINUTE_MS,
    clock = Date.now,
    maxTrackedChats = 10_000,
  }) {
    this.perChatLimit = perChatLimit;
    this.globalLimit = globalLimit;
    this.windowMs = windowMs;
    this.clock = clock;
    this.maxTrackedChats = maxTrackedChats;
    this.globalWindow = null;
    this.chatWindows = new Map();
    this.attemptCount = 0;
  }

  tryAcquire(chatId) {
    const now = this.clock();
    this.attemptCount += 1;
    this.globalWindow = this.refreshWindow(this.globalWindow, now);

    const chatKey = String(chatId);
    const chatWindow = this.refreshWindow(this.chatWindows.get(chatKey), now);
    this.chatWindows.set(chatKey, chatWindow);
    this.cleanupExpiredChats(now);

    const globalBlocked = this.globalWindow.count >= this.globalLimit;
    const chatBlocked = chatWindow.count >= this.perChatLimit;

    if (globalBlocked || chatBlocked) {
      const retryTimes = [];
      if (globalBlocked) {
        retryTimes.push(this.globalWindow.startedAt + this.windowMs - now);
      }
      if (chatBlocked) {
        retryTimes.push(chatWindow.startedAt + this.windowMs - now);
      }

      const shouldNotify = !chatWindow.rejectionNotified;
      chatWindow.rejectionNotified = true;

      return {
        allowed: false,
        shouldNotify,
        retryAfterSeconds: Math.max(1, Math.ceil(Math.max(...retryTimes) / 1_000)),
      };
    }

    this.globalWindow.count += 1;
    chatWindow.count += 1;

    return { allowed: true, shouldNotify: false, retryAfterSeconds: 0 };
  }

  refreshWindow(window, now) {
    if (!window || now - window.startedAt >= this.windowMs) {
      return createWindow(now);
    }

    return window;
  }

  cleanupExpiredChats(now) {
    if (this.attemptCount % 100 !== 0 && this.chatWindows.size <= this.maxTrackedChats) {
      return;
    }

    for (const [chatId, window] of this.chatWindows) {
      if (now - window.startedAt >= this.windowMs) {
        this.chatWindows.delete(chatId);
      }
    }

    while (this.chatWindows.size > this.maxTrackedChats) {
      const oldestChatId = this.chatWindows.keys().next().value;
      this.chatWindows.delete(oldestChatId);
    }
  }
}
