import { planCreated } from '../../events/event-factories.js';
import type { OffisimGraphState, PlanStep, PlanTask, TaskPlan } from '../../graph/state.js';
import { appendAgentEvent } from '../../utils/append-agent-event.js';
import { generateId } from '../../utils/generate-id.js';
import type { LlmPlan, PmPreflightReady } from '../pm-planner-types.js';

// Plan-persistence no longer owns a "department-only" variant; external employees
// go through the shared employee dispatch pipeline (employee-a2a-executor) and
// are persisted as regular plan tasks keyed by employeeId.

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
  const thread = await repos.threads.findById(threadId);
  const projectId = state.projectId ?? thread?.project_id ?? null;

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
        status: 'queued',
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

  if (projectId) {
    for (const step of planSteps) {
      for (const [taskIndex, task] of step.tasks.entries()) {
        await repos.kanban.create({
          project_id: projectId,
          company_id: companyId,
          title: task.description || step.description,
          note: step.description,
          origin: 'pm-planner',
          assigned_employee_id: task.employeeId,
          task_run_id: task.taskRunId ?? null,
          sort_order: step.stepIndex * 100 + taskIndex,
        });
      }
    }
  }

  await appendAgentEvent(runtimeCtx, {
    projectId,
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
