/**
 * @offisim/core/browser — Browser-safe barrel export.
 *
 * This subpath exports ONLY modules that are safe to import in browser bundles
 * without pulling in server-side persistence, install, and host dependencies.
 *
 * Use `@offisim/core/browser` in UI packages and browser-only code.
 * Use `@offisim/core` for Node-side shared domain helpers.
 */

// --- Types (all type-only, zero runtime cost) ---
export type { RuntimeContext, InteractionBox } from './runtime/runtime-context.js';
export type { HookEvent, HookDefinition } from './runtime/hook-registry.js';
export type { ScratchpadEntry } from './runtime/scratchpad.js';
export type {
  RuntimeRepositories,
  CompanyRow,
  EmployeeRow,
  TaskRunRow,
  AgentRunRow,
  NewAgentRun,
  AgentRunRepository,
  AgentRunStatusUpdateOptions,
  GraphThreadRow,
  ToolCallRow,
  HandoffEventRow,
  MeetingSessionRow,
  RuntimeEventRow,
  LlmCallRow,
  NewGraphThread,
  NewTaskRun,
  NewToolCall,
  NewHandoffEvent,
  NewMeetingSession,
  NewRuntimeEvent,
  NewLlmCall,
  LlmCallRepository,
  CompanyRepository,
  EmployeeRepository,
  EmployeeCreate,
  EmployeeUpdate,
  ThreadRepository,
  TaskRunRepository,
  ToolCallRepository,
  HandoffRepository,
  MeetingRepository,
  EventRepository,
  McpAuditRepository,
  McpAuditRow,
  McpToolGrantRepository,
  McpToolGrantRow,
  FileHistoryRepository,
  FileHistoryChangeKind,
  FileHistoryRow,
  CompactSummaryRepository,
  CompactSummaryRow,
  NewMcpAudit,
  NewMcpToolGrant,
  NewToolPermissionApproval,
  ToolPermissionApprovalRepository,
  ToolPermissionApprovalRow,
  NewFileHistory,
  NewCompactSummary,
  NewNodeSummary,
  AgentEventRepository,
  AgentEventRow,
  NewAgentEvent,
  RecoveryKnowledgeRepository,
  RecoveryKnowledgeRow,
  NewRecoveryKnowledge,
  NewInteractionActive,
  NewInteractionHistory,
  MemoryEntryRow,
  MemoryEntryCreate,
  MemoryRepository,
  NodeSummaryRepository,
  NodeSummaryRow,
  ActiveInteractionRepository,
  InteractionActiveRow,
  InteractionHistoryRepository,
  InteractionHistoryRow,
  EmployeeVersionRow,
  EmployeeVersionChangeType,
  NewEmployeeVersion,
  EmployeeVersionRepository,
  ModelCostRateRow,
  NewModelCostRate,
  ModelCostRateRepository,
  RackRow,
  NewRack,
  RackRepository,
  SlotRow,
  NewSlot,
  SlotRepository,
  WorkstationRackRow,
  NewWorkstationRack,
  WorkstationRackRepository,
  LibraryDocumentRow,
  NewLibraryDocument,
  LibraryDocumentRepository,
  CompanyTemplateAssetRow,
  NewCompanyTemplateAsset,
  OfficeLayoutRow,
  NewOfficeLayout,
  OfficeLayoutRepository,
  ProjectRepository,
  ChatThreadRepository,
  DeliverableRepository,
  DeliverableRow,
  DeliverableSummaryRow,
  DeliverableKind,
  DeliverableContributor,
  NewDeliverable,
  PiMessageRepository,
  PiMessageRow,
  MissionRepository,
  MissionRow,
  NewMission,
  MissionStatusUpdate,
  MissionCriterionRepository,
  MissionCriterionRow,
  NewMissionCriterion,
  MissionAttemptRepository,
  MissionAttemptRow,
  NewMissionAttempt,
  MissionEvaluationRepository,
  MissionEvaluationRow,
  NewMissionEvaluation,
  RuntimeSessionLinkRepository,
  RuntimeSessionLinkRow,
  NewRuntimeSessionLink,
  MissionEventRepository,
  MissionEventRow,
  NewMissionEvent,
  LoopDefinitionRepository,
  LoopDefinitionRow,
  NewLoopDefinition,
  LoopDefinitionUpdate,
  LoopRevisionRepository,
  LoopRevisionRow,
  NewLoopRevision,
  LoopSkillBindingRepository,
  LoopSkillBindingRow,
  NewLoopSkillBinding,
  LoopInvocationRepository,
  LoopInvocationRow,
  NewLoopInvocation,
  CollaborationThreadRepository,
  CollaborationThreadRow,
  NewCollaborationThread,
  CollaborationThreadPatch,
  CollaborationMemberRepository,
  CollaborationThreadMemberRow,
  NewCollaborationThreadMember,
  CollaborationMessageRepository,
  CollaborationMessageRow,
  CollaborationMessagePatch,
  NewCollaborationMessage,
  CollaborationReadStateRepository,
  CollaborationReadStateRow,
  CollaborationTurnRepository,
  CollaborationTurnRow,
  CollaborationTurnPatch,
  NewCollaborationTurn,
} from './runtime/repositories.js';
export type { InstallTransactionRepository } from './repos/install-transaction-repository.js';
export type { InstalledPackageRepository } from './repos/installed-package-repository.js';
export type { InstalledAssetRepository } from './repos/installed-asset-repository.js';
export type { AssetBindingRepository } from './repos/asset-binding-repository.js';
export type { PrefabInstanceRepository } from './repos/prefab-instance-repository.js';
export type { ZoneRepository, NewZone } from './repos/zone-repository.js';
export { ZoneService, hydrateZone, dehydrateZone } from './services/zone-service.js';
export type {
  LlmGateway,
  LlmRequest,
  LlmResponse,
  LlmMessage,
  ToolDef,
  ToolCallResult,
  LlmUsage,
  LlmStreamChunk,
} from './llm/gateway.js';
export type { EventBus, EventHandler } from './events/event-bus.js';
export type { ToolExecutor, ToolCallRequest, ToolCallResponse } from './runtime/tool-executor.js';
export type { RetryConfig } from './llm/retry.js';
export type { TeeResult } from './llm/stream-tee.js';
export type { VersionDiff } from './runtime/employee-version-service.js';
export type {
  CompanyTemplateDefinition,
  TemplateEmployeeDefinition,
  TemplateEmployeePersona,
  TemplatePersonaProfile,
  TemplatePresentation,
  TemplateZoneBlueprint,
} from './templates/index.js';
export type {
  McpServerConfig,
  McpConnection,
  McpClientFactory,
  McpToolDef,
  McpResourceDef,
  McpPromptDef,
  McpServerCapabilities,
  McpOperationOptions,
  ToolApprovalMode,
  ToolPermissionPolicy,
} from './mcp/types.js';
export type { LogLevel, LogEntry } from './services/logger.js';
export type { RackWithSlots } from './services/rack-slot-service.js';
export type { WorkstationToolResolverDeps } from './services/workstation-tool-resolver.js';

