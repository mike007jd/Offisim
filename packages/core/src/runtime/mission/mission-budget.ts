import type {
  MissionExecutionBudgetContract,
  MissionExecutionBudgetOverrides,
} from '@offisim/shared-types';

const BUDGET_KEYS = new Set([
  'maxRepairsPerCriterion',
  'maxAttempts',
  'tokenBudget',
  'maxConcurrentAgents',
  'maxTotalAgents',
  'maxRecursionDepth',
  'wallClockMinutes',
]);

export const DEFAULT_MISSION_EXECUTION_BUDGET: MissionExecutionBudgetContract = {
  maxRepairsPerCriterion: 3,
  maxAttempts: 6,
};

export class MissionBudgetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissionBudgetValidationError';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requirePositiveInteger(value: unknown, key: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new MissionBudgetValidationError(`Mission budget ${key} must be a positive integer.`);
  }
  return value;
}

/** Resolve authored overrides into the one canonical budget consumed by Mission. */
export function resolveMissionExecutionBudget(
  value?: MissionExecutionBudgetOverrides | null,
): MissionExecutionBudgetContract {
  if (value === undefined || value === null) return { ...DEFAULT_MISSION_EXECUTION_BUDGET };
  if (!isPlainObject(value)) {
    throw new MissionBudgetValidationError('Mission budget must be a JSON object.');
  }
  for (const key of Object.keys(value)) {
    if (!BUDGET_KEYS.has(key)) {
      throw new MissionBudgetValidationError(`Mission budget contains unknown cap ${key}.`);
    }
  }

  const maxRepairsPerCriterion =
    value.maxRepairsPerCriterion === undefined
      ? DEFAULT_MISSION_EXECUTION_BUDGET.maxRepairsPerCriterion
      : requirePositiveInteger(value.maxRepairsPerCriterion, 'maxRepairsPerCriterion');
  const maxAttempts =
    value.maxAttempts === undefined
      ? DEFAULT_MISSION_EXECUTION_BUDGET.maxAttempts
      : requirePositiveInteger(value.maxAttempts, 'maxAttempts');
  const tokenBudget =
    value.tokenBudget === undefined
      ? undefined
      : requirePositiveInteger(value.tokenBudget, 'tokenBudget');
  const maxConcurrentAgents =
    value.maxConcurrentAgents === undefined
      ? undefined
      : requirePositiveInteger(value.maxConcurrentAgents, 'maxConcurrentAgents');
  const maxTotalAgents =
    value.maxTotalAgents === undefined
      ? undefined
      : requirePositiveInteger(value.maxTotalAgents, 'maxTotalAgents');
  const maxRecursionDepth =
    value.maxRecursionDepth === undefined
      ? undefined
      : requirePositiveInteger(value.maxRecursionDepth, 'maxRecursionDepth');
  const wallClockMinutes =
    value.wallClockMinutes === undefined
      ? undefined
      : requirePositiveInteger(value.wallClockMinutes, 'wallClockMinutes');

  if (
    maxConcurrentAgents !== undefined &&
    maxTotalAgents !== undefined &&
    maxConcurrentAgents > maxTotalAgents
  ) {
    throw new MissionBudgetValidationError(
      'Mission budget maxConcurrentAgents must not exceed maxTotalAgents.',
    );
  }

  return {
    maxRepairsPerCriterion,
    maxAttempts,
    ...(tokenBudget === undefined ? {} : { tokenBudget }),
    ...(maxConcurrentAgents === undefined ? {} : { maxConcurrentAgents }),
    ...(maxTotalAgents === undefined ? {} : { maxTotalAgents }),
    ...(maxRecursionDepth === undefined ? {} : { maxRecursionDepth }),
    ...(wallClockMinutes === undefined ? {} : { wallClockMinutes }),
  };
}

/** Parse and normalize persisted `mission.budget_json`; malformed caps fail closed. */
export function parseMissionBudgetJson(
  budgetJson: string | null | undefined,
): MissionExecutionBudgetContract {
  if (budgetJson === null || budgetJson === undefined) {
    return resolveMissionExecutionBudget();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(budgetJson);
  } catch {
    throw new MissionBudgetValidationError('Mission budget must be valid JSON.');
  }
  if (!isPlainObject(parsed)) {
    throw new MissionBudgetValidationError('Mission budget must be a JSON object.');
  }
  return resolveMissionExecutionBudget(parsed as MissionExecutionBudgetOverrides);
}
