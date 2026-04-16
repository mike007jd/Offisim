import { Command } from '@langchain/langgraph';
import { employeeStateChanged, handoffInitiated } from '../events/event-factories.js';
import type { OffisimGraphState, PendingAssignment } from '../graph/state.js';
import type { EmployeeRow } from '../runtime/repositories.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { generateId } from '../utils/generate-id.js';
import { TASK_TYPE_HANDOFF_CONTINUATION } from './employee-node-constants.js';
import type { HandoffArgs } from './employee-tool-round.js';

export interface ExecuteHandoffContext {
  readonly state: OffisimGraphState;
  readonly remaining: PendingAssignment[];
  readonly employee: EmployeeRow;
  readonly taskRunId: string | undefined;
  readonly runtimeCtx: RuntimeContext;
  readonly companyId: string;
  readonly threadId: string;
}

/**
 * Execute the full handoff side-effect chain (called from the orchestrator
 * barrel after `runToolRound` signals `kind: 'handoff'`).
 *
 * Steps (in order, must match pre-refactor handoff branch):
 *   1. Validate target employee still exists — return null if not (caller falls back)
 *   2. `handoffs.create` — write handoff record
 *   3. `taskRuns.create` — new TaskRun for receiving employee, status: 'queued'
 *   4. (if current taskRunId) Update current task run → 'completed' + `hookRegistry.emit('task.completed', completionType: 'handoff')`
 *   5. Emit `handoff.initiated` + `employee.state.changed(executing→idle)`
 *   6. Return `Command({ goto: 'employee', update })` — bypasses normal routing
 */
export async function executeHandoff(
  args: HandoffArgs,
  ctx: ExecuteHandoffContext,
): Promise<Command | null> {
  const { state, remaining, employee, taskRunId, runtimeCtx, companyId, threadId } = ctx;
  const { repos, eventBus } = runtimeCtx;

  const targetEmp = await repos.employees.findById(args.targetEmployeeId).catch(() => null);
  if (!targetEmp) return null;

  const handoffId = generateId('ho');
  await repos.handoffs.create({
    handoff_id: handoffId,
    thread_id: state.threadId,
    from_employee_id: employee.employee_id,
    to_employee_id: args.targetEmployeeId,
    reason: args.reason,
    payload_json: JSON.stringify({
      completedWork: args.completedWork,
      remainingWork: args.remainingWork,
    }),
    created_at: new Date().toISOString(),
  });

  const newTaskRunId = generateId('tr-ho');
  await repos.taskRuns.create({
    task_run_id: newTaskRunId,
    thread_id: state.threadId,
    employee_id: args.targetEmployeeId,
    parent_task_run_id: taskRunId ?? null,
    task_type: TASK_TYPE_HANDOFF_CONTINUATION,
    status: 'queued',
    input_json: JSON.stringify({
      description: args.remainingWork,
      priorWork: args.completedWork,
    }),
    output_json: null,
    started_at: new Date().toISOString(),
  });

  if (taskRunId) {
    await repos.taskRuns.updateStatus(taskRunId, 'completed');
    await runtimeCtx.hookRegistry.emit('task.completed', {
      threadId,
      companyId,
      employeeId: employee.employee_id,
      taskRunId,
      completionType: 'handoff',
    });
  }

  eventBus.emit(
    handoffInitiated(
      companyId,
      handoffId,
      state.threadId,
      employee.employee_id,
      args.targetEmployeeId,
      args.reason,
      newTaskRunId,
    ),
  );
  eventBus.emit(
    employeeStateChanged(companyId, employee.employee_id, 'executing', 'idle', threadId, taskRunId),
  );

  return new Command({
    goto: 'employee',
    update: {
      pendingAssignments: [
        {
          taskType: TASK_TYPE_HANDOFF_CONTINUATION,
          employeeId: args.targetEmployeeId,
          inputJson: {
            description: args.remainingWork,
            priorWork: args.completedWork,
            handoffReason: args.reason,
            taskRunId: newTaskRunId,
          },
        },
        ...remaining,
      ],
      handoffCount: state.handoffCount + 1,
      currentStepOutputs: [
        ...state.currentStepOutputs,
        {
          employeeId: employee.employee_id,
          employeeName: employee.name,
          sourceKind: 'employee',
          roleSlug: employee.role_slug,
          content: args.completedWork,
          taskRunId: taskRunId ?? '',
        },
      ],
    },
  });
}