// --- Events (lightweight, no heavy deps) ---
export { InMemoryEventBus } from './events/event-bus.js';
export {
  employeeStateChanged,
  companyStartupRequested,
  companyStartupStarted,
  companyStartupCompleted,
  companyStartupSkipped,
  companyStartupFailed,
  taskStateChanged,
  taskAssignmentChanged,
  taskAssignmentRerouted,
  meetingStateChanged,
  llmCallStarted,
  llmCallCompleted,
  llmUsageRecorded,
  costSessionUpdated,
  bossRouteDecided,
  graphNodeEntered,
  graphNodeExited,
  llmStreamChunk,
  toolExecutionTelemetry,
  agentRunEvent,
  installStateChanged,
  bindingStateChanged,
  marketListingInstalled,
  planCreated,
  planStepStarted,
  planStepCompleted,
  planCompleted,
  workspaceBindingUnavailable,
  mcpServerConnected,
  mcpToolCalled,
  mcpToolResult,
  employeeCreated,
  employeeUpdated,
  employeeDeleted,
  employeeInstalled,
  engineActivity,
  engineProposalCreated,
  errorOccurred,
  deliverableCreated,
  directChatStarted,
  directChatCompleted,
  meetingActionCreated,
  handoffInitiated,
  handoffCompleted,
  memoryCreated,
  memoryAccessed,
  employeeWorkstationChanged,
  employeeVersionCreated,
  bossEmployeeContextEmpty,
  bossRosterDivergence,
  chatThreadUpdated,
} from './events/event-factories.js';

