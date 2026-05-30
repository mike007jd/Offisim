import { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { graphNodeEntered } from '../events/event-factories.js';
import type { OffisimGraphState, PlanStep, PlanTask, TaskPlan } from '../graph/state.js';
import { recordedLlmCall } from '../llm/recorded-call.js';
import { appendAgentEvent } from '../utils/append-agent-event.js';
import { extractJsonFromLlm } from '../utils/extract-json.js';
import { generateId } from '../utils/generate-id.js';
import { getRunScope, getRuntime } from '../utils/get-runtime.js';
import { getConfigSignal } from '../utils/get-signal.js';
import { emitAssignmentRerouted } from './emit-assignment-rerouted.js';
import { classifyDropReason } from './pm-planner/sanitize-rebind.js';

const PM_REPLAN_TIMEOUT_MS = 45_000;

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
          "description": "specific instruction",
          "dependsOnStepOutput": false,
          "requiredSkills": ["optional relevant skill keyword"]
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
      dependsOnStepOutput?: boolean;
      requiredSkills?: string[];
    }>;
  }>;
}

function parseReplanResult(content: string): ReplanResult | null {
  const parsed = extractJsonFromLlm(content) as Record<string, unknown> | null;
  if (!parsed) return null;
  if (typeof parsed.reason !== 'string') return null;
  if (!Array.isArray(parsed.revisedSteps)) return null;

  const revisedSteps: ReplanResult['revisedSteps'] = [];
  for (const s of parsed.revisedSteps as unknown[]) {
    if (!s || typeof s !== 'object') continue;
    const step = s as Record<string, unknown>;
    if (typeof step.stepIndex !== 'number' || typeof step.description !== 'string') continue;
    if (!Array.isArray(step.tasks) || (step.tasks as unknown[]).length === 0) continue;

    const tasks: ReplanResult['revisedSteps'][0]['tasks'] = [];
    for (const rawTask of step.tasks as unknown[]) {
      if (!rawTask || typeof rawTask !== 'object') continue;
      const t = rawTask as Record<string, unknown>;
      if (
        typeof t.taskType === 'string' &&
        typeof t.employeeId === 'string' &&
        typeof t.description === 'string'
      ) {
        tasks.push({
          taskType: t.taskType,
          employeeId: t.employeeId,
          description: t.description,
          dependsOnStepOutput:
            typeof t.dependsOnStepOutput === 'boolean' ? t.dependsOnStepOutput : undefined,
          requiredSkills: Array.isArray(t.requiredSkills)
            ? t.requiredSkills.filter((skill): skill is string => typeof skill === 'string')
            : undefined,
        });
      }
    }
    if (tasks.length > 0) {
      revisedSteps.push({
        stepIndex: step.stepIndex,
        description: step.description,
        phase: typeof step.phase === 'string' ? step.phase : undefined,
        dependsOnSteps: Array.isArray(step.dependsOnSteps)
          ? (step.dependsOnSteps as unknown[]).filter((n): n is number => typeof n === 'number')
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

  runtimeCtx.eventBus.emit(
    graphNodeEntered(runtimeCtx.companyId, state.threadId, 'pm_replan', getRunScope(config)),
  );

  const { repos, modelResolver, companyId, threadId } = runtimeCtx;
  const plan = state.taskPlan;

  if (!plan) {
    return {}; // No plan to replan
  }

  const completedIndices = new Set(state.completedStepIndices ?? []);
  const blockedIndices = new Set(state.blockedStepIndices ?? []);
  // Renumber revised steps above EVERY reserved index — completed (kept in the
  // new plan) and blocked (may still be referenced in run state) — so a fresh
  // step index can never collide with one and get dropped or aliased.
  const nextStepIndex = Math.max(-1, ...completedIndices, ...blockedIndices) + 1;

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
  const enabledEmployees = employees.filter((e) => e.enabled === 1);
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
      maxTokens: Math.min(resolved.maxTokens, 2048),
      signal: getConfigSignal(config),
      timeoutMs: PM_REPLAN_TIMEOUT_MS,
    },
    {
      nodeName: 'pm_replan',
      provider: resolved.provider,
      model: resolved.model,
      projectId: state.projectId,
    },
  );

  const replanResult = parseReplanResult(llmResponse.content);

  if (!replanResult) {
    // LLM failed to produce valid replan — continue with original plan
    return {};
  }

  // With no assignable employee there is nobody to route revised tasks to;
  // keep the original plan rather than persist taskRuns pinned to invalid ids.
  const fallbackEmployee = enabledEmployees[0];
  if (!fallbackEmployee) {
    return {};
  }
  const enabledIds = new Set(enabledEmployees.map((e) => e.employee_id));
  const fallbackEmployeeId = fallbackEmployee.employee_id;

  // Build new steps: keep completed, replace remaining. Revised steps are
  // RENUMBERED sequentially from nextStepIndex (F1) so an LLM-chosen stepIndex
  // can never collide with a completed step and get silently dropped. We map
  // the LLM's original index -> the assigned index so dependencies can be
  // remapped onto the survivors (F2).
  const completedSteps = plan.steps.filter((s) => completedIndices.has(s.stepIndex));
  const newSteps: PlanStep[] = [...completedSteps];

  const indexMap = new Map<number, number>();
  replanResult.revisedSteps.forEach((revised, i) => {
    if (!indexMap.has(revised.stepIndex)) {
      indexMap.set(revised.stepIndex, nextStepIndex + i);
    }
  });

  const addedSteps: number[] = [];
  let revisedOrdinal = 0;
  for (const revised of replanResult.revisedSteps) {
    const newIndex = nextStepIndex + revisedOrdinal;
    revisedOrdinal += 1;

    const planTasks: PlanTask[] = [];
    const seenEmployees = new Set<string>();
    for (const t of revised.tasks) {
      // Rebind invalid/disabled assignees to a valid employee and make the
      // reroute observable (F3) — replan previously bypassed sanitize-rebind.
      let resolvedEmployeeId = t.employeeId;
      if (!enabledIds.has(resolvedEmployeeId)) {
        resolvedEmployeeId = fallbackEmployeeId;
        emitAssignmentRerouted({
          companyId,
          threadId,
          taskRunId: `pm-replan:${threadId}:${newIndex}`,
          requestedEmployeeId: t.employeeId,
          resolvedEmployeeId,
          // Replan has no planner-recommended ordering, so a valid-but-rebound
          // assignment is always `no-recommendation-fallback`.
          reason: classifyDropReason(t.employeeId, employees, false),
          source: 'pm-planner',
          eventBus: runtimeCtx.eventBus,
        });
      }
      // Defensive dedupe: rebinding several invalid ids to the same fallback
      // must not spawn duplicate taskRuns for one employee within a step.
      if (seenEmployees.has(resolvedEmployeeId)) continue;
      seenEmployees.add(resolvedEmployeeId);

      const taskRunId = generateId('tr');
      await repos.taskRuns.create({
        task_run_id: taskRunId,
        thread_id: threadId,
        employee_id: resolvedEmployeeId,
        parent_task_run_id: null,
        task_type: t.taskType,
        status: 'planned',
        input_json: JSON.stringify({ description: t.description }),
        output_json: null,
        started_at: new Date().toISOString(),
      });
      planTasks.push({
        taskType: t.taskType,
        employeeId: resolvedEmployeeId,
        description: t.description,
        // Honor the LLM's explicit dependsOnStepOutput; default to "depends on
        // the previous step" for any step past the first, matching the prior
        // replan behavior when the field is absent.
        dependsOnStepOutput: t.dependsOnStepOutput ?? newIndex > 0,
        requiredSkills: t.requiredSkills,
        taskRunId,
      });
    }

    if (planTasks.length === 0) continue;

    // Remap dependencies onto surviving indices: keep deps on completed steps,
    // translate deps on sibling revised steps to their new index, and drop any
    // dangling edge that references a removed/unknown step (F2) so dispatch
    // cannot deadlock waiting on a step that no longer exists.
    const remappedDeps = (revised.dependsOnSteps ?? [])
      .map((oldDep) => {
        if (completedIndices.has(oldDep)) return oldDep;
        const mapped = indexMap.get(oldDep);
        if (mapped === undefined || mapped === newIndex) return null;
        return mapped;
      })
      .filter((d): d is number => d !== null);

    newSteps.push({
      stepIndex: newIndex,
      description: revised.description,
      tasks: planTasks,
      phase: revised.phase,
      dependsOnSteps: remappedDeps.length > 0 ? remappedDeps : undefined,
    });
    addedSteps.push(newIndex);
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
      addedSteps,
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
        content: `[PM Re-Plan] Plan revised (v${newReplanCount}): ${replanResult.reason}. ${addedSteps.length} new steps created.`,
      }),
    ],
  };
}
