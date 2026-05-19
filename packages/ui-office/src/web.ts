export { ErrorBoundary } from './components/ErrorBoundary.js';
export { AgentPanel } from './components/agents/AgentPanel.js';
export { EmployeeInspector } from './components/agents/EmployeeInspector.js';
export { ChatDrawer } from './components/chat/ChatDrawer.js';
export { ChatPanel } from './components/chat/ChatPanel.js';
export { getConversationKey } from './components/chat/chat-session-store.js';
export { CompanyProvider, useCompany } from './components/company/CompanyContext.js';
export { CompanySelectionPage } from './components/company/CompanySelectionPage.js';
export {
  PersonnelPage,
  type PersonnelSessionState,
  type PersonnelTabId,
} from './components/employees/PersonnelPage.js';
export { AppLayout } from './components/layout/AppLayout.js';
export { Header } from './components/layout/Header.js';
export { RightSidebar } from './components/layout/RightSidebar.js';
export { StatusBar } from './components/layout/StatusBar.js';
export { KanbanTray } from './components/kanban/KanbanTray.js';
export { NotificationCenter } from './components/notifications/NotificationCenter.js';
export { OnboardingTour } from './components/onboarding/OnboardingTour.js';
export { FirstRunWelcomeScreen } from './components/onboarding/FirstRunWelcomeScreen.js';
export {
  OnboardingTourProvider,
  useTourTarget,
  useTourTarget as useOnboardingTourTarget,
} from './components/onboarding/tour-context.js';
export { TOUR_STEPS } from './components/onboarding/tour-steps.js';
export type { TourStep, TourSlot } from './components/onboarding/tour-steps.js';
export { ProjectCreateDialog } from './components/project/ProjectCreateDialog.js';
export type { ProjectCreateDialogCreateInput } from './components/project/ProjectCreateDialog.js';
export { ProjectSelectedSummary } from './components/project/ProjectListPanel.js';
export { ProjectSelector } from './components/project/ProjectSelector.js';
export { ResumeBar } from './components/project/ResumeBar.js';
export { KeyboardShortcutsDialog } from './components/shared/KeyboardShortcutsDialog.js';
export { WorkspacePageShell } from './components/workspace/WorkspacePageShell.js';
export type { MarketSortOption } from './components/marketplace/marketplace-meta.js';
export type { MarketSessionState } from './components/marketplace/MarketPage.js';
export { ActivityLogPage } from './components/events/ActivityLogPage.js';
export {
  MarketPage,
  MarketPage as MarketWorkspacePage,
} from './components/marketplace/MarketPage.js';
export { SopViewSurface } from './components/sop/SopViewSurface.js';
export type { SopSessionState as SopViewSessionState } from './components/sop/SopViewSurface.js';
export { SettingsPage } from './components/settings/SettingsPage.js';
export { disposeEventLogStore, primeEventLogStore } from './components/events/EventLog.js';
export { useCompanyZones } from './hooks/useCompanyZones.js';
export { parseCompanyDescription, updateCompanyIdentity } from './lib/company-identity.js';
export { useDeepLinkInstall } from './hooks/useDeepLinkInstall.js';
export { useEmployeeEditor } from './hooks/useEmployeeEditor.js';
export { useFirstRunGuidance } from './hooks/useFirstRunGuidance.js';
export { useInstallFlow } from './hooks/useInstallFlow.js';
export {
  computeLayoutTier,
  type LayoutTier,
  type LayoutTierConfig,
  useLayoutTier,
} from './hooks/use-layout-tier.js';
export { usePrefabInstances } from './hooks/usePrefabInstances.js';
export { PlanStepStoreProvider, usePlanStepStore } from './hooks/plan-step-store.js';
export { useProjects } from './hooks/useProjects.js';
export { useReducedMotion } from './hooks/use-reduced-motion.js';
export { useSceneOrchestrator } from './hooks/useSceneOrchestrator.js';
export { isTauri } from './lib/env.js';
export {
  getSidebarCollapse,
  setSidebarCollapse,
  useSidebarCollapse,
} from './lib/sidebar-collapse-store.js';
export type {
  SidebarCollapseValue,
  SidebarWorkspaceKey,
} from './lib/sidebar-collapse-store.js';
export { stripLegacySpeakerPrefix } from './lib/legacy-speaker-prefix.js';
export {
  canPreviewDeliverable,
  getDeliverableDisplayTitle,
  mapDeliverableFullRowToHookRow,
  mapDeliverableSummaryToHookRow,
  resolveDeliverableArtifact,
  type DeliverableArtifact,
  type DeliverableHookRow,
} from './lib/deliverable-artifacts.js';
export {
  DEFAULT_EXECUTION_LANE,
  getInstallEnvironmentForExecutionMode,
  isExecutionLaneAllowed,
  loadProviderConfig,
  resolveProviderConfig,
  resolveProviderHostAvailability,
  type ProviderConfig,
  type ResolvedProviderConfig,
  type ResolvedTransportProfile,
  resolveAvailableExecutionLanes,
  resolveEffectiveRuntimePolicy,
} from './lib/provider-config.js';
export {
  getProviderPreset,
  getSupportedExecutionLanesForPreset,
} from './components/settings/provider-presets.js';
export { resolveModelContextWindow } from './lib/provider-product-taxonomy.js';
export { loadStoredLocalMcpServers } from './lib/desktop-mcp-registry.js';
export { getTrustedHostProductStatus } from './lib/desktop-provider-secrets.js';
export { NotificationProvider } from './runtime/notification-provider.js';
export {
  OffisimRuntimeDesktopHostContext,
  OffisimRuntimeExecutionContext,
  OffisimRuntimeInteractionContext,
  OffisimRuntimeServicesContext,
  OffisimRuntimeContext,
  OffisimRuntimeStatusContext,
  type OffisimRuntimeDesktopHostValue,
  type OffisimRuntimeExecutionValue,
  type OffisimRuntimeInteractionValue,
  type OffisimRuntimeServicesValue,
  type OffisimRuntimeStatusValue,
  type OffisimRuntimeValue,
  type SendMessageResult,
  EMPTY_ENGINE_ADAPTERS,
  useAvailableEngineAdapters,
  useCompanyEmployeeRuntimeDefault,
  useOffisimRuntimeDesktopHost,
  useOffisimRuntimeExecution,
  useOffisimRuntimeInteraction,
  useOffisimRuntime,
  useOffisimRuntimeServices,
} from './runtime/offisim-runtime-context.js';
export { SceneCeremonyProvider } from './runtime/scene-ceremony-context.js';
export { SceneIntentDispatcher } from './runtime/scene-intent-dispatcher.js';
export { InMemorySceneIntentBus } from './runtime/scene-intents.js';
export { useAgentStates } from './runtime/use-agent-states.js';
export { useEmployeeSkillHighlights } from './runtime/use-employee-skill-highlights.js';
export type { EmployeeSkillHighlight } from './runtime/use-employee-skill-highlights.js';
export {
  terminateRunAsInterrupted,
  terminateRunWithError,
  useChatStreamingSync,
} from './runtime/use-chat-streaming-sync.js';
export { ThemeProvider, type Theme, useTheme } from './theme/index.js';

export type {
  AttachmentReadResult,
  AttachmentRepoEnumerator,
  AttachmentStore,
} from './lib/attachment-store.js';
export { cascadeDeleteByThreads } from './lib/attachment-store.js';
export { computeSha256 as computeAttachmentSha256 } from './lib/attachment-sha256.js';
