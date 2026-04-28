import { countDuplicateRowsByKey, toRecordRows } from './trace-row-utils.js';
import type { ScenarioTraceReport } from './trace-recorder.js';

export interface IdempotencyAssertionReport {
  readonly passed: boolean;
  readonly duplicateTaskRuns: number;
  readonly duplicateToolCalls: number;
  readonly duplicateInteractions: number;
}

export function assertTraceIdempotency(report: ScenarioTraceReport): IdempotencyAssertionReport {
  const result = {
    duplicateTaskRuns: countDuplicateRowsByKey(toRecordRows(report.trace.db.taskRuns), 'task_run_id'),
    duplicateToolCalls: countDuplicateRowsByKey(toRecordRows(report.trace.db.mcpAudit), 'tool_call_id'),
    duplicateInteractions: countDuplicateRowsByKey(
      toRecordRows(report.trace.db.interactionHistory),
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
