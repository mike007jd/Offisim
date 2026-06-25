/**
 * EvaluatorRegistry (PRD §20, slice MS-003).
 *
 * A small, deterministic lookup of registered {@link MissionEvaluator}s keyed by
 * `id`. Per §20.3 a Marketplace Playbook may only REFERENCE a registered
 * evaluator by id plus declarative config — it can never carry an arbitrary
 * shell evaluator script. The registry is therefore the chokepoint that decides
 * which evaluator ids are legal; an unknown id is a hard error (a Playbook that
 * names an unregistered evaluator must fail loudly, not silently no-op).
 *
 * Additive at MS-003 — nothing consumes the registry yet (MS-004 loop controller).
 */

import { BUILTIN_EVALUATORS } from './builtin.js';
import type { MissionEvaluator } from './types.js';

/** Thrown by {@link EvaluatorRegistry.get} when an id is not registered. */
export class UnknownEvaluatorError extends Error {
  readonly evaluatorId: string;
  constructor(evaluatorId: string) {
    super(
      `Unknown evaluator '${evaluatorId}': a Playbook may only reference a registered evaluator (§20.3)`,
    );
    this.name = 'UnknownEvaluatorError';
    this.evaluatorId = evaluatorId;
  }
}

export interface EvaluatorRegistry {
  /** Register an evaluator. Throws if its id is already registered. */
  register(evaluator: MissionEvaluator): void;
  /** Look up by id. Throws {@link UnknownEvaluatorError} if not registered. */
  get(id: string): MissionEvaluator;
  /** Whether an id is registered. */
  has(id: string): boolean;
  /** All registered evaluators (stable insertion order). */
  list(): MissionEvaluator[];
}

class EvaluatorRegistryImpl implements EvaluatorRegistry {
  private readonly evaluators = new Map<string, MissionEvaluator>();

  register(evaluator: MissionEvaluator): void {
    if (this.evaluators.has(evaluator.id)) {
      throw new Error(`Evaluator '${evaluator.id}' is already registered`);
    }
    this.evaluators.set(evaluator.id, evaluator);
  }

  get(id: string): MissionEvaluator {
    const evaluator = this.evaluators.get(id);
    if (!evaluator) throw new UnknownEvaluatorError(id);
    return evaluator;
  }

  has(id: string): boolean {
    return this.evaluators.has(id);
  }

  list(): MissionEvaluator[] {
    return [...this.evaluators.values()];
  }
}

/** An empty registry. Callers seed it with {@link MissionEvaluator}s. */
export function createEvaluatorRegistry(): EvaluatorRegistry {
  return new EvaluatorRegistryImpl();
}

/**
 * A registry pre-seeded with the P0 builtin evaluators (PRD §20.2). This is the
 * default surface MS-004 / the harness should use.
 */
export function createDefaultEvaluatorRegistry(): EvaluatorRegistry {
  const registry = createEvaluatorRegistry();
  for (const evaluator of BUILTIN_EVALUATORS) registry.register(evaluator);
  return registry;
}
