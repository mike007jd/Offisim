import { getRepos } from '@/runtime/repos.js';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { type EmployeeSeniority, deriveEmployeeSeniority } from './employee-seniority.js';
import type { Employee } from './types.js';

export type EmployeeSeniorityRoster = Readonly<Record<string, EmployeeSeniority>>;

export function useEmployeeSeniorityRoster(
  companyId: string | null | undefined,
  employees: readonly Pick<Employee, 'id'>[],
) {
  const employeeIds = useMemo(
    () => [...new Set(employees.map((employee) => employee.id))].sort(),
    [employees],
  );
  const employeeKey = employeeIds.join('\u0000');

  return useQuery({
    queryKey: ['employee-seniority', companyId, employeeKey],
    queryFn: async (): Promise<EmployeeSeniorityRoster> => {
      const repos = await getRepos();
      const entries = await Promise.all(
        employeeIds.map(async (employeeId) => {
          const [runs, attempts, experiences] = await Promise.all([
            repos.agentRuns.findByEmployee(employeeId),
            repos.competitiveDraftAttempts.listByEmployee(employeeId),
            repos.employeeProjectMemories.listByEmployee(employeeId),
          ]);
          const completedTasks = runs.filter(
            (run) => run.run_id === run.root_run_id && run.status === 'completed',
          ).length;
          const comparisonWins = attempts.filter((attempt) => attempt.status === 'winner').length;
          return [
            employeeId,
            deriveEmployeeSeniority({
              completedTasks,
              comparisonWins,
              experienceEntries: experiences.length,
            }),
          ] as const;
        }),
      );
      return Object.fromEntries(entries);
    },
    enabled: Boolean(companyId) && employeeIds.length > 0,
    staleTime: 2_000,
    refetchInterval: 5_000,
  });
}

export function seniorityForEmployee(
  roster: EmployeeSeniorityRoster | undefined,
  employeeId: string,
): EmployeeSeniority | undefined {
  return roster?.[employeeId];
}
