import type { QueryClient } from '@tanstack/react-query';

/**
 * Canonical TanStack Query keys for the desktop renderer.
 *
 * Every factory returns the exact tuple previously declared at its call site.
 * Prefix factories are intentionally separate so a broad invalidation never
 * gains an `undefined` segment by accident.
 */
export const queryKeys = {
  activityRecords: (companyId: string | null, projectIds: readonly string[]) =>
    ['activity-records', companyId, [...projectIds].sort()] as const,
  activityRecordsAll: () => ['activity-records'] as const,
  activityRecordsCompany: (companyId: string) => ['activity-records', companyId] as const,
  agentRuntimeModels: () => ['agent-runtime', 'models'] as const,
  agentRuntimeThreadAuthority: (threadId: string | null) =>
    ['agent-runtime', 'thread-authority', threadId] as const,
  codexPets: () => ['codex-pets'] as const,
  companies: () => ['companies'] as const,
  companyTemplates: () => ['company-templates'] as const,
  competitiveDraftAttemptByLease: (leaseId: string | undefined) =>
    ['competitive-draft-attempt-by-lease', leaseId] as const,
  competitiveDraftReview: (comparisonGroupId: string) =>
    ['competitive-draft-review', comparisonGroupId] as const,
  computerDriverStatus: () => ['computer-driver-status'] as const,
  connectMembers: (threadId: string | null) => ['connect', 'members', threadId] as const,
  connectMessages: (threadId: string | null) => ['connect', 'messages', threadId] as const,
  connectThreads: (companyId: string | null) => ['connect', 'threads', companyId] as const,
  deliverables: (companyId: string | null, threadId: string | null) =>
    ['deliverables', companyId, threadId] as const,
  deliverablesAll: () => ['deliverables'] as const,
  employeeExperience: (employeeId: string | null) =>
    ['personnel', 'experience', employeeId] as const,
  employeeMcpTools: (companyId: string | null, employeeId: string | null) =>
    ['employee-mcp-tools', companyId, employeeId] as const,
  employeeMcpToolsAll: () => ['employee-mcp-tools'] as const,
  employeeMemories: (employeeId: string | null) => ['personnel', 'memories', employeeId] as const,
  employeeSeniority: (companyId: string | null | undefined, employeeKey: string) =>
    ['employee-seniority', companyId, employeeKey] as const,
  employeeSeniorityCompany: (companyId: string | null) =>
    ['employee-seniority', companyId] as const,
  employeeSkills: (companyId: string | null, projectId: string | null, employeeId: string | null) =>
    ['employee-skills', companyId, projectId, employeeId] as const,
  employeeVersions: (employeeId: string | null) => ['personnel', 'versions', employeeId] as const,
  employees: (companyId: string | null) => ['employees', companyId] as const,
  employeesAll: () => ['employees'] as const,
  gitWorkbench: (projectId: string | null) => ['git-workbench', projectId] as const,
  globalSearch: (normalizedSearch: string) => ['global-search', normalizedSearch] as const,
  loop: (loopId: string | null) => ['loop', loopId] as const,
  loopChip: (loopId: string | null, revisionId: string | null) =>
    ['loop-chip', loopId, revisionId] as const,
  loopRevision: (revisionId: string | null) => ['loop-revision', revisionId] as const,
  loopRevisions: (loopId: string | null) => ['loop-revisions', loopId] as const,
  loopRuns: (companyId: string | null) => ['loop-runs', companyId] as const,
  loops: (companyId: string | null) => ['loops', companyId] as const,
  marketDrafts: () => ['market-drafts'] as const,
  marketInstalled: (companyId?: string | null) =>
    ['market-installed', companyId ?? 'preview'] as const,
  marketInstalledAll: () => ['market-installed'] as const,
  marketListings: (companyId?: string | null) =>
    ['market-listings', companyId ?? 'preview'] as const,
  marketListingsAll: () => ['market-listings'] as const,
  marketPublishSources: (companyId?: string | null) =>
    ['market-publish-sources', companyId ?? 'preview'] as const,
  marketRegistryConnection: () => ['market-registry-connection'] as const,
  messages: (threadId: string | null) => ['messages', threadId] as const,
  messagesAll: () => ['messages'] as const,
  missions: (companyId: string | null) => ['missions', companyId] as const,
  officeLayout: (companyId: string | null) => ['office-layout', companyId] as const,
  officeScene: () => ['office-scene'] as const,
  projectFiles: (projectId: string | null) => ['project-files', projectId] as const,
  projects: (companyId: string | null) => ['projects', companyId] as const,
  runCost: (companyId: string | null, threadId: string | null) =>
    ['run-cost', companyId, threadId] as const,
  runCostAll: () => ['run-cost'] as const,
  runCostCompany: (companyId: string) => ['run-cost', companyId] as const,
  settingsAgentRuntimeStatus: () => ['settings', 'agent-runtime-status'] as const,
  settingsAiAccountUsage: () => ['settings', 'ai-account-usage'] as const,
  settingsExternalEmployees: (companyId: string | null) =>
    ['settings', 'external-employees', companyId] as const,
  settingsMcpServers: () => ['settings', 'mcp-servers'] as const,
  settingsMcpToolGrants: (companyId: string | null, employeeId: string | null) =>
    ['settings', 'mcp-tool-grants', companyId, employeeId] as const,
  settingsMcpToolGrantsAll: () => ['settings', 'mcp-tool-grants'] as const,
  settingsPiProviderConfig: () => ['settings', 'pi-provider-config'] as const,
  settingsRuntimeVaultStatus: () => ['settings', 'runtime-vault-status'] as const,
  taskBoard: (companyId: string | null) => ['task-board', companyId] as const,
  threads: (projectId: string | null) => ['threads', projectId] as const,
  threadsAll: () => ['threads'] as const,
  tokenBudgets: (companyId: string | null) => ['token-budgets', companyId] as const,
  unfinishedThreads: () => ['unfinished-threads'] as const,
  workspaceLeaseReviews: (scopeProjectIds: readonly string[]) =>
    ['workspace-lease-reviews', scopeProjectIds] as const,
  workspaceLeaseReviewsAll: () => ['workspace-lease-reviews'] as const,
} as const;

export function invalidateCompanyDeletionScope(queryClient: QueryClient): Promise<unknown[]> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.companies() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.activityRecordsAll() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.threadsAll() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.messagesAll() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.deliverablesAll() }),
  ]);
}

export function invalidateConversationDeletionScope(
  queryClient: QueryClient,
  input: {
    projectId: string | null;
    threadId: string;
    companyId: string | null;
  },
): Promise<unknown[]> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.threads(input.projectId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.messages(input.threadId) }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.deliverables(input.companyId, input.threadId),
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.activityRecordsCompany(input.companyId ?? ''),
    }),
    queryClient.invalidateQueries({ queryKey: queryKeys.missions(input.companyId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.taskBoard(input.companyId) }),
  ]);
}
