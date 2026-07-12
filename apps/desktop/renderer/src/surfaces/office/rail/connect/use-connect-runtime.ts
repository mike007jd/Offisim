// Company-channel runtime glue: the React seam between the Office rail and the
// PR-03 collaboration turn controller. The controller is resolved once per
// company and cached; the live turn snapshot for the active thread is subscribed
// via the PR-03 `useCollaborationTurns` store. Every send/ask/round/retry call
// goes through THIS controller — never `conversationRunController.submit` — and
// invalidates the Connect query keys after the turn settles so the persisted rows
// the controller upserted become visible.

import { useCollaborationTurns } from '@/runtime/collaboration/collaboration-react.js';
import { getCollaborationTurnController } from '@/runtime/collaboration/collaboration-runtime.js';
import type {
  CollaborationScheduleResult,
  CollaborationThreadSnapshot,
  CollaborationTurnController,
} from '@/runtime/collaboration/collaboration-turn-controller.js';
import type { CollaborationMessage } from '@offisim/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { invalidateConnectThread } from './collaboration-data.js';

export interface ConnectRuntime {
  /** The live turn snapshot for the active thread (streaming bodies + round). */
  snapshot: CollaborationThreadSnapshot;
  /** True while the controller is still resolving (or unavailable in preview). */
  ready: boolean;
  /** Send a boss message and schedule policy-driven replies. */
  send: (
    threadId: string,
    body: string,
  ) => Promise<{ message: CollaborationMessage; scheduled: CollaborationScheduleResult }>;
  /** Ask the team (group, no mention): first roster member or chosen responders. */
  askTeam: (
    threadId: string,
    triggerMessage: CollaborationMessage,
    responderEmployeeIds?: string[],
  ) => Promise<CollaborationScheduleResult>;
  /** Start a bounded roundtable round. */
  startRound: (
    threadId: string,
    triggerMessage: CollaborationMessage,
    opts?: { maxSpeakers?: number; mentionedFromBody?: string },
  ) => Promise<CollaborationScheduleResult>;
  /** Continue a roundtable as a NEW round. */
  continueRound: (
    threadId: string,
    triggerMessage: CollaborationMessage,
    opts?: { maxSpeakers?: number; mentionedFromBody?: string },
  ) => Promise<CollaborationScheduleResult>;
  /** Retry a failed/interrupted turn against the same trigger. */
  retry: (threadId: string, turnId: string, triggerMessage: CollaborationMessage) => Promise<void>;
  /** Stop a single in-flight turn. */
  stop: (turnId: string) => void;
  /** Stop every in-flight turn on a thread. */
  stopThread: (threadId: string) => void;
}

/**
 * Resolve (once per company) the PR-03 controller and expose the active thread's
 * live snapshot + the turn-driving actions. `companyId` keys the controller cache;
 * a company switch resolves a fresh controller (so a prior company's in-memory
 * turns never bleed across).
 */
export function useConnectRuntime(
  companyId: string | null,
  activeThreadId: string | null,
): ConnectRuntime {
  const queryClient = useQueryClient();
  const [controller, setController] = useState<CollaborationTurnController | null>(null);
  // Track the company the resolved controller belongs to so a stale async
  // resolution from a previous company can't overwrite the current one.
  const companyRef = useRef<string | null>(null);

  useEffect(() => {
    companyRef.current = companyId;
    if (!companyId) {
      setController(null);
      return;
    }
    let cancelled = false;
    setController(null);
    getCollaborationTurnController(companyId)
      .then((resolved) => {
        if (!cancelled && companyRef.current === companyId) setController(resolved);
      })
      .catch(() => {
        if (!cancelled && companyRef.current === companyId) setController(null);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const snapshot = useCollaborationTurns(controller, activeThreadId);

  function refresh(threadId: string): void {
    invalidateConnectThread(queryClient, companyId, threadId);
  }

  return {
    snapshot,
    ready: controller != null,
    send: async (threadId, body) => {
      if (!controller) throw new Error('Connect runtime is not ready.');
      const result = await controller.sendBossMessage(threadId, body);
      refresh(threadId);
      return result;
    },
    askTeam: async (threadId, triggerMessage, responderEmployeeIds) => {
      if (!controller) throw new Error('Connect runtime is not ready.');
      const result = await controller.askTeam(threadId, triggerMessage, responderEmployeeIds);
      refresh(threadId);
      return result;
    },
    startRound: async (threadId, triggerMessage, opts) => {
      if (!controller) throw new Error('Connect runtime is not ready.');
      const result = await controller.startRound(threadId, triggerMessage, opts);
      refresh(threadId);
      return result;
    },
    continueRound: async (threadId, triggerMessage, opts) => {
      if (!controller) throw new Error('Connect runtime is not ready.');
      const result = await controller.continueRound(threadId, triggerMessage, opts);
      refresh(threadId);
      return result;
    },
    retry: async (threadId, turnId, triggerMessage) => {
      if (!controller) throw new Error('Connect runtime is not ready.');
      await controller.retry(threadId, turnId, triggerMessage);
      refresh(threadId);
    },
    stop: (turnId) => controller?.stop(turnId),
    stopThread: (threadId) => controller?.stopThread(threadId),
  };
}
