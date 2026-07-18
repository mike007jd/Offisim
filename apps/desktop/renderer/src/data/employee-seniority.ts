export interface EmployeeTrackRecord {
  readonly completedTasks: number;
  readonly comparisonWins: number;
  readonly experienceEntries: number;
}

type EmployeeSeniorityLevel = 1 | 2 | 3;

export interface EmployeeSeniority {
  readonly level: EmployeeSeniorityLevel;
  readonly title: 'New hire' | 'Team regular' | 'Senior hand';
  readonly careerMarks: number;
  readonly nextLevelAt: number | null;
  readonly completedTasks: number;
  readonly comparisonWins: number;
  readonly experienceEntries: number;
}

export const SENIORITY_THRESHOLDS = {
  teamRegular: 3,
  seniorHand: 8,
} as const;

function count(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/**
 * A visible career level derived only from records Offisim already keeps.
 * A completed task or saved experience is one career mark; a draft win is two
 * because it records both delivery and a side-by-side selection. No level state
 * is persisted, so the same track record always produces the same title.
 */
export function deriveEmployeeSeniority(record: EmployeeTrackRecord): EmployeeSeniority {
  const completedTasks = count(record.completedTasks);
  const comparisonWins = count(record.comparisonWins);
  const experienceEntries = count(record.experienceEntries);
  const careerMarks = completedTasks + comparisonWins * 2 + experienceEntries;

  if (careerMarks >= SENIORITY_THRESHOLDS.seniorHand) {
    return {
      level: 3,
      title: 'Senior hand',
      careerMarks,
      nextLevelAt: null,
      completedTasks,
      comparisonWins,
      experienceEntries,
    };
  }
  if (careerMarks >= SENIORITY_THRESHOLDS.teamRegular) {
    return {
      level: 2,
      title: 'Team regular',
      careerMarks,
      nextLevelAt: SENIORITY_THRESHOLDS.seniorHand,
      completedTasks,
      comparisonWins,
      experienceEntries,
    };
  }
  return {
    level: 1,
    title: 'New hire',
    careerMarks,
    nextLevelAt: SENIORITY_THRESHOLDS.teamRegular,
    completedTasks,
    comparisonWins,
    experienceEntries,
  };
}

export function employeeSeniorityLabel(seniority: EmployeeSeniority): string {
  return `Level ${seniority.level} · ${seniority.title}`;
}

export function employeeTrackRecordLabel(seniority: EmployeeSeniority): string {
  return `${seniority.completedTasks} tasks · ${seniority.comparisonWins} draft wins · ${seniority.experienceEntries} lessons`;
}
