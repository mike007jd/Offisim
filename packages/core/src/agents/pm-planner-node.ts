import type { RunnableConfig } from '@langchain/core/runnables';
import { PLAN_REVIEW_REQUIRED, type SopDefinition, type SopStep } from '@offisim/shared-types';
import { graphNodeEntered, planCreated } from '../events/event-factories.js';
import type { OffisimGraphState, PlanStep, PlanTask, TaskPlan } from '../graph/state.js';
import { recordedLlmCall } from '../llm/recorded-call.js';
import type { EmployeeRow, SopTemplateRow } from '../runtime/repositories.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { SopService } from '../services/sop-service.js';
import { appendAgentEvent } from '../utils/append-agent-event.js';
import { extractJsonFromLlm } from '../utils/extract-json.js';
import { generateId } from '../utils/generate-id.js';
import { getRuntime } from '../utils/get-runtime.js';
import { getConfigSignal } from '../utils/get-signal.js';
import { buildEnrichedEmployeeList, readRuntimeSkill, safeParseJson } from './employee-roster.js';

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
          "dependsOnStepOutput": false,
          "requiredSkills": ["optional relevant skill keyword"]
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
- When assigning tasks, consider employee expertise and skills
- If an employee's installed skill package is relevant, mention that alignment in the task description
- Add requiredSkills when a task clearly benefits from a specific skill package or specialty
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
    requiredSkills?: string[];
  }>;
}

interface LlmPlan {
  summary: string;
  steps: LlmPlanStep[];
}

function formatPlanReviewPrompt(plan: LlmPlan): string {
  const stepPreview = plan.steps
    .slice(0, 4)
    .map((step) => `${step.stepIndex + 1}. ${step.description} (${step.tasks.length} tasks)`)
    .join('\n');
  const extraSteps =
    plan.steps.length > 4
      ? `\n+ ${plan.steps.length - 4} more step${plan.steps.length === 5 ? '' : 's'}`
      : '';
  return `Review the plan before execution.\nSummary: ${plan.summary}\n${stepPreview}${extraSteps}`;
}

function buildPlanReviewReason(plan: LlmPlan, revisionNote: string | null): string {
  if (revisionNote) {
    return 'The updated plan reflects your requested changes and is ready to run.';
  }
  return `The plan is structured into ${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'} and looks ready to execute.`;
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
          requiredSkills: Array.isArray(task.requiredSkills)
            ? task.requiredSkills.filter((skill): skill is string => typeof skill === 'string')
            : undefined,
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
    const pattern = new RegExp(`(?:^|[\\s,."'!?])${escaped}(?:$|[\\s,."'!?])`, 'i');
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
  preferSkill?: string,
): EmployeeRow | null {
  const enabled = employees.filter((e) => e.enabled === 1);
  const exactMatches = enabled.filter((e) => e.role_slug === roleSlug);
  const normalizedSkill = preferSkill?.trim().toLowerCase();

  if (normalizedSkill) {
    const skillMatch = exactMatches.find((employee) => {
      const config = safeParseJson(employee.config_json);
      const skill = readRuntimeSkill(config);
      if (!skill) return false;
      const haystack = [skill.skillName, skill.summary]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedSkill);
    });
    if (skillMatch) return skillMatch;
  }

  const exact = exactMatches[0];
  if (exact) return exact;
  // Fallback: any enabled employee
  return enabled[0] ?? null;
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
): Promise<{ plan: LlmPlan; sopTemplateId: string } | null> {
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

  return { plan: sopBatchesToLlmPlan(sopDef, batches, allEmployees), sopTemplateId: matched.sop_template_id };
}

