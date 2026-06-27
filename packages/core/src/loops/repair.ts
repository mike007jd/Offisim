/**
 * Deterministic repair / needs_input / reject layer (PR-07). Given the source
 * prompt + the UNTRUSTED model draft, decide whether the compiler has enough to
 * build an IR, must ask the user ≤3 questions, or must reject. Pure + total —
 * never throws, never calls a model. The harness tests every branch.
 *
 * The model is advisory: missing fields are repaired with deterministic defaults
 * where safe, and only MATERIAL un-inferable values produce questions (each with a
 * recommended default, capped at three).
 */

import type {
  LoopBudgetContract,
  LoopCompileQuestion,
  LoopValidationFinding,
} from '@offisim/shared-types';
import type { LoopCompileInput, LoopModelOutput } from './types.js';
import { LOOP_LIMITS } from './types.js';

/** Tier → default budget caps (mirrors fleet PARALLELISM.md tier table). */
export function defaultBudgetForTier(tier: LoopBudgetContract['tier']): LoopBudgetContract {
  switch (tier) {
    case 'light':
      return {
        tier,
        maxConcurrentAgents: 2,
        maxTotalAgents: 5,
        maxRecursionDepth: 1,
        maxFixWavesPerGate: 3,
      };
    case 'aggressive':
      return {
        tier,
        maxConcurrentAgents: 8,
        maxTotalAgents: 20,
        maxRecursionDepth: 3,
        maxFixWavesPerGate: 3,
      };
    default:
      return {
        tier: 'standard',
        maxConcurrentAgents: 4,
        maxTotalAgents: 12,
        maxRecursionDepth: 2,
        maxFixWavesPerGate: 3,
      };
  }
}

const VALID_TIERS = new Set(['light', 'standard', 'aggressive']);

function byteLength(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

export type RepairOutcome =
  | { kind: 'ok'; budget: LoopBudgetContract; findings: LoopValidationFinding[] }
  | { kind: 'needs_input'; questions: LoopCompileQuestion[]; findings: LoopValidationFinding[] }
  | { kind: 'reject'; findings: LoopValidationFinding[] };

/**
 * Decide the compile path from (input, model draft).
 *
 * Reject (hard): empty/oversized source prompt, oversized enhanced prompt, or a
 * structurally-impossible draft (e.g. structuredHints is not an object when present).
 *
 * needs_input (≤3 questions): a MATERIAL value cannot be inferred — currently the
 * consumption tier (when the model gave an illegal one and the user has not
 * answered) and the acceptance demo (when neither the model nor an answer supplies
 * any acceptance signal). Every question carries a recommended default.
 *
 * ok: enough to build; the resolved budget is returned.
 */
export function repairOrReject(input: LoopCompileInput, model: LoopModelOutput): RepairOutcome {
  const findings: LoopValidationFinding[] = [];

  // --- Hard rejects: size + shape guards (JSON parse guards live at the repo edge). ---
  const source = (input.sourcePrompt ?? '').trim();
  if (source.length === 0) {
    return { kind: 'reject', findings: [reject('input.empty', 'source prompt is empty')] };
  }
  if (byteLength(input.sourcePrompt) > LOOP_LIMITS.maxSourcePromptBytes) {
    return {
      kind: 'reject',
      findings: [
        reject(
          'input.too_large',
          `source prompt exceeds ${LOOP_LIMITS.maxSourcePromptBytes} bytes`,
        ),
      ],
    };
  }
  if (
    input.enhancedPrompt &&
    byteLength(input.enhancedPrompt) > LOOP_LIMITS.maxEnhancedPromptBytes
  ) {
    return {
      kind: 'reject',
      findings: [
        reject(
          'input.enhanced_too_large',
          `enhanced prompt exceeds ${LOOP_LIMITS.maxEnhancedPromptBytes} bytes`,
        ),
      ],
    };
  }
  if (model.structuredHints !== undefined && !isPlainObject(model.structuredHints)) {
    // A malformed draft is REPAIRED to "no hints", not rejected — the compiler can
    // still build a default IR from the prompt. Record a warning for traceability.
    findings.push(
      warn('model.malformed_hints', 'model structuredHints was not an object — ignored'),
    );
  }
  const hints = isPlainObject(model.structuredHints) ? model.structuredHints : undefined;

  const answers = input.answers ?? {};
  const questions: LoopCompileQuestion[] = [];

  // --- Tier: ALWAYS inferable with a safe default (standard) — answer > model >
  //     default. The fleet method proposes a tier with a default and only asks if
  //     the user might want to override, so tier never forces a question here. ---
  const modelTier = typeof hints?.tier === 'string' ? hints.tier : '';
  const answeredTier = typeof answers.tier === 'string' ? answers.tier.trim() : '';
  let tier: LoopBudgetContract['tier'] = 'standard';
  if (VALID_TIERS.has(answeredTier)) {
    tier = answeredTier as LoopBudgetContract['tier'];
  } else if (VALID_TIERS.has(modelTier)) {
    tier = modelTier as LoopBudgetContract['tier'];
  }

  // --- Acceptance demo: the one MATERIAL, un-inferable value. We ask only when the
  //     request is too thin to even name an observable outcome — no model
  //     acceptance items, no answer, AND no usable outcome signal (the profile can
  //     otherwise default to the verification matrix). Capped, with a default. ---
  const hasAcceptance =
    Array.isArray(hints?.acceptance) && (hints.acceptance as unknown[]).length > 0;
  const answeredAcceptance =
    typeof answers.acceptance === 'string' ? answers.acceptance.trim() : '';
  const outcomeSignal = (typeof hints?.outcome === 'string' ? hints.outcome.trim() : '') || source;
  if (!hasAcceptance && answeredAcceptance.length === 0 && outcomeSignal.length < 8) {
    questions.push({
      id: 'acceptance',
      question: 'What is the observable "done" — the smallest demo that proves it works?',
      recommendedDefault:
        'The project verification matrix (tests, build, types) passes on the integrated change',
    });
  }

  // Cap questions at the limit (deterministic: keep the first N by declared order).
  if (questions.length > 0) {
    return {
      kind: 'needs_input',
      questions: questions.slice(0, LOOP_LIMITS.maxQuestions),
      findings,
    };
  }

  return { kind: 'ok', budget: defaultBudgetForTier(tier), findings };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function reject(code: string, message: string): LoopValidationFinding {
  return { code, message, severity: 'error' };
}

function warn(code: string, message: string): LoopValidationFinding {
  return { code, message, severity: 'warning' };
}
