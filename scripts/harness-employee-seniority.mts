import assert from 'node:assert/strict';
import {
  SENIORITY_THRESHOLDS,
  deriveEmployeeSeniority,
  employeeSeniorityLabel,
} from '../apps/desktop/renderer/src/data/employee-seniority.ts';

const belowTeamRegular = deriveEmployeeSeniority({
  completedTasks: SENIORITY_THRESHOLDS.teamRegular - 1,
  comparisonWins: 0,
  experienceEntries: 0,
});
assert.equal(belowTeamRegular.level, 1, 'one mark below the first threshold stays a new hire');

const atTeamRegular = deriveEmployeeSeniority({
  completedTasks: 1,
  comparisonWins: 1,
  experienceEntries: 0,
});
assert.equal(atTeamRegular.careerMarks, SENIORITY_THRESHOLDS.teamRegular);
assert.equal(atTeamRegular.level, 2, 'the exact first threshold becomes a team regular');

const belowSenior = deriveEmployeeSeniority({
  completedTasks: 4,
  comparisonWins: 1,
  experienceEntries: 1,
});
assert.equal(belowSenior.careerMarks, SENIORITY_THRESHOLDS.seniorHand - 1);
assert.equal(belowSenior.level, 2, 'one mark below senior stays a team regular');

const atSenior = deriveEmployeeSeniority({
  completedTasks: 4,
  comparisonWins: 1,
  experienceEntries: 2,
});
assert.equal(atSenior.careerMarks, SENIORITY_THRESHOLDS.seniorHand);
assert.equal(atSenior.level, 3, 'the exact senior threshold becomes a senior hand');
assert.equal(employeeSeniorityLabel(atSenior), 'Level 3 · Senior hand');

const normalized = deriveEmployeeSeniority({
  completedTasks: -4,
  comparisonWins: Number.NaN,
  experienceEntries: 2.9,
});
assert.equal(normalized.careerMarks, 2, 'invalid counters normalize without adding state');

console.log('harness:employee-seniority — PASS (9 checks)');
