// React surface for the collaboration turn controller (PR-03), consumed by the
// Connect UI (PR-05). The controller is an external store (live AI-reply turns
// streaming in); `useSyncExternalStore` is the right primitive — there are no
// TanStack Query keys for the live stream. Persisted thread/message reads stay on
// the CollaborationService + existing query layer; this hook is ONLY the live
// turn snapshot.

import { useSyncExternalStore } from 'react';
import {
  type CollaborationThreadSnapshot,
  type CollaborationTurnController,
  emptyCollaborationSnapshot,
} from './collaboration-turn-controller.js';

/**
 * Subscribe to the live collaboration turns for a thread (streaming bodies,
 * phases, the most-recent round). Returns an empty snapshot until the controller
 * is resolved / the thread has activity.
 */
export function useCollaborationTurns(
  controller: CollaborationTurnController | null,
  threadId: string | null,
): CollaborationThreadSnapshot {
  return useSyncExternalStore(
    (listener) => {
      if (!controller || !threadId) return () => undefined;
      return controller.subscribe(threadId, listener);
    },
    () =>
      controller && threadId
        ? controller.getSnapshot(threadId)
        : emptyCollaborationSnapshot(threadId ?? ''),
    () =>
      controller && threadId
        ? controller.getSnapshot(threadId)
        : emptyCollaborationSnapshot(threadId ?? ''),
  );
}
