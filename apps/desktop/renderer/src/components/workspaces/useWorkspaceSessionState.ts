import { useCallback, useMemo, useState } from 'react';

import { type ParsedUrl, mergeSessionPatch } from '../../lib/url-routing';
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
}

export type BackNavigationOutcome = 'internal' | 'workspace' | 'none';

interface BackNavigationResolution {
  outcome: BackNavigationOutcome;
  activeWorkspace: WorkspaceKey;
  sessionState: WorkspaceSessionState;
}

export interface UseWorkspaceSessionStateOptions {
  initial?: {
    activeWorkspace?: WorkspaceKey;
    sessionPatch?: ParsedUrl['sessionPatch'];
  };
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

    case 'personnel': {
      const p = sessionState.personnel;
      if (p.activeEmployeeTab !== 'profile') {
        return [true, { ...sessionState, personnel: { ...p, activeEmployeeTab: 'profile' } }];
      }
      if (p.selectedEmployeeId !== null) {
        return [true, { ...sessionState, personnel: { ...p, selectedEmployeeId: null } }];
      }
      return [false, sessionState];
    }

    // Workspace suite: Approvals resolved-detail → list → (switch workspace).
    // Messenger selection is clamped to the Office `selectedThreadId` SSOT, so it
    // has no suite-local drill state to unwind here.
    case 'workspace': {
      const w = sessionState.workspace;
      if (w.activeApp === 'approvals' && w.approvalsSelectedHistoryId !== null) {
        return [true, { ...sessionState, workspace: { ...w, approvalsSelectedHistoryId: null } }];
      }
      return [false, sessionState];
    }
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
): BackNavigationResolution {
  const [consumed, nextSessionState] = tryWorkspaceInternalBack(activeWorkspace, sessionState);

  if (consumed) {
    return {
      outcome: 'internal',
      activeWorkspace,
      sessionState: nextSessionState,
    };
  }

  return {
    outcome: typeof window !== 'undefined' && window.history.length > 1 ? 'workspace' : 'none',
    activeWorkspace,
    sessionState,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWorkspaceSessionState(options: UseWorkspaceSessionStateOptions = {}) {
  const [internal, setInternal] = useState<InternalState>(() => ({
    activeWorkspace: options.initial?.activeWorkspace ?? 'office',
    sessionState: mergeSessionPatch(createDefaultSessionState(), options.initial?.sessionPatch),
  }));

  // ── setActiveWorkspace ──────────────────────────────────────────────
  const setActiveWorkspace = useCallback((targetKey: WorkspaceKey) => {
    setInternal((prev) => {
      if (prev.activeWorkspace === targetKey) return prev; // no-op

      let nextSessionState = prev.sessionState;

      if (prev.activeWorkspace === 'office') {
        const o = nextSessionState.office;
        if (o.studioMode !== null || o.kanbanOpen || o.marketplaceListingId !== null) {
          nextSessionState = {
            ...nextSessionState,
            office: {
              ...o,
              studioMode: null,
              kanbanOpen: false,
              marketplaceListingId: null,
            },
          };
        }
      }

      return {
        activeWorkspace: targetKey,
        sessionState: nextSessionState,
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
      (typeof window !== 'undefined' && window.history.length > 1),
    [internal.activeWorkspace, internal.sessionState],
  );

  // ── goBack ──────────────────────────────────────────────────────────
  const goBack = useCallback((): BackNavigationOutcome => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
      return 'workspace';
    }
    return 'none';
  }, []);

  // Merge URL-derived patch on top of current in-memory state so Back/Forward
  // navigation preserves caller-only prefs (panel widths, scroll offsets, etc.)
  // that the URL grammar does not encode.
  const applyParsedUrl = useCallback((parsed: ParsedUrl) => {
    setInternal((prev) => ({
      activeWorkspace: parsed.workspace,
      sessionState: mergeSessionPatch(prev.sessionState, parsed.sessionPatch),
    }));
  }, []);

  return {
    state: internal.sessionState,
    activeWorkspace: internal.activeWorkspace,
    setActiveWorkspace,
    updateWorkspaceState,
    applyParsedUrl,
    canGoBack,
    goBack,
  };
}