export async function pmPlannerNode(
  state: OffisimGraphState,
  config: RunnableConfig,
): Promise<Partial<OffisimGraphState>> {
  const runtimeCtx = getRuntime(config, 'pm_planner');

  // Announce node entry
  runtimeCtx.eventBus.emit(graphNodeEntered(runtimeCtx.companyId, state.threadId, 'pm_planner'));

  const { modelResolver, repos, eventBus, companyId, threadId } = runtimeCtx;
  const directive = state.managerDirective;
  const interactionService = runtimeCtx.interactionService;
  const interactionMode = interactionService?.getMode() ?? 'boss_proxy';
  const planReviewDecision = interactionService?.consumePlanReviewDecision(threadId) ?? null;
  const approvedToExecute = planReviewDecision?.selectedOptionId === 'start_execution';
  const planRevisionNote =
    planReviewDecision?.selectedOptionId === 'revise_plan'
      ? planReviewDecision.freeformResponse?.trim() || 'Revise the plan before execution.'
      : null;
  const reviewedPlan =
    approvedToExecute && planReviewDecision?.reviewedPayload
      ? (planReviewDecision.reviewedPayload as LlmPlan)
      : null;

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

  let plan: LlmPlan | null = reviewedPlan;
  let resolvedSopTemplateId: string | undefined;

  // Explicit SOP selection takes priority over substring matching
  if (directive.sopTemplateId && !planRevisionNote) {
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
            resolvedSopTemplateId = directive.sopTemplateId;
          }
        }
      } catch {
        /* fall through to tryBuildSopPlan */
      }
    }
  }

  // Fall back to substring matching if no explicit SOP
  if (!plan && !planRevisionNote) {
    const sopResult = await tryBuildSopPlan(repos, eventBus, companyId, directive.intent, allEnabled);
    if (sopResult) {
      plan = sopResult.plan;
      resolvedSopTemplateId = sopResult.sopTemplateId;
    }
  }

  // --- Fallback to LLM planning if no SOP matched ---
  if (!plan) {
    const employeeList = buildEnrichedEmployeeList(validEmployees);

    // --- Inject historical experience from company memory ---
    let experienceSection = '';
    if (runtimeCtx.memoryService) {
      try {
        const experiences = await runtimeCtx.memoryService.getRelevantMemories(
          'pm', // PM is the "employee" querying
          companyId,
          directive.intent,
          5,
        );
        const companyExperiences = experiences.filter(
          (m) => m.scope === 'company' && m.category === 'experience',
        );
        if (companyExperiences.length > 0) {
          experienceSection = `\n\nPast project experience (use as guidance, not rules):\n${companyExperiences.map((m) => `- ${m.content}`).join('\n')}`;
        }
      } catch {
        // Non-critical — proceed without experience
      }
    }

    const resolved = modelResolver.resolve(null, 'pm');

    const llmResponse = await recordedLlmCall(
      runtimeCtx,
      {
        messages: [
          {
            role: 'system',
            content: `${PM_SYSTEM_PROMPT}\n\nAvailable employees:\n${employeeList}${experienceSection}`,
          },
          {
            role: 'user',
            content:
              `Intent: ${directive.intent}` +
              `${directive.constraints ? `\nConstraints: ${directive.constraints}` : ''}` +
              `${planRevisionNote ? `\nPlan revision request: ${planRevisionNote}` : ''}`,
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

  if (interactionService && interactionMode === 'human_in_loop' && !approvedToExecute) {
    interactionService.rememberPlanReviewPayload(threadId, plan);
    await interactionService.request({
      interactionId: generateId('ix'),
      threadId,
      companyId,
      kind: 'plan_review',
      severity: 'normal',
      title: 'Review plan before execution',
      prompt: formatPlanReviewPrompt(plan),
      options: [
        { id: 'start_execution', label: 'Start execution', recommended: true },
        { id: 'revise_plan', label: 'Revise plan' },
        { id: 'cancel', label: 'Cancel' },
      ],
      recommendation: {
        optionId: 'start_execution',
        reason: buildPlanReviewReason(plan, planRevisionNote),
      },
      allowFreeformResponse: true,
      placeholder: 'Tell Offisim what to change in the plan',
      requestedByNode: 'pm_planner',
      context: {
        type: 'plan_review',
        planId: null,
      },
      createdAt: Date.now(),
    });
    throw new Error(PLAN_REVIEW_REQUIRED);
  }

  const planId = generateId('plan');
  runtimeCtx.scratchpad.write(
    `pm.plan.${threadId}`,
    `Plan summary: ${plan.summary}. Steps: ${plan.steps
      .map((step) => `${step.stepIndex + 1}. ${step.description}`)
      .join(' | ')}`,
    'pm_planner',
  );

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
        tasks: s.tasks.map((t) => {
          if (!t.taskRunId) {
            throw new Error('Expected planner task to have a taskRunId');
          }
          return {
            taskRunId: t.taskRunId,
            taskType: t.taskType,
            description: t.description,
            employeeId: t.employeeId,
          };
        }),
      })),
      resolvedSopTemplateId,
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
