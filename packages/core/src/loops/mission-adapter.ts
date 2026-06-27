/**
 * Mission compatibility adapter (PR-07). Turns a saved Loop revision + its IR +
 * resolved skills into a {@link LoopExecutionPacket} the existing Mission engine
 * can run — WITHOUT executing anything. PR-10 consumes the packet at Office Send;
 * PR-07 only DEFINES and tests it.
 *
 * Deterministic: the SAME revision always produces the SAME packet (stable id
 * derivation, stable criterion ordering). The Mission service stays the execution
 * truth; this never invents a controller/scheduler.
 *
 * Mapping rule: completion acceptance items map to Mission criteria. A
 * `deterministic` item with a named evaluator becomes a real criterion; a
 * `review` or `human` item (or a deterministic item with no evaluator) becomes a
 * `manual_approval` criterion (a human gate) — the adapter NEVER asks the user to
 * hand-write raw evaluator JSON.
 */

import type {
  LoopAcceptanceItem,
  LoopIR,
  LoopRevision,
  LoopSkillBinding,
} from '@offisim/shared-types';

/** A compiled Mission criterion the packet carries (mirrors mission_criterion). */
export interface CompiledMissionCriterion {
  description: string;
  evaluatorId: string;
  /** Serialized evaluator config (deterministically derived — never user-authored). */
  evaluatorConfigJson: string;
  required: boolean;
  orderIndex: number;
}

/** Resolved skill the packet hands to the Mission runtime (shape PR-10 binds). */
export interface PacketSkillBinding {
  skillId: string;
  skillVersion: string;
  orderIndex: number;
  config: Record<string, unknown>;
}

export interface LoopExecutionPacket {
  loopId: string;
  revisionId: string;
  title: string;
  sourcePrompt: string;
  ir: LoopIR;
  resolvedSkills: PacketSkillBinding[];
  missionDraft: {
    goal: string;
    runtimePolicyJson: string;
    budgetJson: string;
    criteria: CompiledMissionCriterion[];
  };
}

/** The evaluator id used for a human-gated / non-determinable acceptance item. */
const HUMAN_GATE_EVALUATOR = 'manual_approval';

function mapAcceptanceToCriterion(
  item: LoopAcceptanceItem,
  orderIndex: number,
): CompiledMissionCriterion {
  const deterministic = item.oracle === 'deterministic' && !!item.evaluatorId;
  if (deterministic) {
    return {
      description: item.description,
      evaluatorId: item.evaluatorId as string,
      // Config is derived, not user-authored: the acceptance id is the stable
      // anchor a deterministic evaluator keys off. PR-10 may enrich it, but the
      // packet never demands hand-written evaluator JSON.
      evaluatorConfigJson: JSON.stringify({ acceptanceId: item.id }),
      required: item.required,
      orderIndex,
    };
  }
  // review | human | deterministic-without-evaluator → a human gate. This is the
  // "non-determinable → human_gate, never raw JSON" contract.
  return {
    description: item.description,
    evaluatorId: HUMAN_GATE_EVALUATOR,
    evaluatorConfigJson: JSON.stringify({ acceptanceId: item.id, reason: item.oracle }),
    required: item.required,
    orderIndex,
  };
}

/**
 * Build the execution packet from a revision + its IR + resolved skill bindings.
 * Deterministic and side-effect-free — does NOT touch the Mission service, repos,
 * or any persistence. PR-10 calls this then hands `missionDraft` to the existing
 * `createMission`.
 */
export function buildLoopExecutionPacket(
  revision: LoopRevision,
  ir: LoopIR,
  skills: LoopSkillBinding[],
): LoopExecutionPacket {
  // Criteria in stable acceptance order. The mission engine requires at least one
  // REQUIRED criterion; the IR validator already guarantees one, so the mapping
  // preserves it.
  const criteria = ir.completion.acceptance.map((item, idx) => mapAcceptanceToCriterion(item, idx));

  const resolvedSkills: PacketSkillBinding[] = skills
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((b) => {
      let config: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(b.configJson) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          config = parsed as Record<string, unknown>;
        }
      } catch {
        // Malformed binding config is non-fatal — the packet uses an empty config
        // rather than crashing the send path. (The revision was validated at save.)
        config = {};
      }
      return {
        skillId: b.skillId,
        skillVersion: b.skillVersion,
        orderIndex: b.orderIndex,
        config,
      };
    });

  // The goal is the IR outcome plus the completion outcome — the human-readable
  // statement the Mission engine carries; the IR remains the structured truth.
  const goal = ir.completion.outcome || ir.outcome;

  const runtimePolicyJson = JSON.stringify({
    profileId: ir.metadata.profileId,
    profileVersion: ir.metadata.profileVersion,
    compilerVersion: ir.metadata.compilerVersion,
    loopId: revision.loopId,
    revisionId: revision.revisionId,
  });

  const budgetJson = JSON.stringify(ir.budget ?? {});

  return {
    loopId: revision.loopId,
    revisionId: revision.revisionId,
    title: ir.title,
    sourcePrompt: revision.sourcePrompt,
    ir,
    resolvedSkills,
    missionDraft: {
      goal,
      runtimePolicyJson,
      budgetJson,
      criteria,
    },
  };
}
