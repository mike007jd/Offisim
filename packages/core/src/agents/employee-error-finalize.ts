import {
  employeeStateChanged,
  taskStateChanged,
  taskSubtaskProgress,
} from '../events/event-factories.js';
import type { OffisimGraphState } from '../graph/state.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { appendAgentEvent } from '../utils/append-agent-event.js';
import type { PreflightResult } from './employee-preflight.js';

export interface FinalizeFailureContext {
  readonly runtimeCtx: RuntimeContext;
  readonly state: OffisimGraphState;
  readonly preflight: PreflightResult;
  readonly errorMessage: string;
}

/**
 * Failure-path finalization. Called when the LLM call AND `attemptLocalRecovery`
 * both fail.
 *
 * Side effects (in order, must match pre-refactor sequence):
 *   1. Emit `employee.state.changed(executing→failed)`
 *   2. (if taskRunId) Update task run status → `failed` + emit `task.state.changed(running→failed)`
 *   3. Emit `task.subtask.progress(failed)`
 *   4. `appendAgentEvent(error)` — wrapped in `.catch(() => {})` so error logging never throws
 *   5. Return state update with `interruptReason: JSON.stringify(structuredError)`
 *      where the structured error JSON has exactly 8 keys consumed by `error-handler-node`:
 *      `errorCode / message / recoverable / nodeName / employeeId / taskRunId / provider / model`
 */
export async function finalizeEmployeeFailure(
  ctx: FinalizeFailureContext,
): Promise<Partial<OffisimGraphState>> {
  const { runtimeCtx, state, preflight, errorMessage } = ctx;
  const { remaining, employee, taskRunId, taskLabel, totalAssignments, completedSoFar, resolved } =
    preflight;
  const { repos, eventBus, companyId, threadId } = runtimeCtx;

  eventBus.emit(
    employeeStateChanged(
      companyId,
      employee.employee_id,
      'executing',
      'failed',
      threadId,
      taskRunId,
    ),
  );

  if (taskRunId) {
    await repos.taskRuns.updateStatus(taskRunId, 'failed');
    eventBus.emit(
      taskStateChanged(
        companyId,
        taskRunId,
        'running',
        'failed',
        threadId,
        employee.employee_id,
        'employee',
        employee.name,
      ),
    );
  }

  eventBus.emit(
    taskSubtaskProgress(
      companyId,
      employee.employee_id,
      completedSoFar,
      taskLabel,
      'failed',
      totalAssignments,
      completedSoFar,
      threadId,
      { employeeId: employee.employee_id, assigneeKind: 'employee', assigneeName: employee.name },
    ),
  );

  const structuredError = {
    errorCode: 'LLM_CALL_FAILED',
    message: errorMessage,
    recoverable: true,
    nodeName: 'employee',
    employeeId: employee.employee_id,
    taskRunId,
    provider: resolved.provider,
    model: resolved.model,
  };

  await appendAgentEvent(runtimeCtx, {
    projectId: state.projectId,
    threadId: state.threadId,
    agentName: `employee:${employee.employee_id}`,
    eventType: 'error',
    payload: {
      errorCode: 'LLM_CALL_FAILED',
      message: errorMessage,
      employeeName: employee.name,
      taskRunId,
      provider: resolved.provider,
      model: resolved.model,
    },
  }).catch(() => {}); // error logging must not throw

  return {
    currentEmployeeId: employee.employee_id,
    currentTaskRunId: taskRunId ?? null,
    pendingAssignments: remaining,
    interruptReason: JSON.stringify(structuredError),
    currentStepOutputs: state.currentStepOutputs,
  };
}
