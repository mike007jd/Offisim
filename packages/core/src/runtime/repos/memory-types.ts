import type { ChatThread, ZoneRow } from '@offisim/shared-types';
import type {
  AgentEventRow,
  CompactSummaryRow,
  CompanyRow,
  CompanyTemplateAssetRow,
  DeliverableSummaryRow,
  EmployeeRow,
  EmployeeVersionRow,
  GraphThreadRow,
  InteractionActiveRow,
  InteractionHistoryRow,
  LibraryDocumentRow,
  McpAuditRow,
  McpToolGrantRow,
  MeetingSessionRow,
  ModelCostRateRow,
  NewRuntimeEvent,
  NodeSummaryRow,
  OfficeLayoutRow,
  ProjectAssignmentRow,
  ProjectRow,
  RackRow,
  SkillRow,
  SlotRow,
  ToolPermissionApprovalRow,
  WorkstationRackRow,
  WorkstationRow,
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
  employees: EmployeeRow[];
  companies: CompanyRow[];
  meetings: MeetingSessionRow[];
  events: NewRuntimeEvent[];
  memories: ReturnType<InMemoryMemoryRepository['snapshot']>;
  mcpAudit: McpAuditRow[];
  mcpToolGrants: McpToolGrantRow[];
  toolPermissionApprovals: ToolPermissionApprovalRow[];
  nodeSummaries: NodeSummaryRow[];
  compactSummaries: CompactSummaryRow[];
  activeInteractions: InteractionActiveRow[];
  interactionHistory: InteractionHistoryRow[];
  employeeVersions: EmployeeVersionRow[];
  costRates: ModelCostRateRow[];
  companyTemplates: CompanyTemplateAssetRow[];
  racks: RackRow[];
  slots: SlotRow[];
  workstationRacks: WorkstationRackRow[];
  libraryDocuments: LibraryDocumentRow[];
  officeLayouts: OfficeLayoutRow[];
  zones: ZoneRow[];
  workstations?: WorkstationRow[];
  prefabInstances: ReturnType<ReturnType<typeof createMemoryPrefabRepository>['snapshot']>;
  projects: ProjectRow[];
  projectAssignments: ProjectAssignmentRow[];
  chatThreads: ChatThread[];
  agentEvents: AgentEventRow[];
  deliverables: DeliverableSummaryRow[];
  skills: SkillRow[];
}
