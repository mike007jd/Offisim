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
  ExecutionResumedPayload,
  ExecutionAbortedPayload,
  InteractionRequestedPayload,
  InteractionRestoredPayload,
  InteractionResolvedPayload,
  InteractionModeChangedPayload,
  InstallStatePayload,
  BindingStatePayload,
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
  TaskSubtaskProgressPayload,
  ToolExecutionTelemetryPayload,
  VaultSyncFailedPayload,
} from './events.js';

export type {
  InteractionMode,
  InteractionKind,
  InteractionSeverity,
  InteractionScope,
  InteractionOption,
  BossRecommendation,
  PermissionInteractionContext,
  PlanReviewInteractionContext,
  AgentQuestionInteractionContext,
  InteractionContext,
  InteractionRequest,
  InteractionResponse,
} from './interactions.js';
export { AGENT_QUESTION_REQUIRED, PLAN_REVIEW_REQUIRED } from './interactions.js';

export type {
  BindingType,
  BindingStatus,
  InstallSourceType,
} from './install.js';

export type {
  LlmProvider,
  ModelProfile,
  ModelPolicyConfig,
  RuntimeExecutionMode,
  RuntimeMemoryPolicy,
  RuntimePolicyConfig,
  ResolvedModel,
  RuntimeSummarizationPolicy,
  RuntimeToolPermissionBehavior,
  RuntimeToolPermissionRule,
  RuntimeToolPermissionsPolicy,
  RuntimeToolSearchPolicy,
} from './models.js';

export type { SopStep, SopDefinition } from './sop.js';

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
  ProjectAssignmentRow,
  NewProjectAssignment,
} from './project.js';
export { ACTIVE_PROJECT_STATUSES, COMPLETED_PROJECT_STATUSES } from './project.js';

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
} from './zone-resolution.js';

export type {
  EmployeeAppearance,
  EmployeePersona,
  EmployeeConfig,
  RuntimeSkillCapability,
  RuntimeSkillConfig,
  EmployeeToolApprovalMode,
  EmployeeToolPermissionOverride,
  EmployeeToolPermissionPolicy,
} from './json-field-parsers.js';
export {
  parseEmployeePersona,
  parseEmployeeConfig,
  parsePrefabBindings,
} from './json-field-parsers.js';
