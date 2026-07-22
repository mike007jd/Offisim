import type { AssetBindingRepository } from '../repos/asset-binding-repository.js';
import type { InstallTransactionRepository } from '../repos/install-transaction-repository.js';
import type { InstalledAssetRepository } from '../repos/installed-asset-repository.js';
import type { InstalledPackageRepository } from '../repos/installed-package-repository.js';
import type { PrefabInstanceRepository } from '../repos/prefab-instance-repository.js';
import type { ZoneRepository } from '../repos/zone-repository.js';
import type {
  CollaborationMemberRepository,
  CollaborationMessageRepository,
  CollaborationReadStateRepository,
  CollaborationThreadRepository,
  CollaborationTurnRepository,
} from './repositories/collaboration.js';
import type {
  CompanyRepository,
  CompanyTemplateAssetRepository,
  EmployeeRepository,
  EmployeeVersionRepository,
  OfficeLayoutRepository,
  ProjectAssignmentRepository,
  ProjectRepository,
  WorkstationRepository,
} from './repositories/company.js';
import type {
  LoopDefinitionRepository,
  LoopInvocationRepository,
  LoopRevisionRepository,
  LoopSkillBindingRepository,
} from './repositories/loop.js';
import type {
  McpAuditRepository,
  McpToolGrantRepository,
  RackRepository,
  SlotRepository,
  ToolPermissionApprovalRepository,
  WorkstationRackRepository,
} from './repositories/mcp.js';
import type {
  CompactSummaryRepository,
  EmployeeProjectMemoryRepository,
  LibraryDocumentRepository,
  MemoryRepository,
  NodeSummaryRepository,
} from './repositories/memory.js';
import type {
  MissionAttemptRepository,
  MissionCriterionRepository,
  MissionEvaluationRepository,
  MissionEventRepository,
  MissionRepository,
  RuntimeSessionLinkRepository,
} from './repositories/mission.js';
import type {
  AgentEventRepository,
  AgentRunRepository,
  CompetitiveDraftAttemptRepository,
  CompetitiveDraftGroupRepository,
  DeliverableRepository,
  EventRepository,
  MeetingRepository,
} from './repositories/run.js';
import type {
  ModelCostRateRepository,
  SettingsRepository,
  SkillRepository,
} from './repositories/settings.js';
import type {
  ActiveInteractionRepository,
  ChatThreadRepository,
  InteractionHistoryRepository,
  PiMessageRepository,
  ThreadRepository,
} from './repositories/thread.js';

export * from './repositories/company.js';
export * from './repositories/thread.js';
export * from './repositories/run.js';
export * from './repositories/mission.js';
export * from './repositories/loop.js';
export * from './repositories/collaboration.js';
export * from './repositories/mcp.js';
export * from './repositories/memory.js';
export * from './repositories/settings.js';

/** Aggregated access point */
export interface RuntimeRepositories {
  companies: CompanyRepository;
  threads: ThreadRepository;
  employees: EmployeeRepository;
  meetings: MeetingRepository;
  events: EventRepository;
  installTransactions: InstallTransactionRepository;
  installedPackages: InstalledPackageRepository;
  installedAssets: InstalledAssetRepository;
  assetBindings: AssetBindingRepository;
  memories: MemoryRepository;
  mcpAudit: McpAuditRepository;
  mcpToolGrants: McpToolGrantRepository;
  toolPermissionApprovals: ToolPermissionApprovalRepository;
  nodeSummaries: NodeSummaryRepository;
  compactSummaries: CompactSummaryRepository;
  activeInteractions: ActiveInteractionRepository;
  interactionHistory: InteractionHistoryRepository;
  employeeVersions: EmployeeVersionRepository;
  costRates: ModelCostRateRepository;
  companyTemplates: CompanyTemplateAssetRepository;
  racks: RackRepository;
  slots: SlotRepository;
  workstationRacks: WorkstationRackRepository;
  libraryDocuments: LibraryDocumentRepository;
  officeLayouts: OfficeLayoutRepository;
  prefabInstances: PrefabInstanceRepository;
  zones: ZoneRepository;
  /** Workstation rows (zone-level home seats + future desk anchors). */
  workstations: WorkstationRepository;
  projects: ProjectRepository;
  projectAssignments: ProjectAssignmentRepository;
  chatThreads: ChatThreadRepository;
  /** Agent event sourcing. */
  agentEvents: AgentEventRepository;
  /** Deliverable artifact history. */
  deliverables: DeliverableRepository;
  /** Two-tier skills (company-global + employee-specific). */
  skills: SkillRepository;
  /** Generic key-value settings (bootstrap markers). */
  settings: SettingsRepository;
  /**
   * Wraps a synchronous callback in a DB transaction.
   * Only available on Drizzle (better-sqlite3) repos — memory repos omit this.
   * All repo .run() calls inside the callback share the same SQLite transaction.
   */
  transact?<T>(fn: () => T): T;
  /**
   * Async variant of {@link transact}. Available on every backend (Drizzle,
   * Tauri sqlite-proxy, in-memory). Use this whenever a multi-write flow
   * needs to run inside one logical transaction and the body has any awaits.
   *
   * - Drizzle (Node): wraps in a real `better-sqlite3` transaction.
   * - Tauri sqlite-proxy: queues writes and commits them in a single
   *   `local_db_execute_transaction` IPC call. SELECTs inside the callback
   *   read committed state (no read-your-own-write isolation).
   * - In-memory: no-op — calls fn() directly.
   */
  asyncTransact<T>(fn: (txRepos?: RuntimeRepositories) => Promise<T>): Promise<T>;

  /** pi-kernel per-message transcript persistence. */
  piMessages: PiMessageRepository;
  /** Multi-agent delegation run tree. */
  agentRuns: AgentRunRepository;
  /** Best-of-N drafting groups projected over independent root agent runs. */
  competitiveDraftGroups: CompetitiveDraftGroupRepository;
  competitiveDraftAttempts: CompetitiveDraftAttemptRepository;
  /** Employee × Project experience used by W6 distillation and injection. */
  employeeProjectMemories: EmployeeProjectMemoryRepository;
  /** Verified Missions core (PRD §17). */
  missions: MissionRepository;
  missionCriteria: MissionCriterionRepository;
  missionAttempts: MissionAttemptRepository;
  missionEvaluations: MissionEvaluationRepository;
  runtimeSessionLinks: RuntimeSessionLinkRepository;
  missionEvents: MissionEventRepository;
  /** Loop domain (PR-07). */
  loopDefinitions: LoopDefinitionRepository;
  loopRevisions: LoopRevisionRepository;
  loopSkillBindings: LoopSkillBindingRepository;
  loopInvocations: LoopInvocationRepository;
  /** Company-scoped Collaboration chat (PR-02). */
  collaborationThreads: CollaborationThreadRepository;
  collaborationMembers: CollaborationMemberRepository;
  collaborationMessages: CollaborationMessageRepository;
  collaborationReadState: CollaborationReadStateRepository;
  collaborationTurns: CollaborationTurnRepository;
}
