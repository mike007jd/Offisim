import { useState, useEffect, useCallback } from 'react';
import type { ProjectRow } from '@aics/shared-types';

interface UseProjectsOptions {
  repos: { projects: { findByCompany: (companyId: string) => Promise<ProjectRow[]> } } | null;
  companyId: string;
}

export function useProjects({ repos, companyId }: UseProjectsOptions) {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  // Direct effect — no useCallback dependency loop.
  useEffect(() => {
    if (!repos?.projects) return;
    repos.projects.findByCompany(companyId).then(setProjects);
  }, [repos, companyId]);

  // Manual refresh for button-triggered reloads.
  const refresh = useCallback(async () => {
    if (!repos?.projects) return;
    const result = await repos.projects.findByCompany(companyId);
    setProjects(result);
  }, [repos, companyId]);

  // Reset selection when company changes
  useEffect(() => {
    setActiveProjectId(null);
  }, [companyId]);

  const activeProject = projects.find((p) => p.project_id === activeProjectId) ?? null;

  return { projects, activeProject, activeProjectId, setActiveProjectId, refresh };
}
