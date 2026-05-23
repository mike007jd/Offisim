import { WorkspacePageSkeleton } from '@offisim/ui-core';
import { WorkspaceSuite, useSuiteEscape } from '@offisim/ui-office/web';
import React, { Suspense, useCallback } from 'react';

import { WorkspaceOfficeSceneHost } from './WorkspaceRouterSurfaces';
import type {
  ActivityLogSessionState,
  MarketSessionState,
  PersonnelSessionState,
  SettingsSessionState,
  SopSessionState,
  WorkspaceAppKey,
  WorkspaceKey,
  WorkspaceRouterProps,
  WorkspaceSuiteSessionState,
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

const PersonnelPage = React.lazy(() => import('./lazy-wrappers/PersonnelPage'));

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
  sopsPageProps,
  activityLogPageProps,
  settingsPageProps,
  personnelPageProps,
  workspaceSuiteProps,
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
  const handlePersonnelChange = useCallback(
    (updater: (prev: PersonnelSessionState) => PersonnelSessionState) =>
      updateWorkspaceState('personnel', updater),
    [updateWorkspaceState],
  );

  // Suite session-state writers. Selection of a thread is intentionally NOT here:
  // it is clamped to the Office `selectedThreadId` SSOT via
  // `workspaceSuiteProps.onSelectThread` (which writes through
  // `updateWorkspaceState('office', …)`).
  const handleSuiteAppChange = useCallback(
    (app: WorkspaceAppKey) =>
      updateWorkspaceState('workspace', (prev: WorkspaceSuiteSessionState) =>
        prev.activeApp === app ? prev : { ...prev, activeApp: app },
      ),
    [updateWorkspaceState],
  );
  const handleApprovalsFilterChange = useCallback(
    (filter: 'todo' | 'done') =>
      updateWorkspaceState('workspace', (prev: WorkspaceSuiteSessionState) =>
        prev.approvalsFilter === filter
          ? prev
          : { ...prev, approvalsFilter: filter, approvalsSelectedHistoryId: null },
      ),
    [updateWorkspaceState],
  );
  const handleApprovalsSelectHistory = useCallback(
    (historyId: string | null) =>
      updateWorkspaceState('workspace', (prev: WorkspaceSuiteSessionState) =>
        prev.approvalsSelectedHistoryId === historyId
          ? prev
          : { ...prev, approvalsSelectedHistoryId: historyId },
      ),
    [updateWorkspaceState],
  );

  useSuiteEscape({
    enabled: activeWorkspace === 'workspace',
    activeApp: sessionState.workspace.activeApp,
    approvalsSelectedHistoryId: sessionState.workspace.approvalsSelectedHistoryId,
    onApprovalsSelectHistory: handleApprovalsSelectHistory,
  });

  return (
    <>
      {/* Office scene: conditionally mounted, frozen when not active */}
      {mountOffice && (
        <WorkspaceOfficeSceneHost interactive={officeInteractive} data-workspace="office">
          {children}
        </WorkspaceOfficeSceneHost>
      )}

      {/* Non-office workspaces: mutually exclusive */}
      <Suspense fallback={<WorkspaceLoadingFallback />}>
        {activeWorkspace === 'sops' && (
          <SopViewSurface
            sessionState={sessionState.sops}
            onSessionStateChange={handleSopsChange}
            onOpenTemplates={sopsPageProps?.onOpenTemplates}
          />
        )}

        {activeWorkspace === 'market' && (
          <MarketWorkspacePage
            sessionState={sessionState.market}
            onSessionStateChange={handleMarketChange}
            onStartInstall={marketPageProps?.onStartInstall}
          />
        )}

        {activeWorkspace === 'personnel' && (
          <PersonnelPage
            sessionState={sessionState.personnel}
            onSessionStateChange={handlePersonnelChange}
            onOpenCreator={personnelPageProps?.onOpenCreator}
            onOpenMarket={personnelPageProps?.onOpenMarket}
          />
        )}

        {activeWorkspace === 'workspace' && (
          <WorkspaceSuite
            activeApp={sessionState.workspace.activeApp}
            onSelectApp={handleSuiteAppChange}
            activeCompanyId={workspaceSuiteProps?.activeCompanyId ?? null}
            activeProject={workspaceSuiteProps?.activeProject ?? null}
            activeThreadId={workspaceSuiteProps?.activeThreadId ?? null}
            selectedEmployeeId={workspaceSuiteProps?.selectedEmployeeId ?? null}
            onSelectThread={workspaceSuiteProps?.onSelectThread ?? NOOP}
            onSelectEmployee={(id) => workspaceSuiteProps?.onSelectDirectEmployee?.(id)}
            onOpenSettings={workspaceSuiteProps?.onOpenSettings ?? NOOP}
            onFocusEmployee={workspaceSuiteProps?.onFocusEmployee}
            onOpenActivityLog={workspaceSuiteProps?.onOpenActivityLog}
            approvalsFilter={sessionState.workspace.approvalsFilter}
            onApprovalsFilterChange={handleApprovalsFilterChange}
            approvalsSelectedHistoryId={sessionState.workspace.approvalsSelectedHistoryId}
            onApprovalsSelectHistory={handleApprovalsSelectHistory}
          />
        )}

        {activeWorkspace === 'activity-log' && (
          <ActivityLogPage
            sessionState={sessionState.activityLog}
            onSessionStateChange={handleActivityLogChange}
            onBackToOffice={activityLogPageProps?.onBackToOffice}
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
            onEditExternalEmployee={settingsPageProps?.onEditExternalEmployee}
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
  return <WorkspacePageSkeleton data-testid="workspace-loading" />;
}
