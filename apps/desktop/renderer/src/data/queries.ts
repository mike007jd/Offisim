import { useUiState } from '@/app/ui-state.js';
import { resolveAsync } from '@/lib/platform.js';
import { getBuiltinPrefab } from '@offisim/renderer';
import type { PrefabDefinition } from '@offisim/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { companyToVm, employeeToVm, projectToVm, reposOrNull, threadToVm } from './adapters.js';
import { companyTemplates } from './company-templates.js';
import {
  boardTasks,
  companies,
  deliverables,
  employeeSkills,
  employees,
  gitWorkbenches,
  messages,
  officeScene,
  projectFiles,
  projects,
  runCost,
  threads,
  unfinishedThreads,
  usageSeries,
} from './fixtures.js';
import type { ChatMessage, FileNode, Skill, UsagePoint } from './types.js';

/**
 * Query hooks over the renderer data source. Today they resolve fixtures; the
 * query keys and shapes are the integration seam for sandboxed Tauri commands.
 */

export function useCompanies() {
  return useQuery({
    queryKey: ['companies'],
    queryFn: async () => {
      const repos = await reposOrNull();
      if (!repos) return resolveAsync(companies);
      const rows = await repos.companies.findAll();
      return rows.filter((c) => c.status !== 'archived').map(companyToVm);
    },
  });
}

export function useCompanyTemplates() {
  return useQuery({
    queryKey: ['company-templates'],
    queryFn: () => resolveAsync(companyTemplates),
  });
}

export function useProjects(companyId: string | null) {
  return useQuery({
    queryKey: ['projects', companyId],
    queryFn: async () => {
      const repos = await reposOrNull();
      if (!repos) return resolveAsync(projects.filter((p) => p.companyId === companyId));
      const rows = await repos.projects.findByCompany(companyId ?? '');
      return rows.map(projectToVm);
    },
    enabled: companyId !== null,
  });
}

export function useEmployees() {
  const companyId = useUiState((s) => s.companyId);
  return useQuery({
    queryKey: ['employees', companyId],
    queryFn: async () => {
      const repos = await reposOrNull();
      if (!repos) return resolveAsync(employees);
      const rows = await repos.employees.findByCompany(companyId);
      return rows.map(employeeToVm);
    },
  });
}

/** Reassign an employee to a zone (their workstation) — persists to SQLite and
 *  refreshes the roster + office layout. */
export function useReassignEmployee() {
  const queryClient = useQueryClient();
  const companyId = useUiState((s) => s.companyId);
  return useMutation({
    mutationFn: async ({ employeeId, zoneId }: { employeeId: string; zoneId: string }) => {
      const repos = await reposOrNull();
      if (!repos) return;
      await repos.employees.update(employeeId, { workstation_id: zoneId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees', companyId] });
      queryClient.invalidateQueries({ queryKey: ['office-layout', companyId] });
    },
  });
}

export function useEmployeeSkills(employeeId: string | null) {
  return useQuery({
    queryKey: ['employee-skills', employeeId],
    queryFn: () => resolveAsync<Skill[]>(employeeId ? (employeeSkills[employeeId] ?? []) : []),
    enabled: employeeId !== null,
  });
}

export function useThreads(projectId: string | null) {
  return useQuery({
    queryKey: ['threads', projectId],
    queryFn: async () => {
      const repos = await reposOrNull();
      if (!repos) return resolveAsync(threads.filter((t) => t.projectId === projectId));
      const rows = await repos.chatThreads.listByProject(projectId ?? '');
      return rows.map(threadToVm);
    },
    enabled: projectId !== null,
  });
}

export function useMessages(threadId: string | null) {
  return useQuery({
    queryKey: ['messages', threadId],
    queryFn: async () => {
      const repos = await reposOrNull();
      // Chat messages are not a persisted DB table — they are produced live by
      // the agent runtime. A real (un-run) thread therefore has no history yet,
      // so the real backend yields an empty conversation rather than fixtures.
      if (repos) return [] as ChatMessage[];
      return resolveAsync<ChatMessage[]>(threadId ? (messages[threadId] ?? []) : []);
    },
    enabled: threadId !== null,
  });
}

export function useDeliverables() {
  const companyId = useUiState((s) => s.companyId);
  return useQuery({
    queryKey: ['deliverables', companyId],
    queryFn: async () => {
      const repos = await reposOrNull();
      if (!repos?.deliverables) return resolveAsync(deliverables);
      const rows = await repos.deliverables.listByCompany(companyId, { limit: 100 });
      return rows.map((r) => ({
        id: r.deliverable_id,
        name: r.title,
        kind: r.kind ?? 'doc',
        contributorIds: [] as string[],
      }));
    },
  });
}

export function useUsageSeries() {
  return useQuery({
    queryKey: ['usage-series'],
    queryFn: () => resolveAsync<UsagePoint[]>(usageSeries),
  });
}

export function useRunCost() {
  return useQuery({ queryKey: ['run-cost'], queryFn: () => resolveAsync(runCost) });
}

export function useUnfinishedThreads() {
  return useQuery({
    queryKey: ['unfinished-threads'],
    queryFn: async () => {
      const repos = await reposOrNull();
      // A freshly bootstrapped real backend has no prior unfinished runs.
      if (repos) return [];
      return resolveAsync(unfinishedThreads);
    },
  });
}

export function useOfficeScene() {
  return useQuery({ queryKey: ['office-scene'], queryFn: () => resolveAsync(officeScene) });
}

/** Real office layout: zones + enabled prefab instances (paired with catalog
 *  definitions). Null in non-Tauri/dev so the scene falls back to its synthetic
 *  layout. */
export function useOfficeLayout(companyId: string | null) {
  return useQuery({
    queryKey: ['office-layout', companyId],
    queryFn: async () => {
      const repos = await reposOrNull();
      if (!repos) return null;
      const [zones, prefabRows] = await Promise.all([
        repos.zones.findByCompany(companyId ?? ''),
        repos.prefabInstances.findByCompany(companyId ?? ''),
      ]);
      const prefabs = prefabRows
        .filter((r) => r.enabled)
        .map((instance) => ({ instance, definition: getBuiltinPrefab(instance.prefab_id) }))
        .filter((p): p is { instance: (typeof prefabRows)[number]; definition: PrefabDefinition } =>
          Boolean(p.definition),
        );
      return { zones, prefabs };
    },
    enabled: companyId !== null,
  });
}

export function useBoardTasks() {
  return useQuery({ queryKey: ['board-tasks'], queryFn: () => resolveAsync(boardTasks) });
}

export function useProjectFiles(projectId: string | null) {
  return useQuery({
    queryKey: ['project-files', projectId],
    queryFn: () => resolveAsync<FileNode[]>(projectId ? (projectFiles[projectId] ?? []) : []),
    enabled: projectId !== null,
  });
}

export function useGitWorkbench(projectId: string | null) {
  return useQuery({
    queryKey: ['git-workbench', projectId],
    queryFn: () => resolveAsync(projectId ? (gitWorkbenches[projectId] ?? null) : null),
    enabled: projectId !== null,
  });
}
