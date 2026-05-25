import { resolveAsync } from '@/lib/platform.js';
import { useQuery } from '@tanstack/react-query';
import {
  activityEvents,
  companies,
  deliverables,
  employeeSkills,
  employees,
  listings,
  messages,
  projectFiles,
  projects,
  runCost,
  sopStages,
  sops,
  threads,
  usageSeries,
} from './fixtures.js';
import type { ChatMessage, FileNode, Skill, SopStage, UsagePoint } from './types.js';

/**
 * Query hooks over the renderer data source. Today they resolve fixtures; the
 * query keys and shapes are the integration seam for sandboxed Tauri commands.
 */

export function useCompanies() {
  return useQuery({ queryKey: ['companies'], queryFn: () => resolveAsync(companies) });
}

export function useProjects(companyId: string | null) {
  return useQuery({
    queryKey: ['projects', companyId],
    queryFn: () => resolveAsync(projects.filter((p) => p.companyId === companyId)),
    enabled: companyId !== null,
  });
}

export function useEmployees() {
  return useQuery({ queryKey: ['employees'], queryFn: () => resolveAsync(employees) });
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
    queryFn: () => resolveAsync(threads.filter((t) => t.projectId === projectId)),
    enabled: projectId !== null,
  });
}

export function useMessages(threadId: string | null) {
  return useQuery({
    queryKey: ['messages', threadId],
    queryFn: () => resolveAsync<ChatMessage[]>(threadId ? (messages[threadId] ?? []) : []),
    enabled: threadId !== null,
  });
}

export function useDeliverables() {
  return useQuery({ queryKey: ['deliverables'], queryFn: () => resolveAsync(deliverables) });
}

export function useSops() {
  return useQuery({ queryKey: ['sops'], queryFn: () => resolveAsync(sops) });
}

export function useSopStages(sopId: string | null) {
  return useQuery({
    queryKey: ['sop-stages', sopId],
    queryFn: () => resolveAsync<SopStage[]>(sopId ? (sopStages[sopId] ?? []) : []),
    enabled: sopId !== null,
  });
}

export function useListings() {
  return useQuery({ queryKey: ['listings'], queryFn: () => resolveAsync(listings) });
}

export function useActivityEvents() {
  return useQuery({ queryKey: ['activity'], queryFn: () => resolveAsync(activityEvents) });
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

export function useProjectFiles(projectId: string | null) {
  return useQuery({
    queryKey: ['project-files', projectId],
    queryFn: () => resolveAsync<FileNode[]>(projectId ? (projectFiles[projectId] ?? []) : []),
    enabled: projectId !== null,
  });
}
