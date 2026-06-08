import { useUiState } from '@/app/ui-state.js';
import { reposOrNull } from '@/data/adapters.js';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { ensureCompanyWorkspaceProjectId } from './ensure-default-workspace.js';

/**
 * On the real desktop backend, pre-select the first company/project from SQLite
 * so a user who picks "Enter" from the lifecycle front door lands in a populated
 * scope. The landing surface is the lifecycle front door (ui-state default), so
 * this never forces a surface. No-op only in a non-Tauri preview; release
 * repository failures must be visible.
 */
export function useRealDataBootstrap(): void {
  const setCompany = useUiState((s) => s.setCompany);
  const setProject = useUiState((s) => s.setProject);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const repos = await reposOrNull();
      if (!repos || cancelled) return;
      const companies = (await repos.companies.findAll()).filter((c) => c.status !== 'archived');
      const company = companies[0];
      if (!company || cancelled) return;
      setCompany(company.company_id);
      // Guarantee a project bound to a real workspace dir so the agent's
      // file/shell tools work the instant the user enters a chat (otherwise a
      // fresh company has no project and every tool fails closed).
      const projectId = await ensureCompanyWorkspaceProjectId(repos, company.company_id);
      if (projectId && !cancelled) setProject(projectId);
    })().catch((error: unknown) => {
      console.error('[offisim] desktop repository bootstrap failed', error);
      toast.error('Desktop data source unavailable', {
        description: error instanceof Error ? error.message : 'Repository initialization failed.',
      });
    });
    return () => {
      cancelled = true;
    };
  }, [setCompany, setProject]);
}
