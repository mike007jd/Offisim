export class MemoryUpdateQueueService {
  private readonly chains = new Map<string, Promise<void>>();

  async enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve();
    let result: T | undefined;

    const next = previous
      .catch(() => undefined)
      .then(async () => {
        result = await operation();
      });

    this.chains.set(key, next);

    try {
      await next;
      return result as T;
    } finally {
      if (this.chains.get(key) === next) {
        this.chains.delete(key);
      }
    }
  }
}
