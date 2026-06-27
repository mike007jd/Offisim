/**
 * Versioned enhance profiles (PR-06).
 *
 * Each profile is an independently-testable constant: a system instruction with
 * baked-in guardrails + a `version` string. The prompts live in code (not a model
 * config) so the harness can assert their guardrail guidance literally — e.g. the
 * collaboration prompt must forbid task-list expansion, the office prompt must
 * forbid authorizing destructive permissions. There is deliberately NO single
 * "make this better" prompt: a casual chat and a work order are enhanced under
 * different rules.
 *
 * Pure module — no React / Tauri — so it is importable by the harness.
 */

import type { PromptEnhanceProfile } from './contract.js';

export interface EnhanceProfileDefinition {
  readonly profile: PromptEnhanceProfile;
  /** Bump when the system instruction changes; surfaced on every result. */
  readonly version: string;
  /** Whether this profile expects the model to return `structuredHints`. */
  readonly wantsStructuredHints: boolean;
  /** The versioned system instruction handed to Pi as the only system prompt. */
  readonly systemPrompt: string;
}

/**
 * Shared preamble: the hard rules every profile inherits. Protected-span fidelity
 * is enforced deterministically by the validator regardless, but stating it to the
 * model reduces the chance of a needless INVALID. The "never expand without bound"
 * and "never inject rationale into the text" rules guard the contract's "never
 * infinitely expand / never pollute user text" requirements.
 */
const SHARED_PREAMBLE = [
  'You rewrite a user-authored message to make it clearer and more effective.',
  'You return ONLY the rewritten message text — never a preface, never your reasoning, never a system note inside it.',
  'Preserve every @mention, {{variable}}, fenced code block, file path, attachment id, and reference token EXACTLY as written; do not rephrase, translate, or reformat them.',
  "Keep the user's original language and locale.",
  'Do not pad length to seem more thorough. A short, clear message stays short.',
].join('\n');

const OFFICE_INSTRUCTION_PROMPT = [
  SHARED_PREAMBLE,
  '',
  'PROFILE: office_instruction.',
  'Turn a work instruction into something executable with clear acceptance criteria.',
  '- Make the goal, deliverable, constraints, and "done" condition explicit.',
  '- Fill in safely-inferable missing context, but do NOT expand the scope of the request.',
  '- Preserve the @employees addressed, the files and attachments referenced, and the permission intent.',
  '- Never authorize destructive actions, never grant or assume unauthorized destructive permissions, and never invent tools or capabilities that were not requested.',
  '- Keep simple requests simple — do not inflate a one-line ask into a project plan.',
].join('\n');

const COLLABORATION_MESSAGE_PROMPT = [
  SHARED_PREAMBLE,
  '',
  'PROFILE: collaboration_message.',
  'Improve a person-to-person message for clarity, a natural tone, and less ambiguity.',
  '- Honor the requested tone when one is given (neutral, friendly, or direct).',
  '- Do NOT turn casual chat into a task list, a checklist, or a formal work order.',
  '- Do NOT add Office or Loop jargon, status fields, or process structure the user did not use.',
  '- Stay conversational — this is a message to a colleague, not a ticket.',
].join('\n');

const LOOP_DESIGN_PROMPT = [
  SHARED_PREAMBLE,
  '',
  'PROFILE: loop_design.',
  'Help the user shape a repeatable loop from a rough description.',
  '- Infer the outcome, inputs, outputs, loop edges, exit states, budget, human gates, oracles, and skill bindings where they are reasonably implied.',
  '- Return enhanced NATURAL-LANGUAGE prose for the message body.',
  '- Put any structured inference into a separate hints object — never emit raw evaluator JSON or schema into the message the user reads.',
  '- If you genuinely cannot infer the design, ask AT MOST 3 high-impact questions, each with a recommended default — never more than 3.',
].join('\n');

const DEFINITIONS: Record<PromptEnhanceProfile, EnhanceProfileDefinition> = {
  office_instruction: {
    profile: 'office_instruction',
    version: 'office_instruction@1',
    wantsStructuredHints: false,
    systemPrompt: OFFICE_INSTRUCTION_PROMPT,
  },
  collaboration_message: {
    profile: 'collaboration_message',
    version: 'collaboration_message@1',
    wantsStructuredHints: false,
    systemPrompt: COLLABORATION_MESSAGE_PROMPT,
  },
  loop_design: {
    profile: 'loop_design',
    version: 'loop_design@1',
    wantsStructuredHints: true,
    systemPrompt: LOOP_DESIGN_PROMPT,
  },
};

/** Resolve a profile's versioned definition. Throws on an unknown profile so a
 *  typo surfaces at the call site rather than silently enhancing with no rules. */
export function getEnhanceProfile(profile: PromptEnhanceProfile): EnhanceProfileDefinition {
  const def = DEFINITIONS[profile];
  if (!def) throw new Error(`Unknown enhance profile: ${profile}`);
  return def;
}

/** All profile definitions (harness iterates these to assert each version + guardrail). */
export function allEnhanceProfiles(): EnhanceProfileDefinition[] {
  return Object.values(DEFINITIONS);
}
