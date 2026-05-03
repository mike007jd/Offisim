import type { RunnableConfig } from '@langchain/core/runnables';
import { GraphError } from '../errors.js';
import type { RunScope } from '../graph/state.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';

/**
 * Extract RuntimeContext from LangGraph config.configurable.
 *
 * Two modes:
 * - **required** (default): throws GraphError if missing — use in nodes
 *   that cannot function without runtime (boss, manager, employee, etc.)
 * - **optional**: returns undefined if missing — use in best-effort nodes
 *   (error_handler, boss_summary, heartbeat, etc.)
 */
export function getRuntime(config: RunnableConfig, nodeName: string): RuntimeContext;
export function getRuntime(
  config: RunnableConfig,
  nodeName: string,
  opts: { optional: true },
): RuntimeContext | undefined;
export function getRuntime(
  config: RunnableConfig,
  nodeName: string,
  opts?: { optional: boolean },
): RuntimeContext | undefined {
  const runtimeCtx = (config.configurable as { runtimeCtx?: RuntimeContext })?.runtimeCtx;
  if (!runtimeCtx && !opts?.optional) {
    throw new GraphError('RuntimeContext not found in config.configurable', nodeName);
  }
  return runtimeCtx;
}

/**
 * Extract per-execution chat run scope from LangGraph config.configurable.
 *
 * Returns null on absence — non-chat invocations (`background_sync`, `pm_heartbeat`)
 * legitimately have no scope, and chat-affecting emit sites should pass through
 * the absence so the UI listener drops the event.
 */
export function getRunScope(config: RunnableConfig): RunScope | null {
  const scope = (config.configurable as { runScope?: RunScope })?.runScope;
  return scope ?? null;
}
