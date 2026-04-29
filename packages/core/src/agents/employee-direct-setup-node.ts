import type { RunnableConfig } from '@langchain/core/runnables';
import {
  directChatStarted,
  employeeStateChanged,
  graphNodeEntered,
} from '../events/event-factories.js';
import {
  type OffisimGraphState,
  type PendingAssignment,
  createEmptyPlanScopedState,
} from '../graph/state.js';
import { getRuntime } from '../utils/get-runtime.js';
import { requiresLocalOffisimTools } from './local-tool-routing.js';

/**
 * Lightweight setup node for direct employee chat.
 * Does NOT call LLM — validates the target employee, constructs a
 * PendingAssignment with taskType 'direct_chat', and emits entry events.
 */
export async function employeeDirectSetupNode(
  state: OffisimGraphState,
  config: RunnableConfig,
): Promise<Partial<OffisimGraphState>> {
  const runtimeCtx = getRuntime(config, 'employee_direct_setup', { optional: true });

  // Announce node entry (best-effort)
  if (runtimeCtx) {
    runtimeCtx.eventBus.emit(
      graphNodeEntered(runtimeCtx.companyId, state.threadId, 'employee_direct_setup'),
    );
  }

  // Validate targetEmployeeId is present
  if (!state.targetEmployeeId) {
    return {
      interruptReason: 'Direct chat requires a targetEmployeeId but none was provided',
      currentStepOutputs: [],
    };
  }

  // Validate employee exists in repository
  if (!runtimeCtx) {
    return {
      interruptReason: 'RuntimeContext not found in config.configurable',
      currentStepOutputs: [],
    };
  }

  const employee = await runtimeCtx.repos.employees.findById(state.targetEmployeeId);
  if (!employee) {
    return {
      interruptReason: `Employee ${state.targetEmployeeId} not found`,
      currentStepOutputs: [],
    };
  }

  // Extract the user message as task description
  const lastUserMessage = [...state.messages].reverse().find((m) => m._getType() === 'human');
  const taskDescription =
    typeof lastUserMessage?.content === 'string' ? lastUserMessage.content : '';

  if (employee.is_external === 1 && requiresLocalOffisimTools(taskDescription)) {
    return {
      interruptReason: `External employee ${employee.name} cannot execute Offisim file or shell tools. Select an internal gateway employee for read_file, write_file, or bash tasks.`,
      currentStepOutputs: [],
    };
  }

  // Create a task run in the repository so the employee node can track it
  const taskRunId = runtimeCtx.determinism.id('tr-dc');
  await runtimeCtx.repos.taskRuns.create({
    task_run_id: taskRunId,
    thread_id: state.threadId,
    employee_id: employee.employee_id,
    parent_task_run_id: null,
    task_type: 'direct_chat',
    status: 'queued',
    input_json: JSON.stringify({ description: taskDescription }),
    output_json: null,
    started_at: new Date().toISOString(),
  });

  // Construct a PendingAssignment for the employee node
  const assignment: PendingAssignment = {
    taskType: 'direct_chat',
    employeeId: employee.employee_id,
    assigneeKind: 'employee',
    assigneeName: employee.name,
    taskRunId,
    stepIndex: 0,
    inputJson: {
      description: taskDescription,
      taskRunId,
      stepIndex: 0,
    },
  };

  // Emit directChatStarted event
  runtimeCtx.eventBus.emit(
    directChatStarted(runtimeCtx.companyId, employee.employee_id, employee.name, state.threadId),
  );

  // Emit employee state changed: idle → assigned
  // NOTE: Assumes employee is idle. The in-memory repo doesn't track current state;
  // if the employee is already executing/assigned, prev will be inaccurate.
  // This is a known limitation — P2 should add state tracking to EmployeeRepository.
  runtimeCtx.eventBus.emit(
    employeeStateChanged(
      runtimeCtx.companyId,
      employee.employee_id,
      'idle',
      'assigned',
      state.threadId,
    ),
  );

  return {
    ...createEmptyPlanScopedState(),
    pendingAssignments: [assignment],
    currentTaskRunId: taskRunId,
    currentEmployeeId: employee.employee_id,
  };
}
