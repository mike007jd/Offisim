import type { ProjectRow } from '@aics/shared-types';
import { useCallback, useEffect, useState } from 'react';

interface UseProjectsOptions {
  repos: { projects: { findByCompany: (companyId: string) => Promise<ProjectRow[]> } } | null;
  companyId: string;
}

export function useProjects({ repos, companyId }: UseProjectsOptions) {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  useEffect(() => {
    if (!repos?.projects) {
      setProjects([]);
      setActiveProjectId(null);
      return;
    }

    let cancelled = false;
    setProjects([]);
    setActiveProjectId(null);

    void repos.projects.findByCompany(companyId).then((nextProjects) => {
      if (!cancelled) {
        setProjects(nextProjects);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [repos, companyId]);

  const refresh = useCallback(async () => {
    if (!repos?.projects) return;
    const result = await repos.projects.findByCompany(companyId);
    setProjects(result);
  }, [repos, companyId]);

  const activeProject = projects.find((p) => p.project_id === activeProjectId) ?? null;

  return { projects, activeProject, activeProjectId, setActiveProjectId, refresh };
}
