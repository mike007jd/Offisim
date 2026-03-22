import { useState, useEffect } from 'react';
import type { ProjectAssignmentRow } from '@aics/shared-types';

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
    repos.projectAssignments.findByProject(projectId).then(setAssignments);
  }, [repos, projectId]);

  const assignedEmployeeIds = new Set(assignments.map((a) => a.employee_id));
  return { assignments, assignedEmployeeIds };
}
