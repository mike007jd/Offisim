// Shared abort/cancellation detection used by the agent + tool-execution nodes
// (manager / employee / engine-executor / mcp). Kept in one place so every node
// agrees on what counts as a cancellation and swallows/propagates it
// consistently — a drifted copy (e.g. one that forgot `cancelled`) silently
// mis-handles cancelled runs.

import { toErrorMessage } from '../errors.js';

/**
 * True when `error` represents a cancelled/aborted operation: the signal is
 * already aborted, the error is an AbortError (DOMException or Error), or its
 * message names an abort/cancellation.
 */
export function isAbortLikeError(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return true;
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  return /\babort(?:ed)?|cancelled\b/i.test(toErrorMessage(error));
}
