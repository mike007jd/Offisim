import { useEffect, useRef } from 'react';

import type { WorkspaceKey } from './types';
import type { BackNavigationOutcome } from './useWorkspaceSessionState';

export function handleWorkspacePopState(
  goBack: () => BackNavigationOutcome,
  restoreHistoryEntry: () => void,
): void {
  if (goBack() === 'internal') {
    restoreHistoryEntry();
  }
}

/**
 * Bridges workspace back-navigation to the browser history API.
 *
 * On mount, pushes an initial history entry so that the browser "back" button
 * fires a `popstate` event instead of leaving the app. When `popstate` fires,
 * calls `goBack()` which handles internal drill-in unwinding and workspace
 * switching internally.
 *
 * Uses a ref for the callback to avoid stale closures without re-registering
 * the listener on every render.
 */
export function useWorkspaceBackNavigation(
  activeWorkspace: WorkspaceKey,
  goBack: () => BackNavigationOutcome,
): void {
  const goBackRef = useRef(goBack);

  useEffect(() => {
    goBackRef.current = goBack;
  }, [goBack]);

  // Push initial history entry & listen for popstate
  useEffect(() => {
    window.history.pushState({ workspace: activeWorkspace }, '');

    const handlePopState = () => {
      handleWorkspacePopState(goBackRef.current, () => {
        window.history.pushState({ workspace: activeWorkspace }, '');
      });
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [activeWorkspace]);
}
