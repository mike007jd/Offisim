import { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { graphNodeEntered } from '../events/event-factories.js';
import type { OffisimGraphState, PlanStep, PlanTask, TaskPlan } from '../graph/state.js';
import { recordedLlmCall } from '../llm/recorded-call.js';
import { appendAgentEvent } from '../utils/append-agent-event.js';
import { extractJsonFromLlm } from '../utils/extract-json.js';
import { generateId } from '../utils/generate-id.js';
import { getRuntime } from '../utils/get-runtime.js';
import { getConfigSignal } from '../utils/get-signal.js';

const PM_REPLAN_PROMPT = `You are the PM AI. The current plan has been partially executed, but a problem was reported.

Original plan:
{planSummary}

Steps:
{stepsDetail}

Completed steps: {completedSteps}
Employee feedback that triggered re-planning: "{feedback}"

Revise the remaining steps. You may:
- Replace steps that are no longer feasible
- Add new steps to address the problem
- Remove steps that are no longer needed
- Keep step indices sequential from {nextStepIndex}

Respond with JSON only:
{
  "reason": "why the plan changed",
  "revisedSteps": [
    {
      "stepIndex": <number>,
      "description": "what this step does",
      "phase": "optional phase name",
      "dependsOnSteps": [],
      "tasks": [
        {
          "taskType": "general",
          "employeeId": "<id>",
          "description": "specific instruction"
        }
      ]
    }
  ]
}`;

interface ReplanResult {
  reason: string;
  revisedSteps: Array<{
    stepIndex: number;
    description: string;
    phase?: string;
    dependsOnSteps?: number[];
    tasks: Array<{
      taskType: string;
      employeeId: string;
      description: string;
    }>;
  }>;
}

function parseReplanResult(content: string): ReplanResult | null {
  const parsed = extractJsonFromLlm(content) as Record<string, unknown> | null;
  if (!parsed) return null;
  if (typeof parsed.reason !== 'string') return null;
  if (!Array.isArray(parsed.revisedSteps)) return null;

  const revisedSteps: ReplanResult['revisedSteps'] = [];
  for (const s of parsed.revisedSteps as Record<string, unknown>[]) {
    if (typeof s.stepIndex !== 'number' || typeof s.description !== 'string') continue;
    if (!Array.isArray(s.tasks) || (s.tasks as unknown[]).length === 0) continue;

    const tasks: ReplanResult['revisedSteps'][0]['tasks'] = [];
    for (const t of s.tasks as Record<string, unknown>[]) {
      if (
        typeof t.taskType === 'string' &&
        typeof t.employeeId === 'string' &&
        typeof t.description === 'string'
      ) {
        tasks.push({ taskType: t.taskType, employeeId: t.employeeId, description: t.description });
      }
    }
    if (tasks.length > 0) {
      revisedSteps.push({
        stepIndex: s.stepIndex,
        description: s.description,
        phase: typeof s.phase === 'string' ? s.phase : undefined,
        dependsOnSteps: Array.isArray(s.dependsOnSteps)
          ? (s.dependsOnSteps as unknown[]).filter((n): n is number => typeof n === 'number')
          : undefined,
        tasks,
      });
    }
  }

  return revisedSteps.length > 0 ? { reason: parsed.reason, revisedSteps } : null;
}

/**
 * PM Re-Plan node — dynamically modifies the remaining DAG steps.
 *
 * Triggered when employee output contains REPLAN_NEEDED and replanCount < 3.
 * Keeps completed steps intact, replaces only unexecuted steps.
 */
export async function pmReplanNode(
  state: OffisimGraphState,
  config: RunnableConfig,
): Promise<Partial<OffisimGraphState>> {
  const runtimeCtx = getRuntime(config, 'pm_replan');

  runtimeCtx.eventBus.emit(graphNodeEntered(runtimeCtx.companyId, state.threadId, 'pm_replan'));

  const { repos, modelResolver, companyId, threadId } = runtimeCtx;
  const plan = state.taskPlan;

  if (!plan) {
    return {}; // No plan to replan
  }

  const completedIndices = new Set(state.completedStepIndices ?? []);
  const nextStepIndex = Math.max(...[...completedIndices, -1]) + 1;

  // Get the employee feedback that triggered this replan
  const lastOutputs = state.currentStepOutputs;
  const feedback =
    lastOutputs.length > 0
      ? lastOutputs.map((o) => `[${o.employeeName}]: ${o.content}`).join('\n')
      : 'Unknown feedback';

  // Build plan detail for prompt
  const stepsDetail = plan.steps
    .map(
      (s) =>
        `Step ${s.stepIndex} [${completedIndices.has(s.stepIndex) ? 'DONE' : 'PENDING'}]: ${s.description}`,
    )
    .join('\n');

  // Get available employees for the revised plan
  const employees = await repos.employees.findByCompany(companyId);
  const enabledEmployees = employees.filter((e) => e.enabled);
  const employeeList = enabledEmployees
    .map((e) => `${e.employee_id}: ${e.name} (${e.role_slug})`)
    .join(', ');

  const prompt = `${PM_REPLAN_PROMPT.replace('{planSummary}', plan.summary)
    .replace('{stepsDetail}', stepsDetail)
    .replace('{completedSteps}', [...completedIndices].sort().join(', ') || 'none')
    .replace('{feedback}', feedback)
    .replace('{nextStepIndex}', String(nextStepIndex))}\n\nAvailable employees: ${employeeList}`;

  const resolved = modelResolver.resolve(null, 'pm');

  const llmResponse = await recordedLlmCall(
    runtimeCtx,
    {
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: 'Revise the remaining steps based on the feedback.' },
      ],
      model: resolved.model,
      temperature: resolved.temperature,
      maxTokens: resolved.maxTokens,
      signal: getConfigSignal(config),
    },
    { nodeName: 'pm_replan', provider: resolved.provider, model: resolved.model },
  );

  const replanResult = parseReplanResult(llmResponse.content);

  if (!replanResult) {
    // LLM failed to produce valid replan — continue with original plan
    return {};
  }

  // Build new steps: keep completed, replace remaining
  const completedSteps = plan.steps.filter((s) => completedIndices.has(s.stepIndex));
  const newSteps: PlanStep[] = [...completedSteps];

  for (const revised of replanResult.revisedSteps) {
    const planTasks: PlanTask[] = [];
    for (const t of revised.tasks) {
      const taskRunId = generateId('tr');
      await repos.taskRuns.create({
        task_run_id: taskRunId,
        thread_id: threadId,
        employee_id: t.employeeId,
        parent_task_run_id: null,
        task_type: t.taskType,
        status: 'planned',
        input_json: JSON.stringify({ description: t.description }),
        output_json: null,
        started_at: new Date().toISOString(),
      });
      planTasks.push({
        taskType: t.taskType,
        employeeId: t.employeeId,
        description: t.description,
        dependsOnStepOutput: revised.stepIndex > 0,
        taskRunId,
      });
    }
    newSteps.push({
      stepIndex: revised.stepIndex,
      description: revised.description,
      tasks: planTasks,
      phase: revised.phase,
      dependsOnSteps: revised.dependsOnSteps,
    });
  }

  const updatedPlan: TaskPlan = {
    ...plan,
    steps: newSteps,
  };

  const newReplanCount = (state.replanCount ?? 0) + 1;

  // Record replan event
  await appendAgentEvent(runtimeCtx, {
    projectId: state.projectId,
    threadId: state.threadId,
    agentName: 'pm',
    eventType: 'replan',
    payload: {
      planId: plan.planId,
      version: newReplanCount,
      reason: replanResult.reason,
      removedSteps: plan.steps
        .filter((s) => !completedIndices.has(s.stepIndex))
        .map((s) => s.stepIndex),
      addedSteps: replanResult.revisedSteps.map((s) => s.stepIndex),
      completedBefore: [...completedIndices],
    },
  });

  return {
    taskPlan: updatedPlan,
    replanCount: newReplanCount,
    // Reset dispatch tracking for the new steps
    dispatchedStepIndices: [...completedIndices],
    currentStepOutputs: [],
    messages: [
      new AIMessage({
        content: `[PM Re-Plan] Plan revised (v${newReplanCount}): ${replanResult.reason}. ${replanResult.revisedSteps.length} new steps created.`,
      }),
    ],
  };
}
