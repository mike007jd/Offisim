import type { EventBus } from '../events/event-bus.js';
import { createAgentEventsMemoryRepos } from './repos/agent-events/memory.js';
import { createAgentRunsMemoryRepos } from './repos/agent-runs/memory.js';
import { createConversationsMemoryRepos } from './repos/conversations/memory.js';
import type { DeliverableContentLoader } from './repos/deliverables/memory.js';
import { createDeliverablesMemoryRepos } from './repos/deliverables/memory.js';
import { createEmployeesMemoryRepos } from './repos/employees/memory.js';
import { createFilesMemoryRepos } from './repos/files/memory.js';
import { createMemoryInstallRepositories } from './repos/install/memory.js';
import { createLlmMemoryRepos } from './repos/llm/memory.js';
import { createMemorySystemMemoryRepos } from './repos/memory-system/memory.js';
import type { MemoryRepositoriesSnapshot, MemoryRepositorySeed } from './repos/memory-types.js';
import { createOrchestrationMemoryRepos } from './repos/orchestration/memory.js';
import { createPermissionsMemoryRepos } from './repos/permissions/memory.js';
import { createPiMessagesMemoryRepo } from './repos/pi-messages/memory.js';
import { createProjectsMemoryRepos } from './repos/projects/memory.js';
import { createSkillsMemoryRepos } from './repos/skills/memory.js';
import { createWorkspaceMemoryRepos } from './repos/workspace/memory.js';
import type { RuntimeRepositories } from './repositories.js';

export {
  MemoryAgentEventRepository,
  MemoryRecoveryKnowledgeRepository,
} from './repos/agent-events/memory.js';
export { MemoryDeliverableRepository } from './repos/deliverables/memory.js';
export { MemorySkillRepository } from './repos/skills/memory.js';
export {
  MemoryActiveInteractionRepository,
  MemoryHandoffRepository,
  MemoryInteractionHistoryRepository,
  MemoryMeetingRepository,
  MemoryToolCallRepository,
} from './repos/conversations/memory.js';
export {
  MemoryEmployeeRepository,
  MemoryEmployeeVersionRepository,
} from './repos/employees/memory.js';
export {
  MemoryFileHistoryRepository,
  MemoryLibraryDocumentRepository,
} from './repos/files/memory.js';
export {
  MemoryAssetBindingRepository,
  MemoryInstallTransactionRepository,
  MemoryInstalledAssetRepository,
  MemoryInstalledPackageRepository,
} from './repos/install/memory.js';
export {
  MemoryLlmCallRepository,
  MemoryModelCostRateRepository,
} from './repos/llm/memory.js';
export {
  MemoryCompactSummaryRepository,
  MemoryNodeSummaryRepository,
} from './repos/memory-system/memory.js';
export {
  MemoryCompanyRepository,
  MemoryEventRepository,
  MemoryTaskRunRepository,
  MemoryThreadRepository,
} from './repos/orchestration/memory.js';
export {
  MemoryMcpAuditRepository,
  MemoryRackRepository,
  MemorySlotRepository,
  MemoryToolPermissionApprovalRepository,
  MemoryWorkstationRackRepository,
} from './repos/permissions/memory.js';
export {
  MemoryProjectAssignmentRepository,
  MemoryProjectRepository,
} from './repos/projects/memory.js';
export {
  MemoryOfficeLayoutRepository,
  MemoryPrefabInstanceRepository,
  MemoryZoneRepository,
} from './repos/workspace/memory.js';
export type { MemoryRepositoriesSnapshot, MemoryRepositorySeed } from './repos/memory-types.js';

