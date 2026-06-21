/**
 * Browser polyfill for node:async_hooks AsyncLocalStorage.
 *
 * Bundled node-only deps reached through `@offisim/core/browser` reference
 * AsyncLocalStorage for context propagation; the webview has no node:async_hooks
 * implementation. We provide a synchronous fallback over a single value. This
 * works because browser JS is single-threaded — no concurrent async contexts
 * can interleave within the same microtask.
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
