import { useState, useCallback, useMemo } from 'react';

import type { WorkspaceKey, WorkspaceSessionState } from './types';
import { createDefaultSessionState } from './types';

// ---------------------------------------------------------------------------
// Key mapping: WorkspaceKey → WorkspaceSessionState property key
// ---------------------------------------------------------------------------

type SessionStateKeyMap = {
  office: 'office';
  sops: 'sops';
  market: 'market';
  'activity-log': 'activityLog';
  settings: 'settings';
};

export const SESSION_KEY: SessionStateKeyMap = {
  office: 'office',
  sops: 'sops',
  market: 'market',
  'activity-log': 'activityLog',
  settings: 'settings',
};

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
    // SOPs: run-focus → definition → empty → (switch workspace)
    case 'sops': {
      const sops = sessionState.sops;
      if (sops.centerMode === 'run-focus') {
        return [
          true,
          { ...sessionState, sops: { ...sops, centerMode: 'definition' } },
        ];
      }
      if (sops.centerMode === 'definition') {
        return [
          true,
          {
            ...sessionState,
            sops: { ...sops, selectedSopId: null, centerMode: 'empty' },
          },
        ];
      }
      return [false, sessionState];
    }

    // Market: explore-detail → explore-feed → (switch workspace)
    case 'market': {
      const market = sessionState.market;
      if (market.mode === 'explore' && market.selectedListingId !== null) {
        return [
          true,
          { ...sessionState, market: { ...market, selectedListingId: null } },
        ];
      }
      return [false, sessionState];
    }

    // Activity Log: event-focused → timeline state → (switch workspace)
    case 'activity-log': {
      const al = sessionState.activityLog;
      if (al.selectedEventId !== null) {
        return [
          true,
          { ...sessionState, activityLog: { ...al, selectedEventId: null } },
        ];
      }
      return [false, sessionState];
    }

    // Office: no internal drill-in
    case 'office':
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
  switch (key) {
    case 'sops':
      return sessionState.sops.centerMode !== 'empty';
    case 'market':
      return (
        sessionState.market.mode === 'explore' &&
        sessionState.market.selectedListingId !== null
      );
    case 'activity-log':
      return sessionState.activityLog.selectedEventId !== null;
    case 'office':
    case 'settings':
    default:
      return false;
  }
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

      // Close Studio when leaving Office
      if (
        prev.activeWorkspace === 'office' &&
        prev.sessionState.office.studioMode !== null
      ) {
        nextSessionState = {
          ...nextSessionState,
          office: { ...nextSessionState.office, studioMode: null },
        };
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
    <K extends WorkspaceKey>(
      key: K,
      updater: (prev: StateFor<K>) => StateFor<K>,
    ) => {
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

  const setSessionState = useCallback((sessionState: WorkspaceSessionState) => {
    setInternal((prev) => {
      if (prev.sessionState === sessionState) return prev;
      return { ...prev, sessionState };
    });
  }, []);

  // ── canGoBack ───────────────────────────────────────────────────────
  const canGoBack = useMemo(
    () =>
      hasInternalDrillIn(internal.activeWorkspace, internal.sessionState) ||
      internal.historyStack.length > 0,
    [internal.activeWorkspace, internal.sessionState, internal.historyStack],
  );

  // ── goBack ──────────────────────────────────────────────────────────
  const goBack = useCallback((): BackNavigationOutcome => {
    const resolution = resolveBackNavigation(
      internal.activeWorkspace,
      internal.sessionState,
      internal.historyStack,
    );

    if (resolution.outcome === 'none') {
      return 'none';
    }

    setInternal({
      activeWorkspace: resolution.activeWorkspace,
      sessionState: resolution.sessionState,
      historyStack: resolution.historyStack,
    });

    return resolution.outcome;
  }, [internal]);

  return {
    state: internal.sessionState,
    activeWorkspace: internal.activeWorkspace,
    setActiveWorkspace,
    updateWorkspaceState,
    setSessionState,
    canGoBack,
    goBack,
  };
}
