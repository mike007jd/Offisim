import type { ChatThread, ZoneRow } from '@offisim/shared-types';
import type { InMemoryMemoryRepository } from '../../repositories/memory-memory-repository.js';
import type { MemoryInstallRepositoriesSnapshot } from '../memory-install-repos.js';
import type { createMemoryPrefabRepository } from '../memory-prefab-repository.js';
import type {
  AgentEventRow,
  CompanyTemplateAssetRow,
  CompactSummaryRow,
  CompanyRow,
  DeliverableSummaryRow,
  EmployeeRow,
  EmployeeVersionRow,
  FileHistoryRow,
  GraphCheckpointRow,
  GraphThreadRow,
  HandoffEventRow,
  InteractionActiveRow,
  InteractionHistoryRow,
  KanbanCardRow,
  LibraryDocumentRow,
  LlmCallRow,
  McpAuditRow,
  MeetingSessionRow,
  ModelCostRateRow,
  NewRuntimeEvent,
  NodeSummaryRow,
  OfficeLayoutRow,
  ProjectAssignmentRow,
  ProjectRow,
  RackRow,
  RecoveryKnowledgeRow,
  SkillRow,
  SlotRow,
  SopTemplateRow,
  TaskRunRow,
  ToolCallRow,
  ToolPermissionApprovalRow,
  UserPreferenceRow,
  WorkstationRackRow,
} from '../repositories.js';

export interface MemoryRepositorySeed {
  employees(rows: EmployeeRow[]): void;
  companies(rows: CompanyRow[]): void;
}

export interface MemoryRepositoriesSnapshot extends MemoryInstallRepositoriesSnapshot {
  threads: GraphThreadRow[];
  taskRuns: TaskRunRow[];
  employees: EmployeeRow[];
  companies: CompanyRow[];
  toolCalls: ToolCallRow[];
  handoffs: HandoffEventRow[];
  meetings: MeetingSessionRow[];
  checkpoints: GraphCheckpointRow[];
  events: NewRuntimeEvent[];
  llmCalls: LlmCallRow[];
  memories: ReturnType<InMemoryMemoryRepository['snapshot']>;
  userPreferences: UserPreferenceRow[];
  mcpAudit: McpAuditRow[];
  toolPermissionApprovals: ToolPermissionApprovalRow[];
  nodeSummaries: NodeSummaryRow[];
  compactSummaries: CompactSummaryRow[];
  activeInteractions: InteractionActiveRow[];
  interactionHistory: InteractionHistoryRow[];
  fileHistory: FileHistoryRow[];
  employeeVersions: EmployeeVersionRow[];
  costRates: ModelCostRateRow[];
  sopTemplates: SopTemplateRow[];
  companyTemplates: CompanyTemplateAssetRow[];
  racks: RackRow[];
  slots: SlotRow[];
  workstationRacks: WorkstationRackRow[];
  libraryDocuments: LibraryDocumentRow[];
  officeLayouts: OfficeLayoutRow[];
  zones: ZoneRow[];
  prefabInstances: ReturnType<ReturnType<typeof createMemoryPrefabRepository>['snapshot']>;
  projects: ProjectRow[];
  projectAssignments: ProjectAssignmentRow[];
  chatThreads: ChatThread[];
  kanbanCards: KanbanCardRow[];
  agentEvents: AgentEventRow[];
  recoveryKnowledge: RecoveryKnowledgeRow[];
  deliverables: DeliverableSummaryRow[];
  skills: SkillRow[];
}