// --- Memory Repositories (browser-safe, no Drizzle/sqlite) ---
export {
  createMemoryRepositories,
  MemoryCompactSummaryRepository,
  MemoryMcpAuditRepository,
  MemoryNodeSummaryRepository,
  MemoryEmployeeVersionRepository,
  MemoryModelCostRateRepository,
  MemoryRackRepository,
  MemorySlotRepository,
  MemoryWorkstationRackRepository,
  MemoryLibraryDocumentRepository,
  MemoryOfficeLayoutRepository,
} from './runtime/memory-repositories.js';
export type { MemoryRepositoriesSnapshot } from './runtime/memory-repositories.js';
export type { DeliverableContentLoader } from './runtime/repos/deliverables/memory.js';
export { InMemoryMemoryRepository } from './runtime/repos/memory-system/memory.js';
export {
  buildMemoryUpdatePatch,
  normalizeMemoryDedupeKey,
} from './runtime/repos/memory-system/patch.js';
export type { MemoryUpdateColumns } from './runtime/repos/memory-system/patch.js';
export { createMemoryInstallRepositories } from './runtime/repos/install/memory.js';
export type { MemoryInstallRepositoriesSnapshot } from './runtime/repos/install/memory.js';
export {
  MemoryInstallTransactionRepository,
  MemoryInstalledPackageRepository,
  MemoryInstalledAssetRepository,
  MemoryAssetBindingRepository,
} from './runtime/repos/install/memory.js';

// --- Services (browser-safe, no LLM/graph deps) ---
export { EmployeeVersionService } from './runtime/employee-version-service.js';
export { RackSlotService } from './services/rack-slot-service.js';
export { CompanyTemplateService } from './services/company-template-service.js';
export {
  listTemplates,
  getTemplate,
  serializeTemplatePersona,
} from './templates/index.js';
export { WorkstationAssignmentService } from './runtime/workstation-assignment-service.js';
export { WorkstationToolResolver } from './services/workstation-tool-resolver.js';
export {
  DeliverablePersistenceService,
  mapPayloadToRow as mapDeliverablePayloadToRow,
} from './services/deliverable-persistence-service.js';
export type { DeliverablePersistenceServiceOptions } from './services/deliverable-persistence-service.js';
export { coerceDeliverableKind } from './runtime/repositories.js';
export { byteLength, clampUtf8 } from './utils/byte-length.js';
export { canonicalJson } from './utils/canonical-json.js';
export { sha256Text } from './utils/hash.js';
export { idbRequestToPromise, idbTransactionDone } from './utils/idb-promise.js';
export { AgentContextPackService } from './services/agent-context-pack-service.js';
export type { AgentContextPackDeps } from './services/agent-context-pack-service.js';

// --- Logger ---
export { Logger, setLogHandler, resetLogHandler } from './services/logger.js';

// --- Utilities ---
export { extractJsonFromLlm } from './utils/extract-json.js';
export { generateId } from './utils/generate-id.js';
export { globToRegex, globToRegexPath, matchCostRate } from './utils/glob-match.js';

// --- Errors ---
export { OffisimError, LlmError, GraphError, DataError } from './errors.js';

