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
      // Residual active interactions / pending assignments only count as leaks once the run
      // reached a non-suspended terminal state. While a run is legitimately interrupted
      // (interruptReason set, e.g. awaiting plan resolution), that leftover state is expected.
      const suspended = report.trace.finalState.interruptReason != null;
      const activeInteractions = suspended ? [] : toRecordRows(report.trace.db.activeInteractions);
      const pendingAssignments = suspended
        ? []
        : toRecordRows(report.trace.finalState.pendingAssignments);
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
