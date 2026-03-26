import type { SopDefinition, SopStep } from '@aics/shared-types';
import type { EventBus } from '../events/event-bus.js';
import type { SopTemplateRepository, SopTemplateRow } from '../runtime/repositories.js';

export class SopService {
  constructor(
    private readonly sopTemplateRepo: SopTemplateRepository,
    _eventBus: EventBus,
  ) {}

  /**
   * Validate SOP definition — checks for empty steps, duplicate IDs,
   * missing dependencies, and cycles.
   */
  validateDefinition(def: SopDefinition): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!def.steps || def.steps.length === 0) {
      errors.push('SOP must have at least one step');
      return { valid: false, errors };
    }

    const stepIds = new Set<string>();
    for (const step of def.steps) {
      if (stepIds.has(step.step_id)) {
        errors.push(`Duplicate step_id: ${step.step_id}`);
      }
      stepIds.add(step.step_id);

      if (!step.label || !step.label.trim()) {
        errors.push(`Step ${step.step_id} has empty label`);
      }
      if (!step.role_slug || !step.role_slug.trim()) {
        errors.push(`Step ${step.step_id} has empty role_slug`);
      }
      if (!step.instruction || !step.instruction.trim()) {
        errors.push(`Step ${step.step_id} has empty instruction`);
      }
    }

    // Check dependencies reference valid steps
    for (const step of def.steps) {
      for (const dep of step.dependencies) {
        if (!stepIds.has(dep)) {
          errors.push(`Step ${step.step_id} depends on unknown step: ${dep}`);
        }
      }
    }

    // Check for cycles using DFS
    if (this.hasCycle(def.steps)) {
      errors.push('SOP contains a dependency cycle');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Get execution order — returns batches of steps that can run in parallel.
   * Each batch contains steps whose dependencies are all in previous batches.
   */
  getExecutionOrder(def: SopDefinition): SopStep[][] {
    const steps = [...def.steps];
    const completed = new Set<string>();
    const batches: SopStep[][] = [];

    while (completed.size < steps.length) {
      const batch: SopStep[] = [];
      for (const step of steps) {
        if (completed.has(step.step_id)) continue;
        const depsReady = step.dependencies.every((d) => completed.has(d));
        if (depsReady) {
          batch.push(step);
        }
      }
      if (batch.length === 0) {
        // Remaining steps have unresolvable deps (shouldn't happen after validation)
        break;
      }
      for (const step of batch) {
        completed.add(step.step_id);
      }
      batches.push(batch);
    }

    return batches;
  }

  /** Save a successful task path as SOP template */
  async saveAsTemplate(
    companyId: string,
    name: string,
    description: string,
    definition: SopDefinition,
    sourceThreadId?: string,
  ): Promise<string> {
    const sopTemplateId = `sop_${crypto.randomUUID()}`;
    await this.sopTemplateRepo.create({
      sop_template_id: sopTemplateId,
      company_id: companyId,
      name,
      description,
      definition_json: JSON.stringify(definition),
      source_thread_id: sourceThreadId ?? null,
    });
    return sopTemplateId;
  }

  async listTemplates(companyId: string): Promise<SopTemplateRow[]> {
    return this.sopTemplateRepo.findByCompany(companyId);
  }

  async getTemplate(sopTemplateId: string): Promise<SopTemplateRow | null> {
    return this.sopTemplateRepo.findById(sopTemplateId);
  }

  async deleteTemplate(sopTemplateId: string): Promise<void> {
    await this.sopTemplateRepo.delete(sopTemplateId);
  }

  private hasCycle(steps: readonly SopStep[]): boolean {
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color = new Map<string, number>();
    for (const s of steps) color.set(s.step_id, WHITE);

    const dfs = (id: string): boolean => {
      color.set(id, GRAY);
      const step = steps.find((s) => s.step_id === id);
      if (step) {
        for (const dep of step.dependencies) {
          const c = color.get(dep);
          if (c === GRAY) return true; // back edge → cycle
          if (c === WHITE && dfs(dep)) return true;
        }
      }
      color.set(id, BLACK);
      return false;
    };

    for (const s of steps) {
      if (color.get(s.step_id) === WHITE && dfs(s.step_id)) return true;
    }
    return false;
  }
}
