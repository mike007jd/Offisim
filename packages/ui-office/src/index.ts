// Components
// Note: CompanyCreationWizard, CompanyEditor, DashboardOverlay, EmployeeCreatorOverlay,
// InstallDialog, OfficeEditorOverlay, SettingsDialog are intentionally NOT exported from
// the barrel — they are lazy-loaded via subpath exports (e.g. @offisim/ui-office/wizard).
export * from './components/ErrorBoundary.js';
export { CompanyProvider, useCompany } from './components/company/CompanyContext.js';
export { CompanySelectionPage } from './components/company/CompanySelectionPage.js';
export * from './components/company/PolicyEditor.js';
export * from './components/agents/AgentCard.js';
export * from './components/agents/AgentPanel.js';
export * from './components/agents/EmployeeInspector.js';
export { DicebearAvatar } from './components/shared/DicebearAvatar.js';
export * from './components/shared/KeyboardShortcutsDialog.js';
export * from './components/chat/ChatDrawer.js';
export * from './components/chat/ChatInput.js';
export * from './components/chat/ChatPanel.js';
export * from './components/chat/InteractionDecisionCard.js';
export * from './components/chat/InteractionPrompt.js';
export * from './components/chat/MessageBubble.js';
export * from './components/chat/ActivityRail.js';
export * from './components/chat/StreamingBubble.js';
export * from './components/dashboard/CompanyStatusCard.js';
export * from './components/dashboard/CostByModelCard.js';
export * from './components/dashboard/CostOverviewCard.js';
export * from './components/dashboard/RecentActivityCard.js';
export * from './components/dashboard/StepProgressBar.js';
export * from './components/dashboard/TaskDetailPanel.js';
export * from './components/dashboard/TaskQueueCard.js';
export * from './components/dashboard/TeamHealthCard.js';
export * from './components/employees/EmployeeEditorDialog.js';
export * from './components/employees/EmployeeQuickCard.js';
export * from './components/employees/InterviewWizard.js';
export * from './components/employees/MemoryPanel.js';
export * from './components/employees/SkillBindingList.js';
export * from './components/employees/ToolPermissionEditor.js';
export * from './components/employees/VersionDiffTable.js';
export * from './components/employees/TestChatTab.js';
export * from './components/employees/VersionHistoryTab.js';
export * from './components/employees/interview-steps/ExpertiseStep.js';
export * from './components/employees/interview-steps/HRPrompt.js';
export * from './components/employees/interview-steps/InstructionsStep.js';
export * from './components/employees/interview-steps/ModelStep.js';
export * from './components/employees/interview-steps/NameStep.js';
export * from './components/employees/interview-steps/PreviewStep.js';
export * from './components/employees/interview-steps/RoleStep.js';
export * from './components/employees/interview-steps/StyleStep.js';
export * from './components/error/EmptyState.js';
export * from './components/error/ErrorBanner.js';
export * from './components/events/EventFilters.js';
export * from './components/events/EventItem.js';
export * from './components/events/EventLog.js';
export * from './components/install/BindingForm.js';
export * from './components/install/FileImportTrigger.js';
export * from './components/install/InstallProgress.js';
export * from './components/install/ManifestReview.js';
export * from './components/install/SkillReview.js';
// Note: Kanban is NOT exported from the barrel — lazy-loaded via subpath @offisim/ui-office/kanban
export * from './components/layout/AppLayout.js';
export * from './components/notifications/NotificationCard.js';
export * from './components/notifications/NotificationCenter.js';
export * from './components/project/ProjectSelector.js';
export * from './components/project/ProjectListPanel.js';
export * from './components/layout/Header.js';
export * from './components/layout/RightSidebar.js';
export * from './components/layout/StatusBar.js';
export * from './components/library/Library.js';
export * from './components/marketplace/MarketplacePanel.js';
export * from './components/office/MeetingControls.js';
export { MeetingPanel } from './components/office/MeetingPanel.js';
export type { MeetingPanelProps } from './components/office/MeetingPanel.js';
export * from './components/pitch/PitchHall.js';
export * from './components/plan/TaskDashboard.js';
export * from './components/project/ResumeBar.js';
export * from './components/plan/TaskItem.js';
export * from './components/plan/TaskStepCard.js';
export * from './components/scene/PerformanceHUD.js';
export * from './components/scene/SceneCanvas.js';
export * from './components/scene/useScene.js';
export * from './components/server-room/ServerRoom.js';
export * from './components/settings/McpConfigPanel.js';
export * from './components/settings/provider-presets.js';
export * from './components/sop/SopPanel.js';
export * from './components/sop/SopTimelineView.js';
export * from './components/sop/SopStepCard.js';
export * from './components/sop/workspace/SopWorkspacePage.js';

// Hooks
export * from './hooks/use-reduced-motion.js';
export * from './hooks/useCompanyEditor.js';
export * from './hooks/useCompanyCreation.js';
export * from './hooks/useCompanyPreview.js';
export * from './hooks/useCompanyZones.js';
export * from './hooks/useCostDashboard.js';
export * from './hooks/useDashboardMetrics.js';
export * from './hooks/useDeepLinkInstall.js';
export * from './hooks/useDeliverables.js';
export * from './hooks/useEmployeeEditor.js';
export * from './hooks/useEmployeeMemories.js';
export * from './hooks/useEmployeeVersions.js';
export * from './hooks/useErrorTracking.js';
export * from './hooks/useInstallFlow.js';
export * from './hooks/useInterviewWizard.js';
export * from './hooks/useLibrary.js';
export * from './hooks/useOfficeLayout.js';
export * from './hooks/usePrefabInstances.js';
export * from './hooks/useRackSlot.js';
export * from './hooks/useSceneOrchestrator.js';
export * from './hooks/useTaskDashboard.js';
export * from './hooks/useNotifications.js';
export * from './hooks/useTaskQueue.js';
export * from './hooks/useMeeting.js';
export * from './hooks/useProjects.js';
export * from './hooks/usePublish.js';
export * from './hooks/useRegistryClient.js';
export * from './hooks/useMarketplace.js';
export * from './hooks/useSopRuntimeState.js';

// Lib
export * from './lib/env.js';
export * from './lib/desktop-mcp-registry.js';
export * from './lib/desktop-provider-secrets.js';
export * from './lib/provider-config.js';
export * from './lib/export-to-manifest.js';

// Runtime
export * from './runtime/offisim-runtime-context.js';
export * from './runtime/notification-provider.js';
export * from './runtime/scene-ceremony-context.js';
export * from './runtime/scene-intent-dispatcher.js';
export * from './runtime/scene-intents.js';
export * from './runtime/use-agent-states.js';
export * from './runtime/use-runtime-activity-feed.js';
export * from './runtime/use-event-stream.js';
export * from './runtime/use-streaming-content.js';

// Types
export type { OffisimDebugBridge } from './types/global.js';

// Theme
export { ThemeProvider, useTheme, type Theme } from './theme/index.js';
