import type { ScenarioTraceReport } from './trace-recorder.js';
import { countDuplicateRowsByKey, toRecordRows } from './trace-row-utils.js';

export interface RuntimeLeakSummary {
  readonly activeInteractionsLeaked: number;
  readonly pendingAssignmentsLeaked: number;
  readonly duplicateTaskRuns: number;
  readonly duplicateToolCalls: number;
}

export function summarizeRuntimeLeaks(reports: readonly ScenarioTraceReport[]): RuntimeLeakSummary {
  return reports.reduce<RuntimeLeakSummary>(
    (acc, report) => {
      const activeInteractions = toRecordRows(report.trace.db.activeInteractions);
      const pendingAssignments = toRecordRows(report.trace.finalState.pendingAssignments);
      const taskRuns = toRecordRows(report.trace.db.taskRuns);
      const mcpAudit = toRecordRows(report.trace.db.mcpAudit);
      return {
        activeInteractionsLeaked: acc.activeInteractionsLeaked + activeInteractions.length,
        pendingAssignmentsLeaked: acc.pendingAssignmentsLeaked + pendingAssignments.length,
        duplicateTaskRuns: acc.duplicateTaskRuns + countDuplicateRowsByKey(taskRuns, 'task_run_id'),
        duplicateToolCalls:
          acc.duplicateToolCalls + countDuplicateRowsByKey(mcpAudit, 'tool_call_id'),
      };
    },
    {
      activeInteractionsLeaked: 0,
      pendingAssignmentsLeaked: 0,
      duplicateTaskRuns: 0,
      duplicateToolCalls: 0,
    },
  );
}
