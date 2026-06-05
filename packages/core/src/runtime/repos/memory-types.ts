import type { ChatThread, ZoneRow } from '@offisim/shared-types';
import type {
  AgentEventRow,
  CompactSummaryRow,
  CompanyRow,
  CompanyTemplateAssetRow,
  DeliverableSummaryRow,
  EmployeeRow,
  EmployeeVersionRow,
  FileHistoryRow,
  GraphCheckpointRow,
  GraphThreadRow,
  HandoffEventRow,
  InteractionActiveRow,
  InteractionHistoryRow,
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
  TaskRunRow,
  ToolCallRow,
  ToolPermissionApprovalRow,
  WorkstationRackRow,
} from '../repositories.js';
import type { MemoryInstallRepositoriesSnapshot } from './install/memory.js';
import type { InMemoryMemoryRepository } from './memory-system/memory.js';
import type { createMemoryPrefabRepository } from './workspace/memory.js';

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
  mcpAudit: McpAuditRow[];
  toolPermissionApprovals: ToolPermissionApprovalRow[];
  nodeSummaries: NodeSummaryRow[];
  compactSummaries: CompactSummaryRow[];
  activeInteractions: InteractionActiveRow[];
  interactionHistory: InteractionHistoryRow[];
  fileHistory: FileHistoryRow[];
  employeeVersions: EmployeeVersionRow[];
  costRates: ModelCostRateRow[];
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
  agentEvents: AgentEventRow[];
  recoveryKnowledge: RecoveryKnowledgeRow[];
  deliverables: DeliverableSummaryRow[];
  skills: SkillRow[];
}
