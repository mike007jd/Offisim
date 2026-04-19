import React, { Suspense, useCallback } from 'react';

import type {
  ActivityLogSessionState,
  MarketSessionState,
  SettingsSessionState,
  SopSessionState,
  WorkspaceKey,
  WorkspaceRouterProps,
} from './types';

// ---------------------------------------------------------------------------
// Transition state type (used by mount/interactive policy functions)
// ---------------------------------------------------------------------------

export type TransitionState = 'idle' | 'animating-out' | 'animating-in';

// ---------------------------------------------------------------------------
// Office Scene Mount & Interactive Policy
// ---------------------------------------------------------------------------

/**
 * Determines whether the Office scene should be mounted in the DOM.
 *
 * Returns `true` when:
 * - The active workspace is 'office'
 * - A transition animation is playing out FROM office (animating-out)
 *
 * In all other cases the scene should be unmounted to free GPU/memory.
 */
export function shouldMountOfficeScene(
  activeWorkspace: WorkspaceKey,
  transitionState: TransitionState,
): boolean {
  if (activeWorkspace === 'office') return true;
  if (transitionState === 'animating-out') return true;
  return false;
}

/**
 * Determines whether the Office scene should accept pointer events.
 *
 * Returns `true` only when the active workspace is 'office' AND no
 * transition animation is in progress (idle).
 */
export function isOfficeSceneInteractive(
  activeWorkspace: WorkspaceKey,
  transitionState: TransitionState,
): boolean {
  return activeWorkspace === 'office' && transitionState === 'idle';
}

// ---------------------------------------------------------------------------
// Lazy-loaded workspace page wrappers (default-export shims for React.lazy)
// ---------------------------------------------------------------------------

const SopViewSurface = React.lazy(() =>
  import('@offisim/ui-office/sop-view').then((m) => ({ default: m.SopViewSurface })),
);

const MarketWorkspacePage = React.lazy(() => import('./lazy-wrappers/MarketWorkspacePage'));

const ActivityLogPage = React.lazy(() => import('./lazy-wrappers/ActivityLogPage'));

const SettingsPage = React.lazy(() => import('./lazy-wrappers/SettingsPage'));

// ---------------------------------------------------------------------------
// WorkspaceRouter
// ---------------------------------------------------------------------------

/**
 * Renders exactly one workspace in the center surface at any time.
 *
 * - When `activeWorkspace` is `'office'`, renders `children` (the Office
 *   scene slot) with full interactivity.
 * - For other workspaces, renders the corresponding workspace page component.
 * - Enforces the Office scene mount/freeze policy: unmounted when not active,
 *   kept mounted only during exit animation with pointer-events disabled.
 */
const NOOP = () => {};

export function WorkspaceRouter({
  activeWorkspace,
  sessionState,
  updateWorkspaceState,
  marketPageProps,
  settingsPageProps,
  children,
}: WorkspaceRouterProps) {
  // For now we treat the transition state as idle — animation support will
  // be wired in a later phase when transition orchestration is added.
  const transitionState: TransitionState = 'idle';

  const mountOffice = shouldMountOfficeScene(activeWorkspace, transitionState);
  const officeInteractive = isOfficeSceneInteractive(activeWorkspace, transitionState);

  // Stable handlers: updateWorkspaceState has empty deps → these never recreate.
  const handleSopsChange = useCallback(
    (updater: (prev: SopSessionState) => SopSessionState) => updateWorkspaceState('sops', updater),
    [updateWorkspaceState],
  );
  const handleMarketChange = useCallback(
    (updater: (prev: MarketSessionState) => MarketSessionState) =>
      updateWorkspaceState('market', updater),
    [updateWorkspaceState],
  );
  const handleActivityLogChange = useCallback(
    (updater: (prev: ActivityLogSessionState) => ActivityLogSessionState) =>
      updateWorkspaceState('activity-log', updater),
    [updateWorkspaceState],
  );
  const handleSettingsChange = useCallback(
    (updater: (prev: SettingsSessionState) => SettingsSessionState) =>
      updateWorkspaceState('settings', updater),
    [updateWorkspaceState],
  );

  return (
    <>
      {/* Office scene: conditionally mounted, frozen when not active */}
      {mountOffice && (
        <div
          style={{ pointerEvents: officeInteractive ? 'auto' : 'none' }}
          aria-hidden={!officeInteractive}
          data-workspace="office"
        >
          {children}
        </div>
      )}

      {/* Non-office workspaces: mutually exclusive */}
      <Suspense fallback={<WorkspaceLoadingFallback />}>
        {activeWorkspace === 'sops' && (
          <SopViewSurface
            sessionState={sessionState.sops}
            onSessionStateChange={handleSopsChange}
          />
        )}

        {activeWorkspace === 'market' && (
          <MarketWorkspacePage
            sessionState={sessionState.market}
            onSessionStateChange={handleMarketChange}
            onStartInstall={marketPageProps?.onStartInstall}
          />
        )}

        {activeWorkspace === 'activity-log' && (
          <ActivityLogPage
            sessionState={sessionState.activityLog}
            onSessionStateChange={handleActivityLogChange}
          />
        )}

        {activeWorkspace === 'settings' && (
          <SettingsPage
            sessionState={sessionState.settings}
            onSessionStateChange={handleSettingsChange}
            onBack={settingsPageProps?.onBack ?? NOOP}
            onSave={settingsPageProps?.onSave ?? NOOP}
            onSaveSuccess={settingsPageProps?.onSaveSuccess}
            onToast={settingsPageProps?.onToast}
          />
        )}
      </Suspense>
    </>
  );
}

// ---------------------------------------------------------------------------
// Loading fallback
// ---------------------------------------------------------------------------

function WorkspaceLoadingFallback() {
  return (
    <div data-testid="workspace-loading" style={{ padding: 24 }}>
      Loading workspace…
    </div>
  );
}
