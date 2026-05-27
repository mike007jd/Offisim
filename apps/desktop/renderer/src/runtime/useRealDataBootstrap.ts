import { useUiState } from '@/app/ui-state.js';
import { reposOrNull } from '@/data/adapters.js';
import { useEffect } from 'react';
import { toast } from 'sonner';

/**
 * On the real desktop backend, point the UI at the seeded company/project from
 * SQLite (replacing browser-preview default ids). No-op only in a non-Tauri
 * preview; release repository failures must be visible.
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
      // Switching to the real company invalidates the fixture-id selections that
      // ui-state seeds (emp-mara / th-team); clear them so components resolving a
      // selection against real rows get a clean "nothing selected".
      useUiState.setState({
        selectedEmployeeId: null,
        selectedThreadId: null,
        workspaceSelectedId: null,
      });
      setCompany(company.company_id);
      const projects = await repos.projects.findByCompany(company.company_id);
      const project = projects[0];
      if (project && !cancelled) setProject(project.project_id);
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
