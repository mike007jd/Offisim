/**
 * Browser polyfill for node:async_hooks AsyncLocalStorage.
 *
 * LangChain/LangGraph use AsyncLocalStorage for context propagation.
 * In the browser, we provide a synchronous fallback that uses a simple stack.
 * This works because browser JS is single-threaded — no concurrent async
 * contexts can interleave within the same microtask.
 */
export class AsyncLocalStorage<T> {
  private store: T | undefined;

  getStore(): T | undefined {
    return this.store;
  }

  run<R>(store: T, callback: () => R): R {
    const prev = this.store;
    this.store = store;
    try {
      return callback();
    } finally {
      this.store = prev;
    }
  }

  enterWith(store: T): void {
    this.store = store;
  }

  disable(): void {
    this.store = undefined;
  }
}

export default { AsyncLocalStorage };
