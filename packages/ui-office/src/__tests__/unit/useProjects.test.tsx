import type { ProjectRow } from '@offisim/shared-types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useProjects } from '../../hooks/useProjects.js';

function makeProject(overrides: Partial<ProjectRow> & { project_id: string }): ProjectRow {
  return {
    company_id: 'co-1',
    thread_id: null,
    name: `Project ${overrides.project_id}`,
    description: null,
    status: 'active',
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    ...overrides,
  };
}

const PROJECT_A = makeProject({ project_id: 'p-1', name: 'Alpha' });
const PROJECT_B = makeProject({ project_id: 'p-2', name: 'Beta' });

function makeRepos(projects: ProjectRow[] = []) {
  return {
    projects: {
      findByCompany: vi.fn().mockResolvedValue(projects),
    },
  };
}

describe('useProjects', () => {
  it('returns empty projects initially before fetch resolves', async () => {
    let resolveFetch!: (val: ProjectRow[]) => void;
    const pendingRepos = {
      projects: {
        findByCompany: vi.fn().mockReturnValue(
          new Promise<ProjectRow[]>((res) => {
            resolveFetch = res;
          }),
        ),
      },
    };
    const { result } = renderHook(() => useProjects({ repos: pendingRepos, companyId: 'co-1' }));
    expect(result.current.projects).toEqual([]);
    // Resolve the pending promise and let act() flush state updates
    await act(async () => {
      resolveFetch([]);
    });
  });

  it('fetches projects from repos on mount', async () => {
    const repos = makeRepos([PROJECT_A, PROJECT_B]);
    const { result } = renderHook(() => useProjects({ repos, companyId: 'co-1' }));
    await waitFor(() => {
      expect(result.current.projects).toHaveLength(2);
    });
    expect(result.current.projects[0].project_id).toBe('p-1');
    expect(result.current.projects[1].project_id).toBe('p-2');
  });

  it('re-fetches when companyId changes', async () => {
    const reposA = {
      projects: {
        findByCompany: vi
          .fn()
          .mockImplementation((id: string) =>
            Promise.resolve(id === 'co-1' ? [PROJECT_A] : [PROJECT_B]),
          ),
      },
    };
    const { result, rerender } = renderHook(
      ({ companyId }) => useProjects({ repos: reposA, companyId }),
      { initialProps: { companyId: 'co-1' } },
    );
    await waitFor(() => expect(result.current.projects).toHaveLength(1));
    expect(result.current.projects[0].project_id).toBe('p-1');

    rerender({ companyId: 'co-2' });
    await waitFor(() => expect(result.current.projects).toHaveLength(1));
    expect(result.current.projects[0].project_id).toBe('p-2');
  });

  it('resets activeProjectId when companyId changes', async () => {
    const repos = makeRepos([PROJECT_A]);
    const { result, rerender } = renderHook(({ companyId }) => useProjects({ repos, companyId }), {
      initialProps: { companyId: 'co-1' },
    });
    await waitFor(() => expect(result.current.projects).toHaveLength(1));

    act(() => result.current.setActiveProjectId('p-1'));
    expect(result.current.activeProjectId).toBe('p-1');

    rerender({ companyId: 'co-2' });
    // Effect runs synchronously in jsdom for the companyId reset effect
    await waitFor(() => expect(result.current.activeProjectId).toBeNull());
  });

  it('setActiveProjectId updates activeProjectId', async () => {
    const repos = makeRepos([PROJECT_A]);
    const { result } = renderHook(() => useProjects({ repos, companyId: 'co-1' }));
    await waitFor(() => expect(result.current.projects).toHaveLength(1));

    act(() => result.current.setActiveProjectId('p-1'));
    expect(result.current.activeProjectId).toBe('p-1');
  });

  it('activeProject is null when no project is selected', async () => {
    const repos = makeRepos([PROJECT_A]);
    const { result } = renderHook(() => useProjects({ repos, companyId: 'co-1' }));
    await waitFor(() => expect(result.current.projects).toHaveLength(1));
    expect(result.current.activeProject).toBeNull();
  });

  it('activeProject returns correct ProjectRow when selected', async () => {
    const repos = makeRepos([PROJECT_A, PROJECT_B]);
    const { result } = renderHook(() => useProjects({ repos, companyId: 'co-1' }));
    await waitFor(() => expect(result.current.projects).toHaveLength(2));

    act(() => result.current.setActiveProjectId('p-2'));
    expect(result.current.activeProject).toEqual(PROJECT_B);
  });

  it('refresh() re-fetches projects', async () => {
    const repos = makeRepos([PROJECT_A]);
    const { result } = renderHook(() => useProjects({ repos, companyId: 'co-1' }));
    await waitFor(() => expect(result.current.projects).toHaveLength(1));

    // Update the mock to return two projects on next call
    (repos.projects.findByCompany as ReturnType<typeof vi.fn>).mockResolvedValue([
      PROJECT_A,
      PROJECT_B,
    ]);

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.projects).toHaveLength(2);
  });

  it('returns empty projects when repos is null', () => {
    const { result } = renderHook(() => useProjects({ repos: null, companyId: 'co-1' }));
    expect(result.current.projects).toEqual([]);
    expect(result.current.activeProject).toBeNull();
  });
});
