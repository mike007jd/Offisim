export type {
  CompanyId,
  EmployeeId,
  TaskId,
  MeetingId,
  InstallTxnId,
  InstalledPackageId,
  InstalledAssetId,
  ListingId,
  PackageId,
  AssetBindingId,
  ReportId,
} from './ids.js';

export type {
  EmployeeState,
  TaskState,
  InstallState,
  MeetingState,
  ReportState,
  RuntimeEntityType,
  WorkspacePrefabState,
  ComputePrefabState,
  KnowledgePrefabState,
  CollaborationPrefabState,
  InfrastructurePrefabState,
  PrefabState,
} from './states.js';

export type {
  RuntimeEvent,
  EventFamily,
  CompanyStartupBasePayload,
  CompanyStartupSource,
  CompanyStartupPayload,
  CompanyStartupRequestedPayload,
  CompanyStartupStartedPayload,
  CompanyStartupCompletedPayload,
  CompanyStartupSkippedPayload,
  CompanyStartupFailedPayload,
  EmployeeStatePayload,
  TaskStatePayload,
  TaskAssignmentPayload,
  MeetingStatePayload,
  LlmCallStartedPayload,
  LlmCallCompletedPayload,
  LlmUsageRecordedPayload,
  GraphNodeEnteredPayload,
  GraphNodeExitedPayload,
  BossRouteAction,
  BossRouteDecidedPayload,
  LlmStreamChunkPayload,
  ConversationSynopsisUpdatedPayload,
  ConversationCompactCompletedPayload,
  WorkspaceStalenessDetectedPayload,
  WorkspaceBindingConsumer,
  WorkspaceBindingUnavailableMissingAt,
  WorkspaceBindingUnavailablePayload,
  ExecutionResumedPayload,
  ExecutionAbortedPayload,
  InstallStatePayload,
  BindingStatePayload,
  MarketListingInstalledPayload,
  PlanCreatedPayload,
  PlanStepStartedPayload,
  PlanStepCompletedPayload,
  PlanCompletedPayload,
  McpServerConnectedPayload,
  McpToolCalledPayload,
  McpToolResultPayload,
  EmployeeInstalledPayload,
  EmployeeCreatedPayload,
  EmployeeUpdatedPayload,
  EmployeeDeletedPayload,
  EngineActivityKind,
  EngineActivityStatus,
  EngineProposalKind,
  EngineProposalEventPayload,
  EngineActivityPayload,
  EngineProposalCreatedPayload,
  ErrorOccurredPayload,
  DeliverableCreatedPayload,
  DirectChatStartedPayload,
  DirectChatCompletedPayload,
  ReportStatePayload,
  UiSelectionPayload,
  MeetingActionCreatedPayload,
  HandoffInitiatedPayload,
  HandoffCompletedPayload,
  MemoryCreatedPayload,
  MemoryAccessedPayload,
  EmployeeWorkstationChangedPayload,
  EmployeeWorkstationDropRequestedPayload,
  EmployeeVersionCreatedPayload,
  BossEmployeeContextEmptyPayload,
  BossRosterDivergencePayload,
  RackBoundPayload,
  RackUnboundPayload,
  SlotAssignedPayload,
  SlotRemovedPayload,
  CostAggregatedPayload,
  SessionCostBreakdown,
  SessionCostUpdatedPayload,
  UiTaskFocusedPayload,
  SceneEmployeeSelectedPayload,
  HrAssessmentStartedPayload,
  HrAssessmentCompletedPayload,
  HrRecommendationPayload,
  NotificationPayload,
  NotificationDismissedPayload,
  KnowledgeIndexStartedPayload,
  KnowledgeIndexCompletedPayload,
  KnowledgeIndexFailedPayload,
  KnowledgeSearchStartedPayload,
  KnowledgeSearchCompletedPayload,
  GitAutoCommittedPayload,
  PrefabStateChangedPayload,
  TaskAssignmentDispatchedPayload,
  TaskAssignmentReroutedPayload,
  TaskAssignmentRerouteReason,
  TaskAssignmentRerouteSource,
  TaskSubtaskProgressPayload,
  ChatThreadUpdateReason,
  ChatThreadUpdatedPayload,
} from './events.js';
export { TASK_ASSIGNMENT_REROUTED } from './events/task.js';

