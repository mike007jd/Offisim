import type { LlmResponse } from '../llm/gateway.js';
import { Logger } from '../services/logger.js';
import type { LlmCallContext, LlmMiddleware } from './types.js';

const logger = new Logger('middleware');

/**
 * Ordered middleware chain for LLM calls.
 *
 * Middleware runs in priority order for `before` hooks (low → high)
 * and reverse priority order for `after` hooks (high → low),
 * forming an onion / Russian-doll pattern.
 *
 * Errors in individual middleware are caught and logged but do NOT
 * abort the LLM call — the pipeline is resilient by design.
 */
export class LlmMiddlewareChain {
  private readonly middlewares: LlmMiddleware[] = [];

  /** Register a middleware. Duplicates (same name) are silently ignored. */
  register(mw: LlmMiddleware): void {
    if (this.middlewares.some((m) => m.name === mw.name)) return;
    this.middlewares.push(mw);
    // Keep sorted by priority ascending
    this.middlewares.sort((a, b) => a.priority - b.priority);
  }

  /** Remove a middleware by name. */
  unregister(name: string): void {
    const idx = this.middlewares.findIndex((m) => m.name === name);
    if (idx >= 0) this.middlewares.splice(idx, 1);
  }

  /** Number of registered middleware. */
  get size(): number {
    return this.middlewares.length;
  }

  /**
   * Run all `before` hooks in priority order (low → high).
   * Each middleware receives the context returned by the previous one.
   */
  async runBefore(ctx: LlmCallContext): Promise<LlmCallContext> {
    let current = ctx;
    for (const mw of this.middlewares) {
      if (!mw.before) continue;
      try {
        current = await mw.before(current);
      } catch (err) {
        logger.error(`Middleware "${mw.name}" before() failed — skipping`, err);
      }
    }
    return current;
  }

  /**
   * Run all `after` hooks in reverse priority order (high → low).
   * Each middleware receives the response returned by the previous one.
   */
  async runAfter(ctx: LlmCallContext, response: LlmResponse): Promise<LlmResponse> {
    let current = response;
    // Reverse order for after hooks (onion model)
    for (let i = this.middlewares.length - 1; i >= 0; i--) {
      const mw = this.middlewares[i]!;
      if (!mw.after) continue;
      try {
        current = await mw.after(ctx, current);
      } catch (err) {
        logger.error(`Middleware "${mw.name}" after() failed — skipping`, err);
      }
    }
    return current;
  }
}
