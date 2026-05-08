import type { LlmRequest, LlmResponse } from '../llm/gateway.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';

/** Metadata about the caller of the LLM call. */
export interface LlmCallMeta {
  nodeName: string;
  provider: string;
  model: string;
  taskRunId?: string;
  projectId?: string | null;
  employeeId?: string | null;
}

/** Context object passed through the middleware chain. Middleware may mutate `request`. */
export interface LlmCallContext {
  request: LlmRequest;
  runtimeCtx: RuntimeContext;
  meta: LlmCallMeta;
  /** Middleware-private scratch space — avoids polluting the main interfaces. */
  extras: Record<string, unknown>;
}

/**
 * A single middleware in the LLM call pipeline.
 *
 * - `before`: runs before the LLM call. May modify `ctx.request` (e.g. inject system prompt sections).
 * - `after`: runs after a successful LLM call. May transform the response.
 *
 * Both hooks are optional — implement only what you need.
 */
export interface LlmMiddleware {
  /** Human-readable name for logging / debugging. */
  readonly name: string;

  /**
   * Execution priority — lower numbers run first in `before`, last in `after` (onion model).
   * Built-in middleware uses 0–99. User/plugin middleware should use 100+.
   */
  readonly priority: number;

  /** Pre-LLM hook. Return the (possibly modified) context. */
  before?(ctx: LlmCallContext): Promise<LlmCallContext>;

  /** Post-LLM hook. Return the (possibly modified) response. */
  after?(ctx: LlmCallContext, response: LlmResponse): Promise<LlmResponse>;
}
