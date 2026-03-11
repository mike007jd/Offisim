import type { RunnableConfig } from '@langchain/core/runnables';
import { GraphError } from '../errors.js';
import { graphNodeEntered, planCreated } from '../events/event-factories.js';
import type { AicsGraphState, PlanStep, PlanTask, TaskPlan } from '../graph/state.js';
import { recordedLlmCall } from '../llm/recorded-call.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { generateId } from '../utils/generate-id.js';

const PM_SYSTEM_PROMPT = `You are the PM AI — responsible for breaking down work into structured execution plans.

Given the user's intent and available employees with their capabilities, create a step-by-step plan.

Respond with JSON only:
{
  "summary": "one sentence describing the overall plan",
  "steps": [
    {
      "stepIndex": 0,
      "description": "what this step accomplishes",
      "tasks": [
        {
          "taskType": "research" | "writing" | "analysis" | "review" | "code" | "general",
          "employeeId": "<employee_id>",
          "description": "specific instruction for the employee",
          "dependsOnStepOutput": false
        }
      ]
    }
  ]
}

Rules:
- Steps execute sequentially (step 0 finishes before step 1 starts)
- Tasks within a step execute in parallel
- Set dependsOnStepOutput: true when a task needs results from the previous step
- Assign tasks to the most appropriate employee
- Keep plans practical: 1-4 steps for most requests`;

interface LlmPlanStep {
  stepIndex: number;
  description: string;
  tasks: Array<{
    taskType: string;
    employeeId: string;
    description: string;
    dependsOnStepOutput: boolean;
  }>;
}

interface LlmPlan {
  summary: string;
  steps: LlmPlanStep[];
}

function parsePmPlan(content: string): LlmPlan | null {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    if (typeof parsed.summary !== 'string') return null;
    if (!Array.isArray(parsed.steps)) return null;

    const steps: LlmPlanStep[] = [];
    for (const s of parsed.steps) {
      if (typeof s !== 'object' || s === null) continue;
      const step = s as Record<string, unknown>;
      if (typeof step.stepIndex !== 'number') continue;
      if (typeof step.description !== 'string') continue;
      if (!Array.isArray(step.tasks)) continue;

      const tasks: LlmPlanStep['tasks'] = [];
      for (const t of step.tasks) {
        if (typeof t !== 'object' || t === null) continue;
        const task = t as Record<string, unknown>;
        if (
          typeof task.taskType === 'string' &&
          typeof task.employeeId === 'string' &&
          typeof task.description === 'string'
        ) {
          tasks.push({
            taskType: task.taskType,
            employeeId: task.employeeId,
            description: task.description,
            dependsOnStepOutput:
              typeof task.dependsOnStepOutput === 'boolean' ? task.dependsOnStepOutput : false,
          });
        }
      }

      if (tasks.length > 0) {
        steps.push({
          stepIndex: step.stepIndex,
          description: step.description,
          tasks,
        });
      }
    }

    return steps.length > 0 ? { summary: parsed.summary, steps } : null;
  } catch {
    return null;
  }
}

export async function pmPlannerNode(
  state: AicsGraphState,
  config: RunnableConfig,
): Promise<Partial<AicsGraphState>> {
  const runtimeCtx = (config.configurable as { runtimeCtx: RuntimeContext }).runtimeCtx;
  if (!runtimeCtx) {
    throw new GraphError('RuntimeContext not found in config.configurable', 'pm_planner');
  }

  // Announce node entry
  runtimeCtx.eventBus.emit(graphNodeEntered(runtimeCtx.companyId, state.threadId, 'pm_planner'));

  const { modelResolver, repos, eventBus, companyId, threadId } = runtimeCtx;
  const directive = state.managerDirective;

  // If no directive or no recommended employees, return empty plan
  if (!directive || directive.recommendedEmployees.length === 0) {
    return {
      taskPlan: null,
      currentStepIndex: 0,
      stepResults: [],
      currentStepOutputs: [],
    };
  }

  // Fetch employee details for recommended employees
  const employeeDetails = await Promise.all(
    directive.recommendedEmployees.map((id) => repos.employees.findById(id)),
  );
  const validEmployees = employeeDetails.filter(
    (e): e is NonNullable<typeof e> => e !== null && e.enabled === 1,
  );

  if (validEmployees.length === 0) {
    return {
      taskPlan: null,
      currentStepIndex: 0,
      stepResults: [],
      currentStepOutputs: [],
    };
  }

  const employeeList = validEmployees
    .map((e) => `- ${e.employee_id}: ${e.name} (${e.role_slug})`)
    .join('\n');

  const resolved = modelResolver.resolve(null, 'pm');

  const llmResponse = await recordedLlmCall(
    runtimeCtx,
    {
      messages: [
        {
          role: 'system',
          content: `${PM_SYSTEM_PROMPT}\n\nAvailable employees:\n${employeeList}`,
        },
        {
          role: 'user',
          content: `Intent: ${directive.intent}${directive.constraints ? `\nConstraints: ${directive.constraints}` : ''}`,
        },
      ],
      model: resolved.model,
      temperature: resolved.temperature,
      maxTokens: resolved.maxTokens,
    },
    { nodeName: 'pm_planner', provider: resolved.provider, model: resolved.model },
  );

  let plan = parsePmPlan(llmResponse.content);

  // Fallback: single-step plan assigning all recommended employees
  if (!plan) {
    plan = {
      summary: `Execute task: ${directive.intent}`,
      steps: [
        {
          stepIndex: 0,
          description: directive.intent,
          tasks: validEmployees.map((e) => ({
            taskType: 'general',
            employeeId: e.employee_id,
            description: directive.intent,
            dependsOnStepOutput: false,
          })),
        },
      ],
    };
  }

  const planId = generateId('plan');

  // Build TaskPlan and create taskRun records
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
        description: llmTask.description,
        dependsOnStepOutput: llmTask.dependsOnStepOutput,
        taskRunId,
      });
    }

    planSteps.push({
      stepIndex: llmStep.stepIndex,
      description: llmStep.description,
      tasks: planTasks,
    });
  }

  const taskPlan: TaskPlan = {
    planId,
    threadId,
    companyId,
    steps: planSteps,
    summary: plan.summary,
  };

  // Emit planCreated event
  eventBus.emit(
    planCreated(
      companyId,
      planId,
      threadId,
      planSteps.map((s) => ({
        stepIndex: s.stepIndex,
        description: s.description,
        taskCount: s.tasks.length,
      })),
    ),
  );

  return {
    taskPlan,
    currentStepIndex: 0,
    stepResults: [],
    currentStepOutputs: [],
  };
}
