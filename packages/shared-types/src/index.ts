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
  LlmStreamChunkPayload,
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
  PrefabStateChangedPayload,
  TaskAssignmentDispatchedPayload,
  TaskSubtaskProgressPayload,
} from './events.js';

export type {
  BindingType,
  BindingStatus,
  InstallSourceType,
} from './install.js';

export type {
  LlmProvider,
  SelfDevelopedProvider,
  AdapterOnlyProvider,
  ModelProfile,
  ModelPolicyConfig,
  RuntimeExecutionMode,
  RuntimeMemoryPolicy,
  RuntimePolicyConfig,
  ResolvedModel,
  RuntimeSummarizationPolicy,
  RuntimeToolSearchPolicy,
} from './models.js';

export { isProductionProvider } from './models.js';

export type { SopStep, SopDefinition } from './sop.js';

export type {
  SemanticCategory,
  PrefabBindingSlotType,
  PrefabBindingSlotDef,
  RenderTemplate2D,
  PrefabChildDef,
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
  ProjectStatus,
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
export { UNASSIGNED_ZONE_ID } from './zone.js';

export { SYSTEM_ZONE_TEMPLATES, findSystemTemplate, templateToZone } from './zone-templates.js';

export type { ZonePresetPrefab, ZonePreset } from './zone-presets.js';
export {
  ZONE_PRESETS,
  ZONE_PRESET_GROUPS,
  REQUIRED_ARCHETYPES,
  findZonePreset,
  isRequiredArchetype,
  getPresetsForArchetype,
} from './zone-presets.js';

export type { ZoneRect } from './zone-overlap.js';
export { zonesOverlap, findOverlaps, computeOverlapMap } from './zone-overlap.js';

export type { ZoneMatch } from './zone-resolution.js';
export {
  isInsideZone,
  resolveZoneForPosition,
  resolveZoneForRole,
  resolveEmployeeZone,
} from './zone-resolution.js';
