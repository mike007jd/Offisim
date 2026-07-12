/**
 * `useEnhance` (PR-06) — the state machine the shared review UI drives.
 *
 * Owns the enhance lifecycle so every entry point (Office now; Connect/Loops
 * later) gets identical behavior: idle → loading (cancelable) → ready/error, with
 * Regenerate and a single post-Apply Undo. Pure React + the injected transport;
 * no surface-specific logic lives here.
 */

import { useCallback, useRef, useState } from 'react';
import type { PromptEnhanceRequest, PromptEnhanceResult } from './contract.js';
import { EnhanceCancelledError, type EnhanceTransport, runEnhance } from './service.js';

type EnhancePhase = 'idle' | 'loading' | 'ready' | 'error';

export interface EnhanceState {
  phase: EnhancePhase;
  result: PromptEnhanceResult | null;
  /** Human-readable error for the error/rate-limit state. */
  error: string | null;
}

const IDLE: EnhanceState = { phase: 'idle', result: null, error: null };

/** Map a thrown transport error to a short, user-facing message — including the
 *  rate-limit case the UI surfaces distinctly. */
function describeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/rate.?limit|429|too many requests/i.test(raw)) {
    return 'Rate limited — wait a moment and try Enhance again.';
  }
  if (/not logged in|no available model|no api key/i.test(raw)) {
    return 'Agent runtime has no available model. Sign in, then retry.';
  }
  return raw || 'Enhance failed. Try again.';
}

export interface UseEnhanceResult {
  state: EnhanceState;
  /** Start an enhance for `request`. No-op if one is already running. */
  start: (request: PromptEnhanceRequest) => void;
  /** Re-run the last request, optionally with a `feedback` steer. */
  regenerate: (feedback?: string) => void;
  /** Cancel an in-flight enhance (returns to idle). */
  cancel: () => void;
  /** Clear everything back to idle (e.g. on dialog close / Keep original). */
  reset: () => void;
}

export function useEnhance(transport: EnhanceTransport): UseEnhanceResult {
  const [state, setState] = useState<EnhanceState>(IDLE);
  const abortRef = useRef<AbortController | null>(null);
  const lastRequestRef = useRef<PromptEnhanceRequest | null>(null);

  const run = useCallback(
    (request: PromptEnhanceRequest) => {
      // One enhance at a time: abort any in-flight before starting.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      lastRequestRef.current = request;
      setState({ phase: 'loading', result: null, error: null });
      runEnhance(request, transport, controller.signal).then(
        (result) => {
          if (controller.signal.aborted) return;
          setState({ phase: 'ready', result, error: null });
        },
        (err) => {
          if (controller.signal.aborted || err instanceof EnhanceCancelledError) return;
          setState({ phase: 'error', result: null, error: describeError(err) });
        },
      );
    },
    [transport],
  );

  const start = useCallback(
    (request: PromptEnhanceRequest) => {
      if (state.phase === 'loading') return;
      run(request);
    },
    [run, state.phase],
  );

  const regenerate = useCallback(
    (feedback?: string) => {
      const last = lastRequestRef.current;
      if (!last) return;
      run({ ...last, ...(feedback?.trim() ? { feedback: feedback.trim() } : {}) });
    },
    [run],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(IDLE);
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    lastRequestRef.current = null;
    setState(IDLE);
  }, []);

  return { state, start, regenerate, cancel, reset };
}
