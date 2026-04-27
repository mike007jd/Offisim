import { createAgentEventsMemoryRepos } from './repos/agent-events/memory.js';
import { createConversationsMemoryRepos } from './repos/conversations/memory.js';
import type { DeliverableContentLoader } from './repos/deliverables/memory.js';
import { createDeliverablesMemoryRepos } from './repos/deliverables/memory.js';
import { createEmployeesMemoryRepos } from './repos/employees/memory.js';
import { createFilesMemoryRepos } from './repos/files/memory.js';
import { createInstallMemoryRepos } from './repos/install/memory.js';
import { createLlmMemoryRepos } from './repos/llm/memory.js';
import { createMemorySystemMemoryRepos } from './repos/memory-system/memory.js';
import type { MemoryRepositoriesSnapshot, MemoryRepositorySeed } from './repos/memory-types.js';
import { createOrchestrationMemoryRepos } from './repos/orchestration/memory.js';
import { createPermissionsMemoryRepos } from './repos/permissions/memory.js';
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
  MemoryCheckpointRepository,
  MemoryCompanyRepository,
  MemoryEventRepository,
  MemoryTaskRunRepository,
  MemoryThreadRepository,
} from './repos/orchestration/memory.js';
export {
  MemoryMcpAuditRepository,
  MemoryRackRepository,
  MemorySlotRepository,
  MemoryWorkstationRackRepository,
} from './repos/permissions/memory.js';
export {
  MemoryProjectAssignmentRepository,
  MemoryProjectRepository,
} from './repos/projects/memory.js';
export {
  MemoryOfficeLayoutRepository,
  MemoryPrefabInstanceRepository,
  MemorySopTemplateRepository,
  MemoryZoneRepository,
} from './repos/workspace/memory.js';
export type { MemoryRepositoriesSnapshot, MemoryRepositorySeed } from './repos/memory-types.js';

export function createMemoryRepositories(
  snapshot?: Partial<MemoryRepositoriesSnapshot>,
  deliverableContentLoader?: DeliverableContentLoader,
): RuntimeRepositories & { seed: MemoryRepositorySeed; snapshot(): MemoryRepositoriesSnapshot } {
  const orchestration = createOrchestrationMemoryRepos(snapshot);
  const employeesFamily = createEmployeesMemoryRepos(snapshot);
  const conversationsFamily = createConversationsMemoryRepos(snapshot);
  const llmFamily = createLlmMemoryRepos(snapshot);
  const installFamily = createInstallMemoryRepos(snapshot);
  const permissionsFamily = createPermissionsMemoryRepos(snapshot);
  const memorySystemFamily = createMemorySystemMemoryRepos(snapshot);
  const filesFamily = createFilesMemoryRepos(snapshot);
  const workspaceFamily = createWorkspaceMemoryRepos(snapshot);
  const projectsFamily = createProjectsMemoryRepos(snapshot);
  const agentEventsFamily = createAgentEventsMemoryRepos(snapshot);
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
    ...deliverablesFamily,
    ...skillsFamily,
    seed,
    snapshot(): MemoryRepositoriesSnapshot {
      return {
        companies: orchestration.companies.snapshot(),
        threads: orchestration.threads.snapshot(),
        taskRuns: orchestration.taskRuns.snapshot(),
        checkpoints: orchestration.checkpoints.snapshot(),
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
        memories: memorySystemFamily.memories.snapshot(),
        userPreferences: memorySystemFamily.userPreferences.snapshot(),
        nodeSummaries: memorySystemFamily.nodeSummaries.snapshot(),
        compactSummaries: memorySystemFamily.compactSummaries.snapshot(),
        fileHistory: filesFamily.fileHistory.snapshot(),
        libraryDocuments: filesFamily.libraryDocuments.snapshot(),
        sopTemplates: workspaceFamily.sopTemplates.snapshot(),
        officeLayouts: workspaceFamily.officeLayouts.snapshot(),
        prefabInstances: workspaceFamily.prefabInstances.snapshot(),
        zones: workspaceFamily.zones.snapshot(),
        projects: projectsFamily.projects.snapshot(),
        projectAssignments: projectsFamily.projectAssignments.snapshot(),
        agentEvents: agentEventsFamily.agentEvents.snapshot(),
        recoveryKnowledge: agentEventsFamily.recoveryKnowledge.snapshot(),
        deliverables: deliverablesFamily.deliverables.snapshot(),
        skills: skillsFamily.skills.snapshot(),
      };
    },
  };
}
