import type { EmployeeRow } from '../../runtime/repositories.js';
import { extractJsonFromLlm } from '../../utils/extract-json.js';
import type { LlmPlan, LlmPlanStep } from '../pm-planner-types.js';

export type { LlmPlanStep };

const ARTIFACT_WORKFLOW_RE =
  /\b(pdf|ppt|pptx|html|infographic|copy|organize|directory|folder|codebase)\b|代码库|源码|项目|分析报告|复制|拷贝|整理|目录|文件夹|输出|生成|保存/u;

function findEmployee(
  employees: EmployeeRow[],
  predicate: (employee: EmployeeRow) => boolean,
  used: Set<string>,
): EmployeeRow | undefined {
  const found = employees.find(
    (employee) => !used.has(employee.employee_id) && predicate(employee),
  );
  if (found) used.add(found.employee_id);
  return found;
}

function taskTypeForRole(roleSlug: string): string {
  if (roleSlug.includes('design')) return 'design';
  if (roleSlug.includes('frontend') || roleSlug.includes('fullstack')) return 'code';
  if (
    roleSlug.includes('backend') ||
    roleSlug.includes('developer') ||
    roleSlug.includes('engineer')
  ) {
    return 'code';
  }
  if (roleSlug.includes('qa') || roleSlug.includes('review')) return 'review';
  if (roleSlug.includes('manager')) return 'analysis';
  return 'general';
}

function taskFor(employee: EmployeeRow, description: string, dependsOnStepOutput = false) {
  return {
    taskType: taskTypeForRole(employee.role_slug),
    employeeId: employee.employee_id,
    description,
    dependsOnStepOutput,
  };
}

