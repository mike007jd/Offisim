import type { RuntimeRepositories } from '@offisim/core/browser';
import { generateId } from '@offisim/core/browser';
import { type ProjectRow, trimToNull } from '@offisim/shared-types';
import { useCallback, useEffect, useState } from 'react';

interface UseProjectsOptions {
  repos:
    | (Pick<RuntimeRepositories, 'projects'> & Partial<Pick<RuntimeRepositories, 'chatThreads'>>)
    | null;
  companyId: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string | null;
  workspaceRoot?: string | null;
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

  const createProject = useCallback(
    async (input: CreateProjectInput): Promise<ProjectRow> => {
      if (!repos?.projects || !repos?.chatThreads) throw new Error('Runtime not ready');
      const name = input.name.trim();
      if (!name) throw new Error('Project name must not be empty');

      const pid = generateId('proj');
      const project = await repos.projects.create({
        project_id: pid,
        company_id: companyId,
        name,
        description: trimToNull(input.description),
        status: 'planning',
        workspace_root: trimToNull(input.workspaceRoot),
      });
      // Bootstrap the project's first chat thread; runtime graph_threads are
      // created lazily on first chat send via OrchestrationService.ensureGraphThread.
      await repos.chatThreads.create({
        thread_id: generateId('thread'),
        project_id: pid,
      });
      setProjects((prev) => [...prev, project]);
      return project;
    },
    [repos, companyId],
  );

  const updateProject = useCallback(
    async (
      projectId: string,
      patch: {
        name?: string;
        description?: string | null;
        workspace_root?: string | null;
      },
    ): Promise<void> => {
      if (!repos?.projects) throw new Error('Runtime not ready');
      const sanitized: typeof patch = {};
      if (patch.name !== undefined) {
        const trimmed = patch.name.trim();
        if (!trimmed) throw new Error('Project name must not be empty');
        sanitized.name = trimmed;
      }
      if (patch.description !== undefined) {
        sanitized.description = trimToNull(patch.description);
      }
      if (patch.workspace_root !== undefined) {
        sanitized.workspace_root = trimToNull(patch.workspace_root);
      }
      if (Object.keys(sanitized).length === 0) return;
      await repos.projects.update(projectId, sanitized);
      const ts = new Date().toISOString();
      setProjects((prev) =>
        prev.map((p) => (p.project_id === projectId ? { ...p, ...sanitized, updated_at: ts } : p)),
      );
    },
    [repos],
  );

  const activeProject = projects.find((p) => p.project_id === activeProjectId) ?? null;

  return {
    projects,
    activeProject,
    activeProjectId,
    setActiveProjectId,
    createProject,
    updateProject,
    refresh,
  };
}
