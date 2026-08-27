export class PerKeySerialQueue {
  constructor() {
    this.tails = new Map();
  }

  run(key, task) {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    let tracked;

    tracked = current.finally(() => {
      if (this.tails.get(key) === tracked) {
        this.tails.delete(key);
      }
    });

    this.tails.set(key, tracked);
    return tracked;
  }

  get size() {
    return this.tails.size;
  }
}
