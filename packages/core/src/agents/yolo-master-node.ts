import type { RunnableConfig } from '@langchain/core/runnables';
import type { Command } from '@langchain/langgraph';
import type { OffisimGraphState, PendingAssignment } from '../graph/state.js';
import { getRuntime } from '../utils/get-runtime.js';
import { employeeNode } from './employee-node.js';
import { YOLO_MASTER_ROLE_SLUG } from './yolo-master-persona.js';

function latestHumanText(state: OffisimGraphState): string {
  const lastUserMessage = [...state.messages]
    .reverse()
    .find((message) => message._getType() === 'human');
  return typeof lastUserMessage?.content === 'string' ? lastUserMessage.content : '';
}

export async function yoloMasterNode(
  state: OffisimGraphState,
  config: RunnableConfig,
): Promise<Partial<OffisimGraphState> | Command> {
  const runtimeCtx = getRuntime(config, 'yolo-master');
  const [yolo] = await runtimeCtx.repos.employees.findByRole(
    runtimeCtx.companyId,
    YOLO_MASTER_ROLE_SLUG,
  );

  if (!yolo) {
    throw new Error(
      'YOLO Master employee not found in this company. Ensure templates seed it via ensureYoloMasterForActiveCompanies.',
    );
  }

  const taskDescription = latestHumanText(state);
  const taskRunId = runtimeCtx.determinism.id('tr-yolo');
  const stepIndex = state.currentStepIndex ?? 0;

  await runtimeCtx.repos.taskRuns.create({
    task_run_id: taskRunId,
    thread_id: state.threadId,
    employee_id: yolo.employee_id,
    parent_task_run_id: null,
    task_type: 'yolo',
    status: 'queued',
    input_json: JSON.stringify({ description: taskDescription, stepIndex }),
    output_json: null,
    started_at: runtimeCtx.determinism.nowIso(),
  });

  const assignment: PendingAssignment = {
    taskType: 'yolo',
    employeeId: yolo.employee_id,
    assigneeKind: 'employee',
    assigneeName: yolo.name,
    inputJson: {
      description: taskDescription,
      stepIndex,
      taskRunId,
      enableSubagentFork: true,
      enableTodoTool: true,
      skipPlannerHandoff: true,
    },
    taskRunId,
    stepIndex,
  };

  return employeeNode(
    {
      ...state,
      interactionMode: 'yolo',
      currentEmployeeId: yolo.employee_id,
      currentTaskRunId: taskRunId,
      pendingAssignments: [assignment, ...state.pendingAssignments],
    },
    config,
  );
}