export function createMemoryRepositories(
  snapshot?: Partial<MemoryRepositoriesSnapshot>,
  deliverableContentLoader?: DeliverableContentLoader,
  _eventBus?: EventBus,
): RuntimeRepositories & { seed: MemoryRepositorySeed; snapshot(): MemoryRepositoriesSnapshot } {
  const orchestration = createOrchestrationMemoryRepos(snapshot);
  const employeesFamily = createEmployeesMemoryRepos(snapshot);
  const conversationsFamily = createConversationsMemoryRepos(snapshot);
  const llmFamily = createLlmMemoryRepos(snapshot);
  const installFamily = createMemoryInstallRepositories(snapshot);
  const permissionsFamily = createPermissionsMemoryRepos(snapshot);
  const memorySystemFamily = createMemorySystemMemoryRepos(snapshot);
  const filesFamily = createFilesMemoryRepos(snapshot);
  const workspaceFamily = createWorkspaceMemoryRepos(snapshot);
  const projectsFamily = createProjectsMemoryRepos(snapshot);
  const agentEventsFamily = createAgentEventsMemoryRepos(snapshot);
  const agentRunsFamily = createAgentRunsMemoryRepos();
  const deliverablesFamily = createDeliverablesMemoryRepos(snapshot, deliverableContentLoader);
  const skillsFamily = createSkillsMemoryRepos(snapshot);

  const seed: MemoryRepositorySeed = {
    employees(rows) {
      employeesFamily.employees.seed(rows);
    },
    companies(rows) {
      orchestration.companies.seed(rows);
    },
  };

  return {
    ...orchestration,
    ...employeesFamily,
    ...conversationsFamily,
    ...llmFamily,
    ...installFamily,
    ...permissionsFamily,
    ...memorySystemFamily,
    ...filesFamily,
    ...workspaceFamily,
    ...projectsFamily,
    ...agentEventsFamily,
    ...agentRunsFamily,
    ...deliverablesFamily,
    ...skillsFamily,
    piMessages: createPiMessagesMemoryRepo(),
    // In-memory repos have no transactional boundary — every write is already
    // applied to the snapshot Map. asyncTransact is a passthrough so that
    // shared code can call it without branching on backend type.
    async asyncTransact<T>(fn: (txRepos?: RuntimeRepositories) => Promise<T>): Promise<T> {
      return fn();
    },
    seed,
    snapshot(): MemoryRepositoriesSnapshot {
      return {
        companies: orchestration.companies.snapshot(),
        threads: orchestration.threads.snapshot(),
        taskRuns: orchestration.taskRuns.snapshot(),
        events: orchestration.events.snapshot(),
        employees: employeesFamily.employees.snapshot(),
        employeeVersions: employeesFamily.employeeVersions.snapshot(),
        toolCalls: conversationsFamily.toolCalls.snapshot(),
        handoffs: conversationsFamily.handoffs.snapshot(),
        meetings: conversationsFamily.meetings.snapshot(),
        activeInteractions: conversationsFamily.activeInteractions.snapshot(),
        interactionHistory: conversationsFamily.interactionHistory.snapshot(),
        llmCalls: llmFamily.llmCalls.snapshot(),
        costRates: llmFamily.costRates.snapshot(),
        installTransactions: installFamily.installTransactions.snapshot(),
        installedPackages: installFamily.installedPackages.snapshot(),
        installedAssets: installFamily.installedAssets.snapshot(),
        assetBindings: installFamily.assetBindings.snapshot(),
        racks: permissionsFamily.racks.snapshot(),
        slots: permissionsFamily.slots.snapshot(),
        workstationRacks: permissionsFamily.workstationRacks.snapshot(),
        mcpAudit: permissionsFamily.mcpAudit.snapshot(),
        toolPermissionApprovals: permissionsFamily.toolPermissionApprovals.snapshot(),
        memories: memorySystemFamily.memories.snapshot(),
        nodeSummaries: memorySystemFamily.nodeSummaries.snapshot(),
        compactSummaries: memorySystemFamily.compactSummaries.snapshot(),
        fileHistory: filesFamily.fileHistory.snapshot(),
        libraryDocuments: filesFamily.libraryDocuments.snapshot(),
        companyTemplates: workspaceFamily.companyTemplates.snapshot(),
        officeLayouts: workspaceFamily.officeLayouts.snapshot(),
        prefabInstances: workspaceFamily.prefabInstances.snapshot(),
        zones: workspaceFamily.zones.snapshot(),
        projects: projectsFamily.projects.snapshot(),
        projectAssignments: projectsFamily.projectAssignments.snapshot(),
        chatThreads: projectsFamily.chatThreads.snapshot(),
        agentEvents: agentEventsFamily.agentEvents.snapshot(),
        recoveryKnowledge: agentEventsFamily.recoveryKnowledge.snapshot(),
        deliverables: deliverablesFamily.deliverables.snapshot(),
        skills: skillsFamily.skills.snapshot(),
      };
    },
  };
}
