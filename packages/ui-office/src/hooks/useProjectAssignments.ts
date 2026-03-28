import type { ProjectAssignmentRow } from '@offisim/shared-types';
import { useEffect, useState } from 'react';

interface ProjectAssignmentRepos {
  projectAssignments: {
    findByProject: (projectId: string) => Promise<ProjectAssignmentRow[]>;
  };
}

export function useProjectAssignments(
  repos: ProjectAssignmentRepos | null,
  projectId: string | null,
) {
  const [assignments, setAssignments] = useState<ProjectAssignmentRow[]>([]);

  useEffect(() => {
    if (!repos?.projectAssignments || !projectId) {
      setAssignments([]);
      return;
    }

    let cancelled = false;
    setAssignments([]);

    void repos.projectAssignments.findByProject(projectId).then((nextAssignments) => {
      if (!cancelled) {
        setAssignments(nextAssignments);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [repos, projectId]);

  const assignedEmployeeIds = new Set(assignments.map((a) => a.employee_id));
  return { assignments, assignedEmployeeIds };
}
