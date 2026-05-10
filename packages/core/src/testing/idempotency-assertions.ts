import type { ScenarioTraceReport } from './trace-recorder.js';
import { countDuplicateRowsByKey, toRecordRows } from './trace-row-utils.js';

export interface IdempotencyAssertionReport {
  readonly passed: boolean;
  readonly duplicateTaskRuns: number;
  readonly duplicateToolCalls: number;
  readonly duplicateInteractions: number;
}

export function assertTraceIdempotency(report: ScenarioTraceReport): IdempotencyAssertionReport {
  const result = {
    duplicateTaskRuns: countDuplicateRowsByKey(
      rowsWithStableKey(toRecordRows(report.trace.db.taskRuns), 'task_run_id'),
      'task_run_id',
    ),
    duplicateToolCalls: countDuplicateRowsByKey(
      rowsWithStableKey(toRecordRows(report.trace.db.mcpAudit), 'tool_call_id'),
      'tool_call_id',
    ),
    duplicateInteractions: countDuplicateRowsByKey(
      rowsWithStableKey(toRecordRows(report.trace.db.interactionHistory), 'interaction_id'),
      'interaction_id',
    ),
  };
  return {
    passed:
      result.duplicateTaskRuns === 0 &&
      result.duplicateToolCalls === 0 &&
      result.duplicateInteractions === 0,
    ...result,
  };
}

function rowsWithStableKey(
  rows: readonly Record<string, unknown>[],
  key: string,
): readonly Record<string, unknown>[] {
  return rows.filter((row) => {
    const value = row[key];
    return typeof value === 'string' && !value.includes('<uuid>') && !value.includes('<id>');
  });
}