// --- Runtime (browser-safe parts) ---
export { WORKSTATION_ACCESS_DENIED } from './runtime/tool-executor.js';
export { TOOL_PERMISSION_DENIED, TOOL_PERMISSION_REQUIRED } from './runtime/tool-executor.js';
export { HookRegistry } from './runtime/hook-registry.js';
export { RunConversationState } from './runtime/run-conversation-state.js';
export type {
  RunActiveContextSnapshot,
  RunBudgetSnapshot,
  RunCancellationSnapshot,
  RunConversationStateSnapshot,
  RunDiscoveredToolRecord,
  RunDiscoveredToolSnapshot,
  RunPermissionDenialRecord,
  RunRetrySnapshot,
  RunToolResultRecord,
} from './runtime/run-conversation-state.js';
export type {
  RegisteredTool,
  RuntimeToolSource,
  RuntimeToolType,
  ToolRegistrySurface,
} from './tools/tool-registry.js';
export { Scratchpad } from './runtime/scratchpad.js';

// --- A2A Protocol (HTTP JSON-RPC — cross-agent communication) ---
export { A2AClient } from './a2a/index.js';
export type {
  A2APeer,
  A2ATask,
  A2AAgentCard,
  A2AAgentInterface,
  A2AAgentCapabilities,
  A2AConfig,
  A2APart,
  A2ASendMessageResult,
  A2ATaskState,
  A2ASkill,
} from './a2a/index.js';

// --- Vault (Obsidian-style employee markdown mirror) ---
// NodeFileSystem is NOT exported from the browser barrel — it imports node:fs.
// Import directly from sub-files (not ./vault/index.js) so the browser bundle
// never evaluates the Node-only sibling module.
export { VaultSyncService, VaultSyncError } from './vault/sync-service.js';
export type { VaultSyncServiceOptions, VaultTarget } from './vault/sync-service.js';
export type { VaultFileSystem } from './vault/fs.js';
export {
  VAULT_FILENAMES,
  VAULT_SCHEMA_VERSION,
  employeeFrontmatterSchema,
  soulFrontmatterSchema,
  memoryFrontmatterSchema,
  relationshipsFrontmatterSchema,
  memoryCategoryEnum,
} from './vault/frontmatter.js';
export type {
  VaultFile,
  EmployeeFrontmatter,
  SoulFrontmatter,
  MemoryFrontmatter,
  MemoryCategory,
  RelationshipsFrontmatter,
} from './vault/frontmatter.js';
export { parseDocument, serializeDocument, VaultParseError } from './vault/codec.js';
export type { ParsedDocument } from './vault/codec.js';
export {
  renderEmployeeMd,
  renderSoulMd,
  renderMemoryMd,
  renderRelationshipsMd,
} from './vault/render.js';
export { importEmployeeBundle } from './vault/importer.js';
export type {
  EmployeeSourceFile,
  EmployeeVaultFiles,
  ImportDiagnostic,
  ImportOutcome,
} from './vault/importer.js';
export { employeeSlug } from './vault/slug.js';

// --- Skills (two-tier schema: company-global + employee-specific) ---
export { scanSkillDir } from './skills/skill-scanner.js';
export { resolveUploadSource } from './skills/skill-source-resolvers/upload.js';
export { resolveGitSource } from './skills/skill-source-resolvers/git.js';
export { isResolverError } from './skills/skill-source-resolvers/types.js';
export type {
  ScannedSkill,
  SkillResolverError,
  SkillResolverErrorKind,
  VirtualFile,
  VirtualTree,
} from './skills/skill-source-resolvers/types.js';
export type {
  GitCloneAdapter,
  GitHttpFetch,
  GitLocalFsAdapter,
} from './skills/skill-source-resolvers/git.js';
export type {
  SkillRepository,
  SettingsRepository,
  NewSkill,
  SkillUpdate,
} from './runtime/repositories.js';

