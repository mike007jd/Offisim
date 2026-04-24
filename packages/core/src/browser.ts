/**
 * @offisim/core/browser — Browser-safe barrel export.
 *
 * This subpath exports ONLY modules that are safe to import in browser bundles
 * without pulling in heavy server-side dependencies (LangGraph, OpenAI SDK,
 * Anthropic SDK, checkpoint-sqlite, MCP SDK).
 *
 * Use `@offisim/core/browser` in UI packages and browser-only code.
 * Use `@offisim/core` for the full runtime (graphs, LLM adapters, MCP, etc.).
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
  GraphThreadRow,
  ToolCallRow,
  HandoffEventRow,
  MeetingSessionRow,
  GraphCheckpointRow,
  RuntimeEventRow,
  LlmCallRow,
  NewGraphThread,
  NewTaskRun,
  NewToolCall,
  NewHandoffEvent,
  NewMeetingSession,
  NewGraphCheckpoint,
  NewRuntimeEvent,
  NewLlmCall,
  LlmCallRepository,
  CheckpointRepository,
  CompanyRepository,
  EmployeeRepository,
  EmployeeUpdate,
  ThreadRepository,
  TaskRunRepository,
  ToolCallRepository,
  HandoffRepository,
  MeetingRepository,
  EventRepository,
  McpAuditRepository,
  McpAuditRow,
  FileHistoryRepository,
  FileHistoryChangeKind,
  FileHistoryRow,
  CompactSummaryRepository,
  CompactSummaryRow,
  NewMcpAudit,
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
  SopTemplateRow,
  NewSopTemplate,
  SopTemplateUpdate,
  SopTemplateRepository,
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
  OfficeLayoutRow,
  NewOfficeLayout,
  OfficeLayoutRepository,
  ProjectRepository,
  UserPreferenceRepository,
  UserPreferenceRow,
  DeliverableRepository,
  DeliverableRow,
  DeliverableSummaryRow,
  DeliverableKind,
  DeliverableContributor,
  NewDeliverable,
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
export type {
  EngineAdapter,
  EngineAdapterRegistry,
} from './engine/engine-adapter.js';
export type {
  EngineArtifact,
  EngineProposal,
  EngineRunContext,
  EngineRunHandle,
  EngineRunResult,
  EngineTaskEnvelope,
  RuntimeActivityEvent,
} from './engine/engine-types.js';
export type { ToolExecutor, ToolCallRequest, ToolCallResponse } from './runtime/tool-executor.js';
export type {
  ToolPermissionAuthorizer,
  ToolPermissionDecision,
  ToolPermissionRequest,
} from './permissions/tool-permission-engine.js';
export type {
  ToolPermissionGrantRequest,
  ToolPermissionGrantMatch,
  ToolPermissionGrantResolver,
} from './services/interaction-service.js';
export type {
  OffisimGraphState,
  PendingAssignment,
  TaskPlan,
  PlanStep,
  PlanTask,
  ManagerDirective,
  StepTaskOutput,
  StepResult,
  CitationRef,
} from './graph/state.js';
export type { RetryConfig } from './llm/retry.js';
export type { TeeResult } from './llm/stream-tee.js';
export type { ExecutionTrace, ExecutionTraceService } from './services/execution-trace-service.js';
export type { VersionDiff } from './runtime/employee-version-service.js';
export type { CostAggregate, DashboardSummary } from './runtime/cost-calculation-service.js';
export type {
  CompanyTemplate,
  CompanyTemplateEmployee,
  TemplateZoneBlueprint,
} from './templates/index.js';
export type {
  McpServerConfig,
  McpConnection,
  McpClientFactory,
  McpToolDef,
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
  taskStateChanged,
  taskAssignmentChanged,
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
  installStateChanged,
  bindingStateChanged,
  planCreated,
  planStepStarted,
  planStepCompleted,
  planCompleted,
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
  interactionRequested,
  interactionRestored,
  interactionResolved,
  interactionModeChanged,
} from './events/event-factories.js';

export { resolveEmployeeRuntimeBinding } from './engine/runtime-binding.js';

// --- Memory Repositories (browser-safe, no Drizzle/sqlite) ---
export {
  createMemoryRepositories,
  MemoryCompactSummaryRepository,
  MemoryMcpAuditRepository,
  MemoryNodeSummaryRepository,
  MemoryEmployeeVersionRepository,
  MemoryModelCostRateRepository,
  MemorySopTemplateRepository,
  MemoryRackRepository,
  MemorySlotRepository,
  MemoryWorkstationRackRepository,
  MemoryLibraryDocumentRepository,
  MemoryOfficeLayoutRepository,
} from './runtime/memory-repositories.js';
export type { MemoryRepositoriesSnapshot } from './runtime/memory-repositories.js';
export type { DeliverableContentLoader } from './runtime/repos/deliverables/memory.js';
export { InMemoryMemoryRepository } from './repositories/memory-memory-repository.js';
export { MemoryUserPreferenceRepository } from './repositories/memory-user-preference-repository.js';
export { createMemoryInstallRepositories } from './runtime/memory-install-repos.js';
export type { MemoryInstallRepositoriesSnapshot } from './runtime/memory-install-repos.js';
export {
  MemoryInstallTransactionRepository,
  MemoryInstalledPackageRepository,
  MemoryInstalledAssetRepository,
  MemoryAssetBindingRepository,
} from './runtime/memory-install-repos.js';

// --- Services (browser-safe, no LLM/graph deps) ---
export { EmployeeVersionService } from './runtime/employee-version-service.js';
export { CostCalculationService } from './runtime/cost-calculation-service.js';
export { SessionCostTracker } from './runtime/session-cost-tracker.js';
export { SopService } from './services/sop-service.js';
export { SopSyncService } from './services/sop-sync-service.js';
export type { SopSyncResult } from './services/sop-sync-service.js';
export { RackSlotService } from './services/rack-slot-service.js';
export { LibraryService } from './services/library-service.js';
export type { CitationEntry } from './services/library-service.js';
export { CompanyTemplateService } from './services/company-template-service.js';
export { listTemplates, getTemplate } from './templates/index.js';
export { DEFAULT_COST_RATES } from './runtime/default-cost-rates.js';
export { WorkstationAssignmentService } from './runtime/workstation-assignment-service.js';
export { WorkstationToolResolver } from './services/workstation-tool-resolver.js';
export { NodeSummaryService } from './services/node-summary-service.js';
export { GitAutoCommitService } from './services/git-auto-commit-service.js';
export type {
  GitExec,
  GitExecResult,
  GitAutoCommitResult,
} from './services/git-auto-commit-service.js';
export { ToolTelemetryService } from './services/tool-telemetry-service.js';
export {
  DeliverablePersistenceService,
  mapPayloadToRow as mapDeliverablePayloadToRow,
} from './services/deliverable-persistence-service.js';
export type { DeliverablePersistenceServiceOptions } from './services/deliverable-persistence-service.js';
export { coerceDeliverableKind } from './runtime/repositories.js';
export { byteLength, clampUtf8 } from './utils/byte-length.js';
export { idbRequestToPromise, idbTransactionDone } from './utils/idb-promise.js';
export { InteractionService } from './services/interaction-service.js';
export { AgentContextPackService } from './services/agent-context-pack-service.js';
export type { AgentContextPackDeps } from './services/agent-context-pack-service.js';

// --- Logger ---
export { Logger, setLogHandler, resetLogHandler } from './services/logger.js';

// --- Utilities ---
export { extractJsonFromLlm } from './utils/extract-json.js';
export { generateId, projectThreadId } from './utils/generate-id.js';
export { globToRegex, matchCostRate } from './utils/glob-match.js';

// --- Errors ---
export { OffisimError, LlmError, GraphError, DataError } from './errors.js';

// --- Runtime (browser-safe parts) ---
export { WORKSTATION_ACCESS_DENIED } from './runtime/tool-executor.js';
export { TOOL_PERMISSION_DENIED, TOOL_PERMISSION_REQUIRED } from './runtime/tool-executor.js';
export { ToolPermissionEngine } from './permissions/tool-permission-engine.js';
export { HookRegistry } from './runtime/hook-registry.js';
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
  BrowserFsAccessFileSystem,
  browserFsAccessSupported,
  clearStoredBrowserVaultDirectoryHandle,
  createIndexedDbBrowserVaultHandleStore,
  createInMemoryBrowserVaultHandleStore,
  loadStoredBrowserVaultDirectoryHandle,
  persistBrowserVaultDirectoryHandle,
  pickBrowserVaultDirectory,
  queryBrowserVaultPermission,
  requestBrowserVaultPermission,
} from './vault/browser-fs.js';
export type {
  BrowserVaultDirectoryStatus,
  BrowserVaultHandleStore,
  BrowserVaultMode,
  BrowserVaultPermissionState,
} from './vault/browser-fs.js';
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
export { SkillLoader, SkillInstallError, encodeSkillSourceRef } from './skills/skill-loader.js';
export type {
  SkillLoaderDeps,
  InstallSkillArgs,
  InstallSkillResult,
  SkillInstallAsset,
  SkillInstallSource,
  SkillInstallSourceGit,
  SkillInstallSourceUpload,
  SkillInstallSourceClaudeCode,
  SkillInstallSourceCodex,
  SkillInstallSourceMarketplace,
} from './skills/skill-loader.js';
export { parseSkillMd, serializeSkillMd } from './skills/skill-md.js';
export type { ParsedSkillMd, SerializeInput } from './skills/skill-md.js';
export { skillSlug } from './skills/skill-slug.js';
export { resolveSkillPath } from './skills/skill-path.js';
export type { ResolveSkillPathArgs, ResolvedSkillPath } from './skills/skill-path.js';
export { migrateRuntimeSkills, onVaultReadyForSkills } from './skills/skills-bootstrap.js';
export { scanSkillDir } from './skills/skill-scanner.js';
export { resolveUploadSource } from './skills/skill-source-resolvers/upload.js';
export { resolveGitSource } from './skills/skill-source-resolvers/git.js';
export { resolveClaudeCodeSync } from './skills/skill-source-resolvers/claude-code.js';
export { resolveCodexSync } from './skills/skill-source-resolvers/codex.js';
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
  LocalDirAdapter,
  SyncCandidate,
  SyncResolverDeps,
  SyncResolverResult,
} from './skills/skill-source-resolvers/claude-code.js';
export { SkillStagingManager } from './skills/skill-staging.js';
export type { StagedSkill, SkillStagingManagerOpts } from './skills/skill-staging.js';
export type {
  SkillInstallEnvironment,
  UploadRefResolver,
} from './skills/skill-install-environment.js';
export { SkillInstallCommitter } from './skills/skill-install-committer.js';
export type { SkillInstallCommitterDeps } from './skills/skill-install-committer.js';
export {
  SKILL_INSTALL_TOOL_NAMES,
  SKILL_INSTALL_TOOL_DEFS,
  buildSkillInstallTools,
  handleSkillInstallTool,
  isSkillInstallTool,
} from './agents/skill-install-tools.js';
export type { SkillInstallToolName } from './agents/skill-install-tools.js';
export type {
  SkillInstallConfirmHandler,
  SkillInstallConfirmOutcome,
} from './services/interaction-service.js';
export type {
  SkillRepository,
  SettingsRepository,
  NewSkill,
  SkillUpdate,
} from './runtime/repositories.js';