export type {
  AttachmentKind,
  AttachmentMeta,
  ChatAttachmentRef,
  FileLike,
  ParseVaultRefResult,
  ParsedAttachment,
  StagedAttachment,
  VaultRef,
} from './chat-attachments.js';
export {
  buildVaultRef,
  CHAT_ATTACHMENT_MAX_BYTES,
  CURRENT_PARSED_REV,
  isAttachmentKind,
  kindFromMime,
  parseVaultRef,
  summaryFromParsed,
} from './chat-attachments.js';
export type {
  ChatAttachmentEvictedPayload,
  ChatAttachmentFailReason,
  ChatAttachmentFailedPayload,
  ChatAttachmentGcDroppedPayload,
  ChatAttachmentGcReason,
  ChatAttachmentGcSweptPayload,
  ChatAttachmentPersistedPayload,
  ChatAttachmentReadPayload,
  ChatAttachmentStagedPayload,
} from './events/chat-attachment-events.js';
export {
  ATTACHMENT_GC_REASON_COMPANY,
  ATTACHMENT_GC_REASON_ORPHANED,
  ATTACHMENT_GC_REASON_PROJECT,
  ATTACHMENT_GC_REASON_THREAD,
  CHAT_ATTACHMENT_EVICTED,
  CHAT_ATTACHMENT_FAILED,
  CHAT_ATTACHMENT_GC_DROPPED,
  CHAT_ATTACHMENT_GC_SWEPT,
  CHAT_ATTACHMENT_PERSISTED,
  CHAT_ATTACHMENT_READ,
  CHAT_ATTACHMENT_STAGED,
  chatAttachmentEvent,
} from './events/chat-attachment-events.js';

export type { RunScope, RunToolPolicy } from './run-scope.js';
export { chatScopeFields } from './run-scope.js';

export type {
  ActivityKind,
  AgentRunAccess,
  AgentRunApprovalPayload,
  AgentRunArtifactPayload,
  AgentRunDeltaPayload,
  AgentRunEvent,
  AgentRunEventType,
  AgentRunFinishedPayload,
  AgentRunRecord,
  AgentRunRelation,
  AgentRunScopeFields,
  AgentRunStartedPayload,
  AgentRunStatus,
  AgentRunToolPayload,
  AgentRunUsage,
  DelegateTaskInput,
  DelegateToolInput,
  WorkKind,
} from './events/agent-run.js';
export { classifyToolActivity } from './events/agent-run.js';
export type {
  ActivityEntry,
  AgentRunNode,
  AgentRunProjection,
  ApprovalEntry,
  ArtifactEntry,
  EmployeeStateEntry,
} from './events/agent-run-projection.js';
export { projectAgentRun } from './events/agent-run-projection.js';
export type {
  BeatAffordance,
  BeatKind,
  DramaturgyConfig,
  DramaturgyTiming,
  SceneBeat,
  TimedAgentRunEvent,
} from './dramaturgy/beat-composer.js';
export { BEAT_PRIORITY, DEFAULT_TIMING, composeBeats } from './dramaturgy/beat-composer.js';
export type {
  ActorStaging,
  InteractionAnchor,
  InteractionAnchorKind,
  StagingPrefab,
  StagingRequest,
  WorldAnchor,
} from './dramaturgy/staging.js';
export {
  BUILTIN_PREFAB_AFFORDANCES,
  builtinPrefabAffordances,
  reserveStaging,
  worldAnchorsFor,
} from './dramaturgy/staging.js';
export type {
  CharacterPerformanceState,
  Expression,
  Locomotion,
  Posture,
  Prop,
  SocialGesture,
  WorkGesture,
} from './dramaturgy/performance.js';
export { IDLE_PERFORMANCE, performanceForBeat } from './dramaturgy/performance.js';
export type {
  EmployeePerformanceAction,
  EmployeePerformanceDomain,
  EmployeePerformanceKind,
  EmployeePerformanceState,
  EmployeePerformanceStateMap,
} from './employee-performance-state.js';
export { reduceEmployeePerformanceStates } from './employee-performance-state.js';
export type {
  ToolExecutionTelemetryPayload,
  VaultSyncFailedPayload,
} from './events.js';

export type {
  InteractionMode,
  InteractionKind,
  InteractionSeverity,
  InteractionRequest,
} from './interactions.js';
export {
  DEFAULT_INTERACTION_MODE,
  INTERACTION_MODE_DESCRIPTION,
  INTERACTION_MODE_LABEL,
  INTERACTION_MODES,
  isInteractionMode,
} from './interactions.js';
export type { ChatRuntimeOutcomeKind } from './chat-outcomes.js';
export {
  ATTACHMENTS_REQUIRE_GATEWAY_LANE,
  LOCAL_TOOLS_REQUIRE_GATEWAY_LANE,
  isChatRuntimeOutcomeKind,
} from './chat-outcomes.js';
export type {
  BindingType,
  BindingStatus,
  InstallSourceType,
} from './install.js';

export type {
  LlmExecutionLane,
  LlmProvider,
  EngineId,
  EmployeeRuntimeBinding,
  RuntimeEngineAvailability,
  RuntimeEngineCapabilityMatrix,
  RuntimeEngineCapabilityProfile,
  RuntimeEngineCapabilityStatus,
  RuntimeEngineCapabilityTier,
  RuntimeEngineEvidenceRequirements,
  RuntimeEvidenceClass,
  RuntimeEngineToolModel,
  RuntimeEngineVerificationStatus,
  MainHarnessMode,
  MainHarnessOverridePolicyRecord,
  MainHarnessOverrideScope,
  MainHarnessPolicyConfig,
  ProviderAuthStrategy,
  ProviderCatalogSource,
  ProviderProductAccessMode,
  ProviderProductId,
  ModelProfile,
  ModelPolicyConfig,
  ResolvedProviderVariant,
  RuntimeExecutionMode,
  RuntimeMemoryPolicy,
  RuntimePolicyConfig,
  RuntimeRecordingMode,
  RuntimeRecordingPolicy,
  ResolvedModel,
  RuntimeSummarizationPolicy,
  RuntimeToolLoopPolicy,
  RuntimeToolPermissionBehavior,
  RuntimeToolPermissionRule,
  RuntimeToolPermissionsPolicy,
  RuntimeToolSearchPolicy,
} from './models.js';
export { ENGINE_IDS } from './models.js';