// --- Mission Evaluators (PRD §20 — deterministic acceptance checks) ---
// Pure logic over an injected capability context (no node fs/shell/git), so
// browser-safe. Consumed by MS-004 (loop controller) + the evaluator harness.
export type {
  EvaluationContext,
  EvaluationResult,
  EvaluationVerdict,
  MissionEvaluator,
  EvaluatorRegistry,
} from './runtime/mission/evaluators/index.js';
export {
  createEvaluatorRegistry,
  createDefaultEvaluatorRegistry,
  UnknownEvaluatorError,
  BUILTIN_EVALUATORS,
} from './runtime/mission/evaluators/index.js';

// --- Mission Playbook (PRD §25 — declarative Marketplace mission templates) ---
// PB-002/003 validator is the §25.2 SAFETY GATE: a playbook that passes is pure
// declarative data referencing only registered evaluators. PB-004 materializer
// maps a validated playbook → runtime-native resource plan (no install; M-pass).
export {
  validatePlaybook,
  capabilityIsAvailable,
  KNOWN_CAPABILITY_KEYS,
  FORBIDDEN_KEYS,
  materializePlaybook,
  UnsupportedRuntimeError,
} from './runtime/mission/playbook/index.js';
export type {
  PlaybookValidationCode,
  PlaybookValidationError,
  PlaybookValidationResult,
  ValidatedPlaybook,
  ValidatePlaybookOptions,
  MaterializedCriterion,
  MaterializedPlaybook,
  MaterializedSkillBinding,
  PlaybookRuntimeId,
} from './runtime/mission/playbook/index.js';

// --- Mission Service (PRD §18 — the Verified Missions state machine) ---
// The single authoritative writer of mission.status. Pure business state machine
// (no model, no evaluator run). Connected live by MS-005 (the renderer
// MissionRunController) + consumed by the dev-create-mission helper.
export {
  MissionService,
  MissionStateError,
  createMissionService,
} from './runtime/mission/mission-service.js';
export type {
  CreateMissionInput,
  MissionCriterionInput,
  MissionServiceDeps,
  MissionServiceRepos,
  MissionStatus,
  RecordEvaluationInput,
} from './runtime/mission/mission-service.js';
export {
  DEFAULT_MISSION_EXECUTION_BUDGET,
  MissionBudgetValidationError,
  parseMissionBudgetJson,
  resolveMissionExecutionBudget,
} from './runtime/mission/mission-budget.js';

// --- Loop domain (PR-07 — saveable/versioned/reusable wrapper over Missions) ---
// Natural language → generic LoopIR via compiler profiles (first: bundled
// fleet-development-loop as software-development). Saving writes ONLY loop tables,
// never a mission/thread/run. The compiler's model is INJECTED at the call site.
// Consumed by PR-08 (UI) / PR-09 (graph) / PR-10 (Office Send → mission adapter).
export {
  LOOP_COMPILER_VERSION,
  LOOP_LIMITS,
  validateLoopIR,
  defaultBudgetForTier,
  repairOrReject,
  DEFAULT_COMPILER_PROFILE_ID,
  getCompilerProfile,
  listCompilerProfiles,
  SOFTWARE_DEVELOPMENT_PROFILE_ID,
  softwareDevelopmentProfile,
  FLEET_DEVELOPMENT_LOOP_VERSION,
  buildLoopExecutionPacket,
  createLoopService,
  LoopServiceError,
} from './loops/index.js';
export type {
  LoopCompileContext,
  LoopCompileInput,
  LoopCompileModel,
  LoopCompileResult,
  LoopCompilerProfile,
  LoopModelOutput,
  CompilerAsset,
  ValidationFinding,
  RepairOutcome,
  LoopExecutionPacket,
  CompiledMissionCriterion,
  PacketSkillBinding,
  LoopService,
  LoopServiceRepos,
  LoopServiceDeps,
  CreateLoopInput,
  SaveRevisionInput,
  SaveRevisionResult,
  SaveLoopSkill,
} from './loops/index.js';

