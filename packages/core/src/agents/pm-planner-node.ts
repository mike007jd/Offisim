import type { SopDefinition, SopStep } from '@aics/shared-types';
import type { RunnableConfig } from '@langchain/core/runnables';
import { GraphError } from '../errors.js';
import { graphNodeEntered, planCreated } from '../events/event-factories.js';
import type { AicsGraphState, PlanStep, PlanTask, TaskPlan } from '../graph/state.js';
import { recordedLlmCall } from '../llm/recorded-call.js';
import type { EmployeeRow, SopTemplateRow } from '../runtime/repositories.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { SopService } from '../services/sop-service.js';
import { extractJsonFromLlm } from '../utils/extract-json.js';
import { getConfigSignal } from '../utils/get-signal.js';
import { generateId } from '../utils/generate-id.js';

/** @internal — exported for testing */
export const PM_SYSTEM_PROMPT = `You are the PM AI — responsible for breaking down work into structured execution plans.

Given the user's intent and available employees with their capabilities, create a step-by-step plan.

Respond with JSON only:
{
  "summary": "one sentence describing the overall plan",
  "steps": [
    {
      "stepIndex": 0,
      "phase": "phase name (optional, for grouping related steps)",
      "description": "what this step accomplishes",
      "dependsOnSteps": [],
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
- Steps execute sequentially by stepIndex order
- Tasks within a step execute in parallel
- Set dependsOnStepOutput: true when a task needs results from the previous step
- Assign tasks to the most appropriate employee
- For simple requests: 1-4 steps
- For complex projects: use phases to group related steps (e.g. "研究", "设计", "开发", "测试")
- dependsOnSteps is reserved for future parallel step execution — set it accurately but steps still run in order`;

export interface LlmPlanStep {
  stepIndex: number;
  description: string;
  phase?: string;
  dependsOnSteps?: number[];
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

export function parsePmPlan(content: string): LlmPlan | null {
  const parsed = extractJsonFromLlm(content) as Record<string, unknown> | null;
  if (!parsed) return null;
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
        phase: typeof step.phase === 'string' ? step.phase : undefined,
        dependsOnSteps: Array.isArray(step.dependsOnSteps)
          ? step.dependsOnSteps.filter((n): n is number => typeof n === 'number')
          : undefined,
      });
    }
  }

  return steps.length > 0 ? { summary: parsed.summary, steps } : null;
}

// ---------------------------------------------------------------------------
// SOP-aware plan building
// ---------------------------------------------------------------------------

/**
 * Match an SOP template by name against the user intent text.
 * Uses word-boundary matching to avoid false positives
 * (e.g. "I don't need code review" should NOT match "code review").
 */
export function matchSopTemplate(
  templates: SopTemplateRow[],
  intentText: string,
): SopTemplateRow | null {
  for (const t of templates) {
    const escaped = t.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Require the template name to appear as a distinct phrase —
    // preceded by start/whitespace/punctuation and followed by end/whitespace/punctuation
    const pattern = new RegExp(
      `(?:^|[\\s,."'!?])${escaped}(?:$|[\\s,."'!?])`,
      'i',
    );
    if (pattern.test(intentText)) {
      return t;
    }
  }
  return null;
}

/**
 * Find the best employee for a given SOP step's role_slug.
 * Exact role_slug match first, then fall back to first available employee.
 */
export function findEmployeeForRole(
  employees: EmployeeRow[],
  roleSlug: string,
): EmployeeRow | null {
  const exact = employees.find((e) => e.role_slug === roleSlug && e.enabled === 1);
  if (exact) return exact;
  // Fallback: any enabled employee
  return employees.find((e) => e.enabled === 1) ?? null;
}

/**
 * Convert SOP execution batches into the LlmPlan structure.
 * Each batch becomes a PlanStep; each SopStep in the batch becomes a task.
 */
export function sopBatchesToLlmPlan(
  sopDef: SopDefinition,
  batches: SopStep[][],
  employees: EmployeeRow[],
): LlmPlan {
  const steps: LlmPlanStep[] = batches.map((batch, batchIndex) => ({
    stepIndex: batchIndex,
    description: batch.map((s) => s.label).join(' + '),
    tasks: batch.map((sopStep) => {
      const employee = findEmployeeForRole(employees, sopStep.role_slug);
      return {
        taskType: 'general',
        employeeId: employee?.employee_id ?? '',
        description: sopStep.instruction,
        dependsOnStepOutput: batchIndex > 0,
      };
    }),
  }));

  return {
    summary: `SOP: ${sopDef.name} — ${sopDef.description}`,
    steps,
  };
}

/**
 * Attempt to build a plan from SOP templates. Returns null if no SOP matches.
 * Exported for testability.
 */
export async function tryBuildSopPlan(
  repos: RuntimeContext['repos'],
  eventBus: RuntimeContext['eventBus'],
  companyId: string,
  intentText: string,
  allEmployees: EmployeeRow[],
): Promise<LlmPlan | null> {
  const templates = await repos.sopTemplates.findByCompany(companyId);
  if (templates.length === 0) return null;

  const matched = matchSopTemplate(templates, intentText);
  if (!matched) return null;

  let sopDef: SopDefinition;
  try {
    sopDef = JSON.parse(matched.definition_json);
  } catch {
    return null; // Corrupt definition_json — skip this SOP
  }
  const sopService = new SopService(repos.sopTemplates, eventBus);

  // Validate before using
  const validation = sopService.validateDefinition(sopDef);
  if (!validation.valid) return null;

  const batches = sopService.getExecutionOrder(sopDef);
  if (batches.length === 0) return null;

  return sopBatchesToLlmPlan(sopDef, batches, allEmployees);
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

  // --- SOP-aware planning: check if intent references a known SOP template ---
  const allEmployees = await repos.employees.findByCompany(companyId);
  const allEnabled = allEmployees.filter((e) => e.enabled === 1);

  let plan: LlmPlan | null = null;

  // Explicit SOP selection takes priority over substring matching
  if (directive.sopTemplateId) {
    const template = await repos.sopTemplates.findById(directive.sopTemplateId);
    if (template) {
      try {
        const sopDef: SopDefinition = JSON.parse(template.definition_json);
        const sopService = new SopService(repos.sopTemplates, eventBus);
        const validation = sopService.validateDefinition(sopDef);
        if (validation.valid) {
          const batches = sopService.getExecutionOrder(sopDef);
          if (batches.length > 0) {
            plan = sopBatchesToLlmPlan(sopDef, batches, allEnabled);
          }
        }
      } catch { /* fall through to tryBuildSopPlan */ }
    }
  }

  // Fall back to substring matching if no explicit SOP
  if (!plan) {
    plan = await tryBuildSopPlan(
      repos,
      eventBus,
      companyId,
      directive.intent,
      allEnabled,
    );
  }

  // --- Fallback to LLM planning if no SOP matched ---
  if (!plan) {
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
        signal: getConfigSignal(config),
      },
      { nodeName: 'pm_planner', provider: resolved.provider, model: resolved.model },
    );

    plan = parsePmPlan(llmResponse.content);

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

  // Emit planCreated event
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
        tasks: s.tasks.map((t) => ({
          // taskRunId is always set by generateId() above — planSteps only contain
          // tasks created in this function where taskRunId is assigned before push
          taskRunId: t.taskRunId!,
          taskType: t.taskType,
          description: t.description,
          employeeId: t.employeeId,
        })),
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
