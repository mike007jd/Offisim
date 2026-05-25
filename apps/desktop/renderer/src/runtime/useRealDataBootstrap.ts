import { useUiState } from '@/app/ui-state.js';
import { reposOrNull } from '@/data/adapters.js';
import { useEffect } from 'react';

/**
 * On the real desktop backend, point the UI at the seeded company/project from
 * SQLite (replacing the fixture default ids). No-op in a non-Tauri dev webview,
 * where the fixture defaults stand in.
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
    })().catch(() => {
      /* backend unavailable — keep fixture defaults */
    });
    return () => {
      cancelled = true;
    };
  }, [setCompany, setProject]);
}
