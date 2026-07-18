export const FIRST_RUN_MILESTONES = [
  'company',
  'employee',
  'engine',
  'request',
  'live',
  'output',
] as const;

export type FirstRunMilestone = (typeof FIRST_RUN_MILESTONES)[number];

export interface FirstRunFacts {
  company: boolean;
  employee: boolean;
  engine: boolean;
  request: boolean;
  live: boolean;
  output: boolean;
}

export function resolveFirstRunProgress(facts: FirstRunFacts): {
  milestone: FirstRunMilestone | 'complete';
  completedCount: number;
} {
  const completedCount = FIRST_RUN_MILESTONES.findIndex((milestone) => !facts[milestone]);
  if (completedCount === -1) {
    return { milestone: 'complete', completedCount: FIRST_RUN_MILESTONES.length };
  }
  return { milestone: FIRST_RUN_MILESTONES[completedCount] ?? 'complete', completedCount };
}