export type {
  SemanticCategory,
  PrefabBindingSlotType,
  PrefabBindingSlotDef,
  RenderTemplate2D,
  PrefabChildDef,
  CompositePrefabDefinition,
  AtomicPrefabDefinition,
  PrefabDefinition,
  PrefabInstanceRow,
  PrefabBinding,
} from './prefab.js';

export type { RoleSlug, Department, RoleEntry } from './roles.js';
export {
  ROLE_REGISTRY,
  ROLE_TO_DEPARTMENT,
  SYSTEM_ROLES,
  ROLE_LABELS,
} from './roles.js';
export type {
  CommunicationFrequency,
  RiskPreference,
  DecisionStyle,
} from './persona.js';

export type {
  ProjectStatus,
  ProjectAssignmentRole,
  ProjectRow,
  NewProject,
  ProjectUpdatePatch,
  ProjectAssignmentRow,
  NewProjectAssignment,
  ChatThread,
  NewChatThread,
} from './project.js';
export {
  ACTIVE_PROJECT_STATUSES,
  COMPLETED_PROJECT_STATUSES,
  formatWorkspaceRootHint,
  trimToNull,
} from './project.js';

export type {
  ZoneKind,
  ZoneArchetype,
  ActivityType,
  ZoneRow,
  Zone,
  SystemZoneTemplate,
} from './zone.js';
export {
  UNASSIGNED_ZONE_ID,
  STUDIO_PREVIEW_COMPANY_ID,
  WIZARD_PREVIEW_COMPANY_ID,
} from './zone.js';

export {
  SYSTEM_ZONE_TEMPLATES,
  createZoneBlueprint,
  findSystemTemplate,
  templateToZone,
} from './zone-templates.js';

export {
  SYSTEM_PREFAB_LAYOUT_VERSION,
  getSystemZoneDefaultPrefabs,
} from './system-zone-prefab-layout.js';
export type { SystemZonePrefabLayoutInput } from './system-zone-prefab-layout.js';

export type { ZonePresetPrefab, ZonePreset } from './zone-presets.js';
export {
  ZONE_PRESETS,
  ZONE_PRESET_GROUPS,
  REQUIRED_ARCHETYPES,
  findZonePreset,
  isRequiredArchetype,
  getPresetsForArchetype,
} from './zone-presets.js';

export type {
  AgentContextPack,
  AgentContextPackThread,
  AgentContextPackPendingInteraction,
  AgentContextPackTaskRun,
  AgentContextPackNodeSummary,
} from './agent-context-pack.js';

export type {
  PrefabFootprint,
  PrefabAnchor,
  PrefabAnchorSet,
  PrefabSpatialSpec,
  BuiltinPrefabId,
  PrefabPlacementBoundsInput,
  PrefabPlacementBounds,
  PrefabPlacementZoneBounds,
  PrefabOffsetPlacement,
  PrefabPlacementObstacle,
  PrefabPlacementVerdict,
} from './prefab-spatial.js';
export {
  BUILTIN_PREFAB_IDS,
  BUILTIN_PREFAB_FOOTPRINTS,
  getBuiltinPrefabFootprint,
  prefabPlacementBounds,
  prefabBoundsToRect,
  prefabBoundsOverlap,
  findPrefabPlacementOverlaps,
  prefabFitsWithinZone,
  evaluatePrefabPlacement,
  resolveNonOverlappingPrefabOffsets,
  rotateLocalXZ,
  normalizeRotation,
} from './prefab-spatial.js';

export type { ZoneRect } from './zone-overlap.js';
export { zonesOverlap, findOverlaps, computeOverlapMap } from './zone-overlap.js';

export type { ZoneMatch } from './zone-resolution.js';
export {
  normalizeZoneId,
  extractZoneSlug,
  reparentZoneId,
  isInsideZone,
  resolveZoneForPosition,
  resolveZoneForRole,
  resolveEmployeeZone,
  resolveHomeZone,
} from './zone-resolution.js';

export type {
  EmployeeAppearance,
  EmployeePersona,
  EmployeeConfig,
  EmployeeToolApprovalMode,
  EmployeeToolPermissionOverride,
  EmployeeToolPermissionPolicy,
} from './json-field-parsers.js';

export type {
  SkillScope,
  SkillSourceKind,
  SkillMetadata,
  SkillRow,
  SkillMdParseErrorKind,
  SkillAssetErrorKind,
  SkillEditErrorKind,
} from './skill.js';
export { SkillMdParseError, SkillAssetError, SkillEditError } from './skill.js';
export {
  parseEmployeePersona,
  parseEmployeeConfig,
  parsePrefabBindings,
} from './json-field-parsers.js';
