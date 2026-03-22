import { renderHook, waitFor } from '@testing-library/react';
import type { ProjectAssignmentRow } from '@aics/shared-types';
import { useProjectAssignments } from '../../hooks/useProjectAssignments.js';

function makeAssignment(overrides: Partial<ProjectAssignmentRow> & { assignment_id: string }): ProjectAssignmentRow {
  return {
    project_id: 'p-1',
    employee_id: `emp-${overrides.assignment_id}`,
    role: 'developer',
    assigned_at: '2024-01-01',
    ...overrides,
  };
}

const ASSIGNMENT_A = makeAssignment({ assignment_id: 'a-1', employee_id: 'emp-alice' });
const ASSIGNMENT_B = makeAssignment({ assignment_id: 'a-2', employee_id: 'emp-bob' });

function makeRepos(assignments: ProjectAssignmentRow[] = []) {
  return {
    projectAssignments: {
      findByProject: vi.fn().mockResolvedValue(assignments),
    },
  };
}

describe('useProjectAssignments', () => {
  it('returns empty assignments when projectId is null', () => {
    const repos = makeRepos([ASSIGNMENT_A]);
    const { result } = renderHook(() =>
      useProjectAssignments(repos, null),
    );
    expect(result.current.assignments).toEqual([]);
    expect(result.current.assignedEmployeeIds.size).toBe(0);
  });

  it('fetches assignments when projectId is provided', async () => {
    const repos = makeRepos([ASSIGNMENT_A, ASSIGNMENT_B]);
    const { result } = renderHook(() =>
      useProjectAssignments(repos, 'p-1'),
    );
    await waitFor(() => {
      expect(result.current.assignments).toHaveLength(2);
    });
    expect(repos.projectAssignments.findByProject).toHaveBeenCalledWith('p-1');
  });

  it('assignedEmployeeIds is a Set containing all employee IDs', async () => {
    const repos = makeRepos([ASSIGNMENT_A, ASSIGNMENT_B]);
    const { result } = renderHook(() =>
      useProjectAssignments(repos, 'p-1'),
    );
    await waitFor(() => {
      expect(result.current.assignedEmployeeIds.size).toBe(2);
    });
    expect(result.current.assignedEmployeeIds.has('emp-alice')).toBe(true);
    expect(result.current.assignedEmployeeIds.has('emp-bob')).toBe(true);
  });

  it('re-fetches and clears when projectId changes to null', async () => {
    const repos = makeRepos([ASSIGNMENT_A]);
    const { result, rerender } = renderHook(
      ({ projectId }) => useProjectAssignments(repos, projectId),
      { initialProps: { projectId: 'p-1' as string | null } },
    );
    await waitFor(() => expect(result.current.assignments).toHaveLength(1));

    rerender({ projectId: null });
    expect(result.current.assignments).toEqual([]);
  });

  it('re-fetches when projectId changes to a different value', async () => {
    const repos = {
      projectAssignments: {
        findByProject: vi.fn().mockImplementation((id: string) =>
          Promise.resolve(id === 'p-1' ? [ASSIGNMENT_A] : [ASSIGNMENT_B]),
        ),
      },
    };
    const { result, rerender } = renderHook(
      ({ projectId }) => useProjectAssignments(repos, projectId),
      { initialProps: { projectId: 'p-1' as string | null } },
    );
    await waitFor(() => expect(result.current.assignments).toHaveLength(1));
    expect(result.current.assignedEmployeeIds.has('emp-alice')).toBe(true);

    rerender({ projectId: 'p-2' });
    await waitFor(() => expect(result.current.assignments).toHaveLength(1));
    expect(result.current.assignedEmployeeIds.has('emp-bob')).toBe(true);
  });

  it('returns empty when repos is null', () => {
    const { result } = renderHook(() =>
      useProjectAssignments(null, 'p-1'),
    );
    expect(result.current.assignments).toEqual([]);
    expect(result.current.assignedEmployeeIds.size).toBe(0);
  });
});
