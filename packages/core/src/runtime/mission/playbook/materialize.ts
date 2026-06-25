/**
 * Playbook materialization mapping (PRD §25.3, slice PB-004).
 *
 * The Marketplace stores the NEUTRAL {@link MissionPlaybook}; each runtime Driver
 * materializes it LOCALLY into a runtime-native resource declaration. This module
 * is the deterministic, pure mapping for that step: given a VALIDATED playbook and
 * a runtime id, it produces the resources the runtime needs —
 *   - the playbook criteria → the `createMission` criteria shape
 *     ({@link MissionCriterionInput}), so the loop controller can grade them;
 *   - the `materialization.pi.skillMappings` → the local skill resources to bind.
 *
 * It returns a PLAN, never a side effect: it does NOT install skills, write the
 * DB, or touch the filesystem. The live materializer / install-core that actually
 * binds skills is the M-pass (PB-005). Pure and deterministic — no Date, no
 * random; the same playbook always yields the same plan.
 *
 * Precondition is ENFORCED BY THE TYPE SYSTEM, not a comment: the input is a
 * {@link ValidatedPlaybook}, the unforgeable brand `validatePlaybook` stamps only
 * on its success path (after the §25.2 forbidden-content scan). A raw/unvalidated
 * object therefore cannot reach materialization without a compile error — the
 * unsafe content can never flow into the materialized plan. This mapping trusts
 * the (already validated) shape and does NOT re-run the safety gate.
 *
 * `criterion.required` default: `true` for deterministic evaluators (a criterion
 * with no explicit `required` is treated as a gate, mirroring the loop
 * controller), but `false` specifically for `llm_rubric_review` — the
 * non-deterministic reviewer is advisory by default (§20.2) and must never
 * silently become a hard gate, which agrees with what the validator allows.
 */

import type { PlaybookSkillMapping } from '@offisim/shared-types';
import type { ValidatedPlaybook } from './validate.js';

/** The supported runtime ids a playbook can be materialized for. Pi-only here. */
export type PlaybookRuntimeId = 'pi';

/**
 * A criterion in the `createMission` shape ({@link MissionCriterionInput} mirror).
 * Re-declared locally so this module does not depend on mission-service; the
 * field names match exactly so the plan can be handed straight to `createMission`.
 */
export interface MaterializedCriterion {
  readonly description: string;
  readonly evaluatorId: string;
  /** Declarative evaluator config, serialized — defaults to `'{}'`. */
  readonly evaluatorConfigJson: string;
  readonly required: boolean;
  readonly orderIndex: number;
}

/** A local skill resource the Driver must bind (from a §25.3 skill mapping). */
export interface MaterializedSkillBinding {
  readonly skill: string;
  readonly target: string;
}

/**
 * The runtime-native resource declaration produced from a playbook (PB-004). A
 * plan, not an effect: the caller (the live materializer, M-pass) is what binds
 * the skills and creates the mission.
 */
export interface MaterializedPlaybook {
  readonly runtimeId: PlaybookRuntimeId;
  readonly playbookId: string;
  readonly playbookVersion: string;
  readonly title: string;
  readonly goalTemplate: string;
  readonly requiredRoles: readonly string[];
  readonly requiredSkills: readonly string[];
  /** The criteria in `createMission` shape (one per playbook criterion). */
  readonly criteria: readonly MaterializedCriterion[];
  /** Expected artifact kinds, serialized for `expectedArtifactsJson`. */
  readonly expectedArtifactKinds: readonly string[];
  /** The default policy, serialized for `runtimePolicyJson`. */
  readonly runtimePolicyJson: string;
  /** The default budget, serialized for `budgetJson`. */
  readonly budgetJson: string;
  /** The local skill resources to bind (empty for a non-Pi runtime block). */
  readonly skillBindings: readonly MaterializedSkillBinding[];
}

/** Thrown when materializing for a runtime the playbook does not target. */
export class UnsupportedRuntimeError extends Error {
  readonly runtimeId: string;
  constructor(runtimeId: string) {
    super(`Playbook materialization for runtime '${runtimeId}' is not supported`);
    this.name = 'UnsupportedRuntimeError';
    this.runtimeId = runtimeId;
  }
}

/**
 * Materialize a VALIDATED playbook into a runtime-native resource declaration
 * (PB-004). Deterministic and pure. For `runtimeId === 'pi'` the
 * `materialization.pi.skillMappings` become the skill bindings; any other runtime
 * id throws {@link UnsupportedRuntimeError} (an unsupported capability is blocked,
 * never silently faked — PRD §15.1).
 */
export function materializePlaybook(
  playbook: ValidatedPlaybook,
  runtimeId: PlaybookRuntimeId,
): MaterializedPlaybook {
  if (runtimeId !== 'pi') {
    throw new UnsupportedRuntimeError(runtimeId);
  }

  const criteria: MaterializedCriterion[] = playbook.criteria.map((criterion, index) => ({
    description: criterion.description,
    evaluatorId: criterion.evaluator,
    // Declarative config is serialized verbatim; an empty object → '{}'.
    evaluatorConfigJson: JSON.stringify(criterion.config ?? {}),
    // An absent `required` defaults to a gate (matches the loop controller) for
    // deterministic evaluators — but to `false` for the non-deterministic
    // llm_rubric_review reviewer, which is advisory by default (§20.2) and must
    // never silently become a hard gate (this agrees with what the validator
    // allows: an advisory/absent-required llm_rubric_review passes validation).
    required: criterion.required ?? criterion.evaluator !== 'llm_rubric_review',
    orderIndex: index,
  }));

  const skillMappings: readonly PlaybookSkillMapping[] =
    playbook.materialization?.pi?.skillMappings ?? [];
  const skillBindings: MaterializedSkillBinding[] = skillMappings.map((mapping) => ({
    skill: mapping.skill,
    target: mapping.target,
  }));

  return {
    runtimeId,
    playbookId: playbook.id,
    playbookVersion: playbook.version,
    title: playbook.title,
    goalTemplate: playbook.goalTemplate,
    requiredRoles: [...playbook.requiredRoles],
    requiredSkills: [...playbook.requiredSkills],
    criteria,
    expectedArtifactKinds: playbook.artifacts.map((artifact) => artifact.kind),
    runtimePolicyJson: JSON.stringify(playbook.defaultPolicy),
    budgetJson: JSON.stringify(playbook.defaultBudget),
    skillBindings,
  };
}
