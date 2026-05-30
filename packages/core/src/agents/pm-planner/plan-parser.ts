import type { EmployeeRow } from '../../runtime/repositories.js';
import { extractJsonFromLlm } from '../../utils/extract-json.js';
import type { LlmPlan, LlmPlanStep } from '../pm-planner-types.js';

export type { LlmPlanStep };

const ARTIFACT_WORKFLOW_RE =
  /\b(pdf|ppt|pptx|html|infographic|copy|organize|directory|folder|codebase)\b|代码库|源码|项目|分析报告|复制|拷贝|整理|目录|文件夹|输出|生成|保存/u;
// Each relative path segment is matched with a leading separator (`/`) so the
// repeated group cannot overlap-backtrack with the trailing segment — this avoids
// the nested `(?:[chars]+\/)+[chars]+` quantifier (a ReDoS surface) of the earlier
// form while matching the same set of paths.
const PATH_CANDIDATE_RE =
  /(?:^|[\s("'`])((?:\/[^\s"'`]+|(?:\.{1,2}\/)?[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+(?:\.[A-Za-z0-9._-]+)?))(?=$|[\s)"'`,.;:，。；：、])/gu;
// Cap the slice scanned for path candidates so unbounded user intent cannot turn
// the regex scan into a denial-of-service vector.
const PATH_SCAN_MAX_CHARS = 20_000;

const DEFAULT_ARTIFACT_TARGETS = {
  sourceCopy: 'deliverables/01_source_copy/source_project',
  pdf: 'deliverables/02_analysis/codebase-analysis.pdf',
  presentation: 'deliverables/03_presentation/project-overview.pptx',
  html: 'deliverables/04_infographic/project-infographic.html',
  manifest: 'deliverables/05_evidence/manifest.json',
} as const;

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

export function taskTypeForRole(roleSlug: string): string {
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

function stripTrailingPathPunctuation(path: string): string {
  return path.replace(/[),.;:，。；：、]+$/u, '');
}

function extractIntentPaths(intent: string): string[] {
  const targets = new Set<string>();
  const scanned =
    intent.length > PATH_SCAN_MAX_CHARS ? intent.slice(0, PATH_SCAN_MAX_CHARS) : intent;
  for (const match of scanned.matchAll(PATH_CANDIDATE_RE)) {
    const candidate = stripTrailingPathPunctuation(match[1]?.trim() ?? '');
    if (!candidate || candidate.includes('://')) continue;
    targets.add(candidate);
  }
  return [...targets];
}

function sourceCopyTargetFromPath(path: string): string | null {
  const normalized = path.replace(/\\/gu, '/');
  const sourceProjectMarker = '/source_project/';
  const sourceProjectIndex = normalized.indexOf(sourceProjectMarker);
  if (sourceProjectIndex >= 0) {
    return normalized.slice(0, sourceProjectIndex + sourceProjectMarker.length - 1);
  }
  const rootMarker = '01_source_copy/';
  const rootIndex = normalized.indexOf(rootMarker);
  if (rootIndex >= 0) {
    const afterRoot = normalized.slice(rootIndex + rootMarker.length);
    const firstSegment = afterRoot.split('/')[0];
    return firstSegment
      ? normalized.slice(0, rootIndex + rootMarker.length + firstSegment.length)
      : normalized.slice(0, rootIndex + rootMarker.length - 1);
  }
  return null;
}

function artifactTargetsFromIntent(intent: string) {
  const paths = extractIntentPaths(intent);
  const find = (predicate: (path: string) => boolean, fallback: string): string =>
    paths.find(predicate) ?? fallback;
  const sourcePath =
    paths.map(sourceCopyTargetFromPath).find((path): path is string => Boolean(path)) ??
    DEFAULT_ARTIFACT_TARGETS.sourceCopy;
  return {
    sourceCopy: sourcePath,
    pdf: find(
      (path) => /\.pdf$/iu.test(path) || path.includes('/02_analysis/'),
      DEFAULT_ARTIFACT_TARGETS.pdf,
    ),
    presentation: find(
      (path) => /\.pptx?$/iu.test(path) || path.includes('/03_presentation/'),
      DEFAULT_ARTIFACT_TARGETS.presentation,
    ),
    html: find(
      (path) => /\.html?$/iu.test(path) || path.includes('/04_infographic/'),
      DEFAULT_ARTIFACT_TARGETS.html,
    ),
    manifest: find(
      (path) => /manifest\.json$/iu.test(path) || path.includes('/05_evidence/'),
      DEFAULT_ARTIFACT_TARGETS.manifest,
    ),
  };
}

function buildArtifactWorkflowFallback(employees: EmployeeRow[], intent: string): LlmPlan {
  const targets = artifactTargetsFromIntent(intent);
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
  const modelValidators = employees.filter((employee) => {
    if (used.has(employee.employee_id)) return false;
    const haystack = `${employee.name} ${employee.role_slug}`.toLowerCase();
    return (
      haystack.includes('model') ||
      haystack.includes('provider') ||
      haystack.includes('stress') ||
      haystack.includes('planning') ||
      haystack.includes('analyst')
    );
  });
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
          `Select one suitable project from the workspace and record the selected project plus rationale for downstream artifact tasks. Full user intent: ${intent}`,
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
                `Analyze the selected project codebase and draft source findings only. Include product positioning, modules, flows, run commands, risks, and hygiene advice; do not create final deliverables in this task. Full user intent: ${intent}`,
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
          `Copy only the selected project source tree into ${targets.sourceCopy}, excluding .git, node_modules, dist, build, .turbo, target, DerivedData, .venv and similar generated directories. Do not generate analysis, presentation, HTML, or manifest artifacts in this task. Full user intent: ${intent}`,
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
              `Generate the codebase analysis PDF at ${targets.pdf} using the selected project findings. If the user forbids reportlab or new packages, use only already-available shell/runtime capabilities. Full user intent: ${intent}`,
              true,
            ),
          ]
        : []),
      ...(presentationOwner
        ? [
            taskFor(
              presentationOwner,
              `Generate the requested 8-12 page project PPTX artifact at ${targets.presentation}. If the user forbids python-pptx or new packages, use only already-available shell/runtime capabilities. Full user intent: ${intent}`,
              true,
            ),
          ]
        : []),
      ...(htmlOwner
        ? [
            taskFor(
              htmlOwner,
              `Generate the self-contained HTML infographic at ${targets.html}. Full user intent: ${intent}`,
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
                `Verify ${targets.sourceCopy}, ${targets.pdf}, ${targets.presentation}, and ${targets.html}; write the evidence manifest at ${targets.manifest}; and list any missing or empty files. Full user intent: ${intent}`,
                true,
              ),
            ]
          : []),
        ...(coordinator
          ? [
              taskFor(
                coordinator,
                `Write the final delivery summary with generated file paths, selected project, employee responsibilities, unresolved issues, and completion status. Do not mark the workflow complete if any task is blocked or any requested file is missing. Full user intent: ${intent}`,
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
