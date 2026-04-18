import { planCreated } from '../../events/event-factories.js';
import type { OffisimGraphState, PlanStep, PlanTask, TaskPlan } from '../../graph/state.js';
import { appendAgentEvent } from '../../utils/append-agent-event.js';
import { generateId } from '../../utils/generate-id.js';
import type { LlmPlan, PmPreflightReady } from '../pm-planner-types.js';

/**
 * Persist the LLM / SOP plan as a TaskPlan: write scratchpad, create taskRuns,
 * build PlanStep[] / PlanTask[], emit planCreated, append pm decision event.
 */
export async function persistLlmPlanAsTaskPlan(
  plan: LlmPlan,
  prep: PmPreflightReady,
  sopTemplateId: string | undefined,
): Promise<Partial<OffisimGraphState>> {
  const { runtimeCtx, state, validEmployees } = prep;
  const { repos, eventBus, companyId, threadId } = runtimeCtx;
  const planId = generateId('plan');

  runtimeCtx.scratchpad.write(
    `pm.plan.${threadId}`,
    `Plan summary: ${plan.summary}. Steps: ${plan.steps
      .map((step) => `${step.stepIndex + 1}. ${step.description}`)
      .join(' | ')}`,
    'pm_planner',
  );

  const planSteps: PlanStep[] = [];
  for (const llmStep of plan.steps) {
    const planTasks: PlanTask[] = [];
    for (const llmTask of llmStep.tasks) {
      const taskRunId = generateId('tr');
      await repos.taskRuns.create({
        task_run_id: taskRunId,
        thread_id: threadId,
        employee_id: llmTask.employeeId,
        parent_task_run_id: null,
        task_type: llmTask.taskType,
        status: 'planned',
        input_json: JSON.stringify({ description: llmTask.description }),
        output_json: null,
        started_at: new Date().toISOString(),
      });
      planTasks.push({
        taskType: llmTask.taskType,
        employeeId: llmTask.employeeId,
        assigneeKind: 'employee',
        assigneeName: validEmployees.find((employee) => employee.employee_id === llmTask.employeeId)
          ?.name,
        description: llmTask.description,
        dependsOnStepOutput: llmTask.dependsOnStepOutput,
        requiredSkills: llmTask.requiredSkills,
        taskRunId,
      });
    }
    planSteps.push({
      stepIndex: llmStep.stepIndex,
      description: llmStep.description,
      tasks: planTasks,
      phase: llmStep.phase,
      dependsOnSteps: llmStep.dependsOnSteps,
    });
  }

  const taskPlan: TaskPlan = {
    planId,
    threadId,
    companyId,
    steps: planSteps,
    summary: plan.summary,
  };

  eventBus.emit(
    planCreated(
      companyId,
      planId,
      threadId,
      plan.summary,
      planSteps.map((s) => ({
        stepIndex: s.stepIndex,
        description: s.description,
        taskCount: s.tasks.length,
        tasks: s.tasks.map((t) => {
          if (!t.taskRunId) {
            throw new Error('Expected planner task to have a taskRunId');
          }
          return {
            taskRunId: t.taskRunId,
            taskType: t.taskType,
            description: t.description,
            employeeId: t.employeeId,
            assigneeId: t.employeeId,
            assigneeName: t.assigneeName,
            assigneeKind: t.assigneeKind,
          };
        }),
      })),
      sopTemplateId,
    ),
  );

  await appendAgentEvent(runtimeCtx, {
    projectId: state.projectId,
    threadId: state.threadId,
    agentName: 'pm',
    eventType: 'decision',
    payload: {
      planId,
      stepCount: planSteps.length,
      summary: plan.summary,
      phases: [...new Set(planSteps.map((s) => s.phase).filter(Boolean))],
    },
  });

  return {
    taskPlan,
    currentStepIndex: 0,
    stepResults: [],
    currentStepOutputs: [],
  };
}

/**
 * Persist a department-only plan: one step that dispatches work to each external
 * department as a taskRun (employee_id: null), emits planCreated, records pm event.
 */
export async function persistDepartmentPlan(
  prep: PmPreflightReady,
): Promise<Partial<OffisimGraphState>> {
  const { runtimeCtx, state, validDepartments, directive } = prep;
  const { repos, eventBus, companyId, threadId } = runtimeCtx;
  const planId = generateId('plan');
  const description =
    validDepartments.length === 1
      ? `Outsource to ${validDepartments[0]?.name ?? 'external department'}`
      : `Outsource to ${validDepartments.length} external departments`;
  const planTasks: PlanTask[] = [];

  for (const department of validDepartments) {
    const taskRunId = generateId('tr');
    const taskDescription = `${directive.intent}\n\nDelegate this work to ${department.name}. Use its external capabilities: ${department.capabilities.join(', ')}.`;
    await repos.taskRuns.create({
      task_run_id: taskRunId,
      thread_id: threadId,
      employee_id: null,
      parent_task_run_id: null,
      task_type: 'general',
      status: 'planned',
      input_json: JSON.stringify({
        description: taskDescription,
        assigneeKind: 'department',
        assigneeId: department.id,
      }),
      output_json: null,
      started_at: new Date().toISOString(),
    });
    planTasks.push({
      taskType: 'general',
      employeeId: department.id,
      assigneeKind: 'department',
      assigneeName: department.name,
      description: taskDescription,
      dependsOnStepOutput: false,
      requiredSkills: [...department.capabilities],
      taskRunId,
    });
  }

  const taskPlan: TaskPlan = {
    planId,
    threadId,
    companyId,
    steps: [
      {
        stepIndex: 0,
        description,
        tasks: planTasks,
        phase: 'external delivery',
      },
    ],
    summary:
      validDepartments.length === 1
        ? `Delegate work to ${validDepartments[0]?.name ?? 'external department'}`
        : `Delegate work to external departments`,
  };

  eventBus.emit(
    planCreated(
      companyId,
      planId,
      threadId,
      taskPlan.summary,
      taskPlan.steps.map((step) => ({
        stepIndex: step.stepIndex,
        description: step.description,
        taskCount: step.tasks.length,
        tasks: step.tasks.map((task) => ({
          taskRunId: task.taskRunId ?? '',
          taskType: task.taskType,
          description: task.description,
          employeeId: undefined,
          assigneeId: task.employeeId,
          assigneeName: task.assigneeName,
          assigneeKind: task.assigneeKind,
        })),
      })),
    ),
  );

  await appendAgentEvent(runtimeCtx, {
    projectId: state.projectId,
    threadId: state.threadId,
    agentName: 'pm',
    eventType: 'decision',
    payload: {
      planId,
      stepCount: taskPlan.steps.length,
      summary: taskPlan.summary,
      targetKind: 'department',
    },
  });

  return {
    taskPlan,
    currentStepIndex: 0,
    stepResults: [],
    currentStepOutputs: [],
  };
}