function buildArtifactWorkflowFallback(employees: EmployeeRow[], intent: string): LlmPlan {
  const used = new Set<string>();
  const coordinator =
    findEmployee(employees, (e) => e.role_slug.includes('manager'), used) ??
    findEmployee(employees, () => true, used);
  const analyst =
    findEmployee(
      employees,
      (e) => /backend|developer|engineer|fullstack/u.test(e.role_slug),
      used,
    ) ?? findEmployee(employees, () => true, used);
  const fileOperator =
    findEmployee(employees, (e) => /fullstack|developer|engineer/u.test(e.role_slug), used) ??
    findEmployee(employees, () => true, used);
  const presentationOwner =
    findEmployee(employees, (e) => /design|frontend|ux/u.test(e.role_slug), used) ??
    findEmployee(employees, () => true, used);
  const htmlOwner =
    findEmployee(employees, (e) => /frontend|design|ux/u.test(e.role_slug), used) ??
    findEmployee(employees, () => true, used);
  const qaOwner =
    findEmployee(employees, (e) => /qa|review/u.test(e.role_slug), used) ??
    findEmployee(employees, (e) => /OpenRouter QA Analyst/u.test(e.name), used) ??
    findEmployee(employees, () => true, used);
  const modelValidators = employees.filter(
    (employee) =>
      !used.has(employee.employee_id) &&
      /MiniMax Stress Engineer|ZAI Planning Engineer|OpenRouter QA Analyst/u.test(employee.name),
  );
  for (const employee of modelValidators) used.add(employee.employee_id);

  const steps: LlmPlanStep[] = [];
  if (coordinator) {
    steps.push({
      stepIndex: 0,
      phase: 'project_selection',
      description:
        'Select a suitable source project and initialize the requested desktop deliverable structure.',
      tasks: [
        taskFor(
          coordinator,
          `Select one suitable project from the workspace, create the requested output directory structure, and record the selected project and rationale. Full user intent: ${intent}`,
        ),
      ],
    });
  }
  if (analyst || modelValidators.length > 0) {
    steps.push({
      stepIndex: steps.length,
      phase: 'analysis',
      description: 'Analyze the selected project and produce role-specific findings.',
      dependsOnSteps: [0],
      tasks: [
        ...(analyst
          ? [
              taskFor(
                analyst,
                `Analyze the selected project codebase and draft the codebase analysis content for the final PDF/report. Include product positioning, modules, flows, run commands, risks, and hygiene advice. Full user intent: ${intent}`,
                true,
              ),
            ]
          : []),
        ...modelValidators.map((employee) =>
          taskFor(
            employee,
            `Contribute a concise model/provider validation note and one role-specific project risk or hygiene finding. Do not redo the whole task. Full user intent: ${intent}`,
            true,
          ),
        ),
      ],
    });
  }
  if (fileOperator) {
    steps.push({
      stepIndex: steps.length,
      phase: 'source_copy',
      description:
        'Copy the selected project into the requested desktop test folder with generated directories excluded.',
      dependsOnSteps: [Math.max(0, steps.length - 1)],
      tasks: [
        taskFor(
          fileOperator,
          `Copy the selected project into the requested 01_source_copy folder, excluding .git, node_modules, dist, build, .turbo, target, DerivedData, .venv and similar generated directories. Full user intent: ${intent}`,
          true,
        ),
      ],
    });
  }
  steps.push({
    stepIndex: steps.length,
    phase: 'artifacts',
    description: 'Generate the report, presentation, and self-contained HTML infographic.',
    dependsOnSteps: [Math.max(0, steps.length - 1)],
    tasks: [
      ...(analyst
        ? [
            taskFor(
              analyst,
              `Generate the codebase analysis PDF/report in the requested 02_analysis folder using the selected project findings. Full user intent: ${intent}`,
              true,
            ),
          ]
        : []),
      ...(presentationOwner
        ? [
            taskFor(
              presentationOwner,
              `Generate the requested 8-12 page project PPT/presentation artifact in 03_presentation. Full user intent: ${intent}`,
              true,
            ),
          ]
        : []),
      ...(htmlOwner
        ? [
            taskFor(
              htmlOwner,
              `Generate the self-contained HTML infographic at the requested 04_infographic path. Full user intent: ${intent}`,
              true,
            ),
          ]
        : []),
    ],
  });
  if (qaOwner || coordinator) {
    steps.push({
      stepIndex: steps.length,
      phase: 'verification_summary',
      description: 'Verify all requested files exist and produce the final delivery summary.',
      dependsOnSteps: [Math.max(0, steps.length - 1)],
      tasks: [
        ...(qaOwner
          ? [
              taskFor(
                qaOwner,
                `Verify the requested folder structure and artifacts, write evidence/manifest under 05_evidence, and list any missing files. Full user intent: ${intent}`,
                true,
              ),
            ]
          : []),
        ...(coordinator
          ? [
              taskFor(
                coordinator,
                `Write the final delivery summary with generated file paths, selected project, employee responsibilities, issues, and completion status. Full user intent: ${intent}`,
                true,
              ),
            ]
          : []),
      ],
    });
  }

  return {
    summary: `Fallback phased artifact workflow for: ${intent}`,
    steps: steps.length > 0 ? steps : buildSimpleFallbackSteps(employees, intent),
  };
}

function buildSimpleFallbackSteps(employees: EmployeeRow[], intent: string): LlmPlanStep[] {
  return [
    {
      stepIndex: 0,
      description: intent,
      tasks: employees.map((e) => ({
        taskType: 'general',
        employeeId: e.employee_id,
        description: intent,
        dependsOnStepOutput: false,
      })),
    },
  ];
}

/** Fallback plan when the LLM response cannot be parsed. */
export function buildLlmPlanFallback(employees: EmployeeRow[], intent: string): LlmPlan {
  if (ARTIFACT_WORKFLOW_RE.test(intent)) {
    return buildArtifactWorkflowFallback(employees, intent);
  }
  return {
    summary: `Execute task: ${intent}`,
    steps: buildSimpleFallbackSteps(employees, intent),
  };
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

  if (steps.length === 0) return null;
  const recommendedEmployees = Array.isArray(parsed.recommendedEmployees)
    ? parsed.recommendedEmployees.filter((id): id is string => typeof id === 'string')
    : undefined;
  return {
    summary: parsed.summary,
    steps,
    ...(recommendedEmployees && recommendedEmployees.length > 0 ? { recommendedEmployees } : {}),
  };
}
