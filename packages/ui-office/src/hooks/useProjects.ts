import type { RuntimeRepositories } from '@offisim/core/browser';
import { generateId, projectThreadId } from '@offisim/core/browser';
import type { ProjectRow } from '@offisim/shared-types';
import { useCallback, useEffect, useState } from 'react';

interface UseProjectsOptions {
  repos:
    | (Pick<RuntimeRepositories, 'projects'> & Partial<Pick<RuntimeRepositories, 'threads'>>)
    | null;
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

  const createProject = useCallback(
    async (name: string, description?: string): Promise<ProjectRow> => {
      if (!repos?.threads) throw new Error('Runtime not ready');
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
          description: description ?? null,
          status: 'planning',
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

  const activeProject = projects.find((p) => p.project_id === activeProjectId) ?? null;

  return { projects, activeProject, activeProjectId, setActiveProjectId, createProject, refresh };
}
