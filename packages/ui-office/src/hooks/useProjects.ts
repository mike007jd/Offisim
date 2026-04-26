import type { RuntimeRepositories } from '@offisim/core/browser';
import { generateId, projectThreadId } from '@offisim/core/browser';
import { type ProjectRow, trimToNull } from '@offisim/shared-types';
import { useCallback, useEffect, useState } from 'react';

interface UseProjectsOptions {
  repos:
    | (Pick<RuntimeRepositories, 'projects'> & Partial<Pick<RuntimeRepositories, 'threads'>>)
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
      if (!repos?.threads) throw new Error('Runtime not ready');
      const name = input.name.trim();
      if (!name) throw new Error('Project name must not be empty');

      const pid = generateId('proj');
      const tid = projectThreadId(pid);
      // Thread first — projects.thread_id FK references graph_threads
      await repos.threads.create({
        thread_id: tid,
        company_id: companyId,
        entry_mode: 'boss_chat',
        root_task_id: null,
        status: 'queued',
      });
      try {
        const project = await repos.projects.create({
          project_id: pid,
          company_id: companyId,
          thread_id: tid,
          name,
          description: trimToNull(input.description),
          status: 'planning',
          workspace_root: trimToNull(input.workspaceRoot),
        });
        setProjects((prev) => [...prev, project]);
        return project;
      } catch (err) {
        // Best-effort cleanup of orphaned thread
        await repos.threads.updateStatus(tid, 'completed').catch(() => {});
        throw err;
      }
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
