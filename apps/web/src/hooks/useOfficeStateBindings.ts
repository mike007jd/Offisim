import { useCallback, useState } from 'react';
import type { OfficeSessionState, UpdateWorkspaceStateFn } from '../components/workspaces/types';
import { markAccount, markCompany } from '../lib/onboarding-store';

export interface OfficeStateBindingsDeps {
  activeCompanyId: string | null;
  updateWorkspaceState: UpdateWorkspaceStateFn;
}

export interface OfficeStateBindingsApi {
  lastUserRequest: string | null;
  chatOpenToken: number;
  focusOutputsToken: number;
  viewModeNonce: number;
  bumpChatOpenToken: () => void;
  bumpFocusOutputsToken: () => void;
  updateOfficeState: (updater: (prev: OfficeSessionState) => OfficeSessionState) => void;
  onViewModeChange: (mode: '2D' | '3D') => void;
  /** Bumps `viewModeNonce` on every explicit toggle click — value-agnostic retry signal. */
  onViewModeClick: () => void;
  onSceneFallbackTo2D: () => void;
  handleToggleDashboard: () => void;
  handleToggleKanban: () => void;
  onLayoutMetricsChange: (metrics: { leftPanelWidth: number; rightPanelWidth: number }) => void;
  handleSelectEmployee: (id: string | null) => void;
  handleUserMessage: (text: string) => void;
}

export function useOfficeStateBindings(deps: OfficeStateBindingsDeps): OfficeStateBindingsApi {
  const { activeCompanyId, updateWorkspaceState } = deps;

  const [lastUserRequest, setLastUserRequest] = useState<string | null>(null);
  const [chatOpenToken, setChatOpenToken] = useState(0);
  const [focusOutputsToken, setFocusOutputsToken] = useState(0);
  const [viewModeNonce, setViewModeNonce] = useState(0);

  const bumpChatOpenToken = useCallback(() => setChatOpenToken((t) => t + 1), []);
  const bumpFocusOutputsToken = useCallback(() => setFocusOutputsToken((t) => t + 1), []);
  const onViewModeClick = useCallback(() => setViewModeNonce((n) => n + 1), []);

  const updateOfficeState = useCallback(
    (updater: (prev: OfficeSessionState) => OfficeSessionState) => {
      updateWorkspaceState('office', updater);
    },
    [updateWorkspaceState],
  );

  const onViewModeChange = useCallback(
    (mode: '2D' | '3D') => updateWorkspaceState('office', (prev) => ({ ...prev, viewMode: mode })),
    [updateWorkspaceState],
  );

  const onSceneFallbackTo2D = useCallback(
    () => updateWorkspaceState('office', (prev) => ({ ...prev, viewMode: '2D' })),
    [updateWorkspaceState],
  );

  const handleToggleDashboard = useCallback(
    () =>
      updateWorkspaceState('office', (prev) => {
        const next = !prev.dashboardOpen;
        return { ...prev, dashboardOpen: next, kanbanOpen: next ? false : prev.kanbanOpen };
      }),
    [updateWorkspaceState],
  );

  const handleToggleKanban = useCallback(
    () =>
      updateWorkspaceState('office', (prev) => {
        const next = !prev.kanbanOpen;
        return { ...prev, kanbanOpen: next, dashboardOpen: next ? false : prev.dashboardOpen };
      }),
    [updateWorkspaceState],
  );

  const onLayoutMetricsChange = useCallback(
    (metrics: { leftPanelWidth: number; rightPanelWidth: number }) => {
      updateOfficeState((prev) => {
        if (
          prev.leftPanelWidth === metrics.leftPanelWidth &&
          prev.rightPanelWidth === metrics.rightPanelWidth
        ) {
          return prev;
        }
        return {
          ...prev,
          leftPanelWidth: metrics.leftPanelWidth,
          rightPanelWidth: metrics.rightPanelWidth,
        };
      });
    },
    [updateOfficeState],
  );

  const handleSelectEmployee = useCallback(
    (id: string | null) => {
      updateWorkspaceState('office', (prev) => ({ ...prev, selectedEmployeeId: id }));
      if (id) {
        markAccount('first_employee_clicked');
      }
    },
    [updateWorkspaceState],
  );

  const handleUserMessage = useCallback(
    (text: string) => {
      setLastUserRequest(text);
      if (activeCompanyId) {
        markCompany(activeCompanyId, 'first_task_sent');
      }
    },
    [activeCompanyId],
  );

  return {
    lastUserRequest,
    chatOpenToken,
    focusOutputsToken,
    viewModeNonce,
    bumpChatOpenToken,
    bumpFocusOutputsToken,
    updateOfficeState,
    onViewModeChange,
    onViewModeClick,
    onSceneFallbackTo2D,
    handleToggleDashboard,
    handleToggleKanban,
    onLayoutMetricsChange,
    handleSelectEmployee,
    handleUserMessage,
  };
}
