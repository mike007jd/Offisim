import React, { Suspense } from 'react';

import type {
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
// Placeholder workspace page components (lazy-loaded)
// ---------------------------------------------------------------------------

const SopWorkspacePage = React.lazy(
  () => import('./placeholders/SopWorkspacePage'),
);

const MarketWorkspacePage = React.lazy(
  () => import('./placeholders/MarketWorkspacePage'),
);

const ActivityLogPage = React.lazy(
  () => import('./placeholders/ActivityLogPage'),
);

const SettingsPage = React.lazy(
  () => import('./placeholders/SettingsPage'),
);

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
export function WorkspaceRouter({
  activeWorkspace,
  sessionState,
  onSessionStateChange,
  settingsPageProps,
  children,
}: WorkspaceRouterProps) {
  // For now we treat the transition state as idle — animation support will
  // be wired in a later phase when transition orchestration is added.
  const transitionState: TransitionState = 'idle';

  const mountOffice = shouldMountOfficeScene(activeWorkspace, transitionState);
  const officeInteractive = isOfficeSceneInteractive(activeWorkspace, transitionState);

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
          <SopWorkspacePage
            sessionState={sessionState.sops}
            onSessionStateChange={(s) =>
              onSessionStateChange({ ...sessionState, sops: s })
            }
          />
        )}

        {activeWorkspace === 'market' && (
          <MarketWorkspacePage
            sessionState={sessionState.market}
            onSessionStateChange={(s) =>
              onSessionStateChange({ ...sessionState, market: s })
            }
          />
        )}

        {activeWorkspace === 'activity-log' && (
          <ActivityLogPage
            sessionState={sessionState.activityLog}
            onSessionStateChange={(s) =>
              onSessionStateChange({ ...sessionState, activityLog: s })
            }
          />
        )}

        {activeWorkspace === 'settings' && (
          <SettingsPage
            sessionState={sessionState.settings}
            onSessionStateChange={(s) =>
              onSessionStateChange({ ...sessionState, settings: s })
            }
            onBack={settingsPageProps?.onBack ?? (() => {})}
            onSave={settingsPageProps?.onSave ?? (() => {})}
            onSaveSuccess={settingsPageProps?.onSaveSuccess}
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
