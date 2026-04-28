import type { SopDefinition, SopStep } from '@offisim/shared-types';
import type { EmployeeRow, SopTemplateRow } from '../../runtime/repositories.js';
import type { RuntimeContext } from '../../runtime/runtime-context.js';
import { SopService } from '../../services/sop-service.js';
import type { LlmPlan, LlmPlanStep } from '../pm-planner-types.js';

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
): EmployeeRow | null {
  const enabled = employees.filter((e) => e.enabled === 1);
  const exactMatches = enabled.filter((e) => e.role_slug === roleSlug);
  const exact = exactMatches[0];
  if (exact) return exact;
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
    return null;
  }
  const sopService = new SopService(repos.sopTemplates, eventBus);

  const validation = sopService.validateDefinition(sopDef);
  if (!validation.valid) return null;

  const batches = sopService.getExecutionOrder(sopDef);
  if (batches.length === 0) return null;

  return {
    plan: sopBatchesToLlmPlan(sopDef, batches, allEmployees),
    sopTemplateId: matched.sop_template_id,
  };
}

/**
 * Resolve an explicit SOP template selection (directive.sopTemplateId).
 * Returns null on any validation / parse failure; caller falls back to substring matching.
 */
export async function tryBuildExplicitSopPlan(
  repos: RuntimeContext['repos'],
  eventBus: RuntimeContext['eventBus'],
  sopTemplateId: string,
  allEnabled: EmployeeRow[],
): Promise<{ plan: LlmPlan; sopTemplateId: string } | null> {
  const template = await repos.sopTemplates.findById(sopTemplateId);
  if (!template) return null;
  try {
    const sopDef: SopDefinition = JSON.parse(template.definition_json);
    const sopService = new SopService(repos.sopTemplates, eventBus);
    const validation = sopService.validateDefinition(sopDef);
    if (!validation.valid) return null;
    const batches = sopService.getExecutionOrder(sopDef);
    if (batches.length === 0) return null;
    return {
      plan: sopBatchesToLlmPlan(sopDef, batches, allEnabled),
      sopTemplateId,
    };
  } catch {
    return null;
  }
}
