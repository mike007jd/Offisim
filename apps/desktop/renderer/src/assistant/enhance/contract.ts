/**
 * Prompt Enhance — frozen contract (PR-06).
 *
 * A versioned, context-aware enhancement platform. The shapes below are a SHARED
 * contract: PR-05 (Connect), PR-08 (Loops), and PR-10 (Loop refs) consume them
 * verbatim. Do NOT widen or rename these without bumping every downstream PR.
 *
 * Pure data + pure helpers only — no React, no Tauri, no `@/` alias — so the
 * deterministic harness (scripts/harness-prompt-enhance.mts) can import this file
 * and the span/validation layer directly, without a live model.
 */

/**
 * Which surface is asking. Each profile carries its own versioned system
 * instruction (see `profiles.ts`) so a casual chat is never enhanced like a work
 * instruction. The three are frozen with the contract; new surfaces reuse one of
 * these or add a new profile in a follow-up.
 */
export type PromptEnhanceProfile = 'office_instruction' | 'collaboration_message' | 'loop_design';

/**
 * A span of the original text that MUST survive enhancement byte-for-byte. The
 * validator checks that every `source` still appears intact in the enhanced
 * output; a single drop → the result is INVALID and the UI disables Apply.
 *
 * `loop_ref` is reserved for PR-10 (Office references a Loop): the extractor
 * already detects the stable chip token form so PR-10 slots in without a contract
 * change.
 */
export interface ProtectedSpan {
  id: string;
  kind: 'mention' | 'loop_ref' | 'variable' | 'code' | 'path' | 'attachment';
  /** The exact substring that must reappear, unmangled, in the enhanced text. */
  source: string;
}

/**
 * One enhancement ask. Built deterministically from the composer state; the model
 * never sees this object directly — the service turns it into a system prompt
 * (the profile) + a user message (the text + minimal context).
 */
export interface PromptEnhanceRequest {
  profile: PromptEnhanceProfile;
  text: string;
  /** BCP-47-ish locale tag, used so the model keeps the user's language. */
  locale: string;
  protectedSpans: ProtectedSpan[];
  /** Surface-supplied, non-secret hints (project name, scope, tone). Opaque. */
  context: Record<string, unknown>;
  /** Optional "make it more X" steer on a Regenerate. */
  feedback?: string;
}

/**
 * The enhancement outcome. `enhanced` is the proposed replacement; the UI shows
 * it next to `original` and only enables Apply when the span validation passed
 * (no entries in `warnings` of the INVALID class). `profileVersion` pins which
 * versioned instruction produced this — surfaced for audit/telemetry.
 */
export interface PromptEnhanceResult {
  original: string;
  enhanced: string;
  /** Short, human-readable reasons the wording changed. Never injected into text. */
  rationale: string[];
  /** Ids of the protected spans the validator confirmed are intact. */
  preservedSpanIds: string[];
  /** Non-fatal notes, plus the fatal span-loss marker that disables Apply. */
  warnings: string[];
  profileVersion: string;
  /** loop_design only: parsed loop fields / clarifying questions for PR-08. */
  structuredHints?: Record<string, unknown>;
}

/**
 * The fatal warning the validator emits when a protected span is missing from the
 * enhanced text. The UI keys Apply-disabled off `resultIsApplyable()` (below), but
 * this constant is the stable marker so downstream PRs and the harness can assert
 * the exact failure without string-matching prose.
 */
export const ENHANCE_SPAN_LOST_WARNING = 'enhance.span-lost' as const;

/**
 * Whether a result may be Applied. False when any protected span was lost — the
 * single source of truth the UI and the harness both consult, so "INVALID blocks
 * Apply" can never drift between them.
 */
export function resultIsApplyable(result: PromptEnhanceResult): boolean {
  return !result.warnings.includes(ENHANCE_SPAN_LOST_WARNING);
}
