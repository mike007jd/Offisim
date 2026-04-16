import { useCallback, useMemo, useRef, useState } from 'react';

import type { SessionStateKeyMap, WorkspaceKey, WorkspaceSessionState } from './types';
import { SESSION_KEY, createDefaultSessionState } from './types';

// ---------------------------------------------------------------------------
// Key mapping helpers (SessionStateKeyMap + SESSION_KEY live in types.ts)
// ---------------------------------------------------------------------------

type StateKeyFor<K extends WorkspaceKey> = SessionStateKeyMap[K];
type StateFor<K extends WorkspaceKey> = WorkspaceSessionState[StateKeyFor<K>];

// ---------------------------------------------------------------------------
// Combined internal state
// ---------------------------------------------------------------------------

interface InternalState {
  activeWorkspace: WorkspaceKey;
  sessionState: WorkspaceSessionState;
  historyStack: WorkspaceKey[];
}

export type BackNavigationOutcome = 'internal' | 'workspace' | 'none';

interface BackNavigationResolution {
  outcome: BackNavigationOutcome;
  activeWorkspace: WorkspaceKey;
  sessionState: WorkspaceSessionState;
  historyStack: WorkspaceKey[];
}

// ---------------------------------------------------------------------------
// Workspace-internal back navigation helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to unwind one level of internal drill-in for the given workspace.
 * Returns `[true, updatedSessionState]` if the back was consumed internally,
 * or `[false, sessionState]` if there is nothing to unwind.
 */
export function tryWorkspaceInternalBack(
  key: WorkspaceKey,
  sessionState: WorkspaceSessionState,
): [consumed: boolean, next: WorkspaceSessionState] {
  switch (key) {
    // SOPs: selected → deselect → (switch workspace)
    case 'sops': {
      const sops = sessionState.sops;
      if (sops.selectedSopId !== null) {
        return [true, { ...sessionState, sops: { ...sops, selectedSopId: null } }];
      }
      return [false, sessionState];
    }

    // Market: explore-detail → explore-feed → (switch workspace)
    case 'market': {
      const market = sessionState.market;
      if (market.mode === 'explore' && market.selectedListingId !== null) {
        return [true, { ...sessionState, market: { ...market, selectedListingId: null } }];
      }
      return [false, sessionState];
    }

    // Activity Log: event-focused → timeline state → (switch workspace)
    case 'activity-log': {
      const al = sessionState.activityLog;
      if (al.selectedEventId !== null) {
        return [true, { ...sessionState, activityLog: { ...al, selectedEventId: null } }];
      }
      return [false, sessionState];
    }

    case 'office': {
      const o = sessionState.office;
      if (o.dashboardOpen) {
        return [true, { ...sessionState, office: { ...o, dashboardOpen: false } }];
      }
      if (o.kanbanOpen) {
        return [true, { ...sessionState, office: { ...o, kanbanOpen: false } }];
      }
      if (o.marketplaceListingId) {
        return [true, { ...sessionState, office: { ...o, marketplaceListingId: null } }];
      }
      if (o.selectedEmployeeId) {
        return [true, { ...sessionState, office: { ...o, selectedEmployeeId: null } }];
      }
      return [false, sessionState];
    }

    case 'settings':
    default:
      return [false, sessionState];
  }
}

/**
 * Check whether a workspace has internal drill-in state that can be unwound.
 */
export function hasInternalDrillIn(
  key: WorkspaceKey,
  sessionState: WorkspaceSessionState,
): boolean {
  return tryWorkspaceInternalBack(key, sessionState)[0];
}

export function resolveBackNavigation(
  activeWorkspace: WorkspaceKey,
  sessionState: WorkspaceSessionState,
  historyStack: WorkspaceKey[],
): BackNavigationResolution {
  const [consumed, nextSessionState] = tryWorkspaceInternalBack(activeWorkspace, sessionState);

  if (consumed) {
    return {
      outcome: 'internal',
      activeWorkspace,
      sessionState: nextSessionState,
      historyStack,
    };
  }

  if (historyStack.length === 0) {
    return {
      outcome: 'none',
      activeWorkspace,
      sessionState,
      historyStack,
    };
  }

  const nextHistoryStack = historyStack.slice(0, -1);
  const previousWorkspace = historyStack[historyStack.length - 1]!;

  return {
    outcome: 'workspace',
    activeWorkspace: previousWorkspace,
    sessionState,
    historyStack: nextHistoryStack,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWorkspaceSessionState() {
  const [internal, setInternal] = useState<InternalState>(() => ({
    activeWorkspace: 'office',
    sessionState: createDefaultSessionState(),
    historyStack: [],
  }));

  // ── setActiveWorkspace ──────────────────────────────────────────────
  const setActiveWorkspace = useCallback((targetKey: WorkspaceKey) => {
    setInternal((prev) => {
      if (prev.activeWorkspace === targetKey) return prev; // no-op

      let nextSessionState = prev.sessionState;

      if (prev.activeWorkspace === 'office') {
        const o = nextSessionState.office;
        if (o.studioMode !== null || o.dashboardOpen || o.kanbanOpen || o.marketplaceListingId !== null) {
          nextSessionState = {
            ...nextSessionState,
            office: {
              ...o,
              studioMode: null,
              dashboardOpen: false,
              kanbanOpen: false,
              marketplaceListingId: null,
            },
          };
        }
      }

      return {
        activeWorkspace: targetKey,
        sessionState: nextSessionState,
        historyStack: [...prev.historyStack, prev.activeWorkspace],
      };
    });
  }, []);

  // ── updateWorkspaceState ────────────────────────────────────────────
  const updateWorkspaceState = useCallback(
    <K extends WorkspaceKey>(key: K, updater: (prev: StateFor<K>) => StateFor<K>) => {
      setInternal((prev) => {
        const propKey = SESSION_KEY[key] as StateKeyFor<K>;
        const current = prev.sessionState[propKey] as StateFor<K>;
        const next = updater(current);
        if (next === current) return prev;
        return {
          ...prev,
          sessionState: { ...prev.sessionState, [propKey]: next },
        };
      });
    },
    [],
  );

  // ── canGoBack ───────────────────────────────────────────────────────
  const canGoBack = useMemo(
    () =>
      hasInternalDrillIn(internal.activeWorkspace, internal.sessionState) ||
      internal.historyStack.length > 0,
    [internal.activeWorkspace, internal.sessionState, internal.historyStack],
  );

  // ── goBack ──────────────────────────────────────────────────────────
  // Uses a ref to read the latest outcome synchronously while keeping
  // the setState call functional (avoids stale-closure race).
  const outcomeRef = useRef<BackNavigationOutcome>('none');

  const goBack = useCallback((): BackNavigationOutcome => {
    setInternal((prev) => {
      const resolution = resolveBackNavigation(
        prev.activeWorkspace,
        prev.sessionState,
        prev.historyStack,
      );
      outcomeRef.current = resolution.outcome;
      if (resolution.outcome === 'none') return prev;
      return {
        activeWorkspace: resolution.activeWorkspace,
        sessionState: resolution.sessionState,
        historyStack: resolution.historyStack,
      };
    });
    return outcomeRef.current;
  }, []);

  return {
    state: internal.sessionState,
    activeWorkspace: internal.activeWorkspace,
    setActiveWorkspace,
    updateWorkspaceState,
    canGoBack,
    goBack,
  };
}