// --- Collaboration Service (PR-02 — company-scoped daily chat aggregate) ---
// Direct + group chat fully separate from project-scoped chat_threads. No public
// method accepts a projectId. Consumed by PR-03 (runtime) / PR-05 (UI).
export {
  BOSS_ACTOR_ID,
  CollaborationError,
  CollaborationService,
  createCollaborationService,
  readSenderLabel,
} from './runtime/collaboration/collaboration-service.js';
export type {
  CollaborationServiceDeps,
  CollaborationServiceRepos,
  CollaborationThreadSummary,
  UpdateMembersInput,
} from './runtime/collaboration/collaboration-service.js';
export {
  buildCollaborationMessageMetadata,
  readMetadataString,
} from './runtime/repos/collaboration/idempotency.js';

// --- Mission Loop Controller (PRD §19 — bounded deterministic mission loop) ---
// Orchestrates MissionService (MS-002) + EvaluatorRegistry (MS-003) and delegates
// runtime execution to an injected `runAttempt`. NEVER calls a model to decide
// flow (§4). Connected live by MS-005 (the renderer MissionRunController).
export {
  createMissionLoopController,
  DEFAULT_MISSION_LOOP_BUDGET,
} from './runtime/mission/mission-loop-controller.js';
export type {
  AttemptExecution,
  ControllerCriterion,
  FailedCriterion,
  FailurePacket,
  MissionBudgetRemaining,
  MissionLoopBudget,
  MissionLoopController,
  MissionLoopControllerDeps,
  MissionLoopEvidence,
  MissionLoopResult,
  MissionLoopStatus,
  MissionLoopStopReason,
  AttemptEvidence,
  RunAttemptInput,
} from './runtime/mission/mission-loop-controller.js';

// --- Durable Mission Recovery (PRD §22 — DR-001..006) ---
// Additive over the M2 Mission core. Deterministic crash-recovery logic: safe
// boundaries, runtime compatibility hash, startup reconciliation, retry-safety,
// and the resume plan. Pure logic over injected repos/clock; the live resume +
// crash `.app` test are the M-pass. Consumed by the recovery harness.
export {
  isSafeBoundary,
  unmetSafeBoundaryReasons,
  recordSafeBoundary,
  computeCompatibilityHash,
  isCompatible,
  reconcileInterruptedMissions,
  canAutoRetry,
  evaluatorRetrySafety,
  EVALUATOR_RETRY_SAFETY,
  planResume,
  unsafeOperationsInAutoReplay,
} from './runtime/mission/recovery/index.js';
export type {
  SafeBoundaryInput,
  RecordSafeBoundaryResult,
  CompatibilityResources,
  RuntimeExtensionRef,
  ReconciliationRepos,
  ReconcileInterruptedMissionsInput,
  RecoveryCard,
  RecoveryClassification,
  ReconciliationResult,
  SurfacedPendingInteraction,
  UnfinishedOperation,
  RetrySafety,
  RetrySafetyMeta,
  ResumePlan,
  InterruptionFact,
} from './runtime/mission/recovery/index.js';

// --- Isolated Parallel Write (PRD §23 — WI-001..006) ---
// Additive over the M2 Mission core. Deterministic WorkspaceLeaseManager over an
// injected GitWorktreeOps: writable Git children get an isolated worktree+branch;
// read/review/non-Git share the root read-only; conflicts surface at merge time
// (no auto three-way merge, no silent overwrite). Production wraps git_exec; the
// harness fakes it. Consumed by the renderer git-worktree adapter + the harness.
export { createWorkspaceLeaseManager } from './runtime/mission/workspace/index.js';
export type {
  WorkspaceLeaseManager,
  WorkspaceLeaseManagerDeps,
  AcquireChildLeaseInput,
  ReleaseLeaseOptions,
  WorkspaceLease,
  WorkspaceLeaseStatus,
  WorkspaceAccess,
  GitWorktreeOps,
  MergeResult,
  AcquireChildResult,
  LeaseDiff,
  IntegrationConflict,
  IntegrationPlan,
  IntegrationResult,
} from './runtime/mission/workspace/index.js';
