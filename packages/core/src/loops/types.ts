/**
 * Loop compiler contracts (PR-07). The deterministic layer — IR validation,
 * repair, question capping, and the Mission execution packet — is what the
 * harness tests; the model call is INJECTED so the same compiler runs against a
 * scripted/fake model in tests and the real PR-06 loop_design enhance in the app.
 *
 * Vendor-free: no React, no Tauri, no Pi import. The renderer adapts
 * `runEnhance(loop_design)` into a {@link LoopCompileModel}.
 */

import type {
  LoopBudgetContract,
  LoopCompileQuestion,
  LoopCompileStatus,
  LoopIR,
  LoopValidation,
} from '@offisim/shared-types';

/** The compiler engine version — distinct from a profile's bundled asset version. */
export const LOOP_COMPILER_VERSION = '1' as const;

/** Hard size guards so a runaway model output cannot bloat a revision row. */
export const LOOP_LIMITS = {
  /** Max bytes of the source prompt the compiler will accept. */
  maxSourcePromptBytes: 64 * 1024,
  /** Max bytes of the enhanced prompt. */
  maxEnhancedPromptBytes: 128 * 1024,
  /** Max bytes of the serialized compiled IR. */
  maxCompiledIrBytes: 512 * 1024,
  /** Max questions returned in a needs_input revision. */
  maxQuestions: 3,
  /** Max bytes of the serialized questions_json column. */
  maxQuestionsBytes: 16 * 1024,
  /** Max bytes of the serialized validation_json column. */
  maxValidationBytes: 64 * 1024,
  /** Max nodes in a single IR (inline child graphs counted in the validator). */
  maxNodes: 200,
  /** Max edges in a single IR. */
  maxEdges: 400,
  /** Max nesting depth of inline child graphs. */
  maxSubloopDepth: 5,
} as const;

/** Non-secret context the surface passes (project, repo facts, company). Opaque. */
export interface LoopCompileContext {
  companyId: string;
  projectId?: string;
  /** Repository facts the compiler may reference; never fabricated by the profile. */
  repository?: {
    root?: string;
    defaultBranch?: string;
    /** True when the compiler could actually inspect the repo (else evidence pending). */
    inspected?: boolean;
  };
  /** Free-form, profile-specific extra context. */
  extra?: Record<string, unknown>;
}

/** One compile request. `answers` carry prior question responses on a recompile. */
export interface LoopCompileInput {
  sourcePrompt: string;
  /** Optional pre-enhanced NL (from a prior loop_design enhance). */
  enhancedPrompt?: string;
  context: LoopCompileContext;
  /** Map of questionId → answer, supplied when recompiling after needs_input. */
  answers?: Record<string, string>;
}

/**
 * What the INJECTED model returns. The real adapter derives this from PR-06's
 * `runEnhance(loop_design)` result (enhanced text + structuredHints); the harness
 * scripts it directly. The compiler treats every field as UNTRUSTED — malformed
 * output is deterministically repaired or rejected, never crashes.
 */
export interface LoopModelOutput {
  /** The enhanced natural language, if the model produced one. */
  enhancedPrompt?: string;
  /**
   * The model's structured draft of the loop. Intentionally `unknown`-shaped: the
   * compiler/profile parse and repair it; an arbitrary object never reaches the IR
   * without passing validation.
   */
  structuredHints?: Record<string, unknown>;
}

/** The injected async model fn. Pure dependency — the compiler never imports it. */
export type LoopCompileModel = (input: LoopCompileInput) => Promise<LoopModelOutput>;

/**
 * The outcome of a compile. Exactly one of three shapes:
 * - `ready`: a validated IR is attached;
 * - `needs_input`: ≤3 questions (each with a default) the user must answer;
 * - `invalid`: the IR could not be made legal; findings explain why.
 */
export interface LoopCompileResult {
  status: LoopCompileStatus;
  /** Present iff status === 'ready'. The validated, legal IR. */
  ir?: LoopIR;
  /** Present iff status === 'needs_input'. At most LOOP_LIMITS.maxQuestions. */
  questions: LoopCompileQuestion[];
  validation: LoopValidation;
  /** The enhanced prompt the model produced (echoed for revision persistence). */
  enhancedPrompt?: string;
}

/** A profile-level validation note (profile-specific, beyond the generic graph rules). */
export interface ValidationFinding {
  code: string;
  message: string;
  severity: 'error' | 'warning';
  ref?: string;
}

/** A bundled, versioned, checksummed instruction asset. */
export interface CompilerAsset {
  /** File name (e.g. 'SKILL.md'). */
  name: string;
  /** sha256 of the asset's bytes — recorded so the bundle is traceable. */
  sha256: string;
  /** The asset's text content (bundled into the build). */
  content: string;
}

/**
 * A compiler profile: it owns the system instruction + reference assets the model
 * is steered by, the default budget, and the deterministic `compile` that turns a
 * (possibly model-assisted) draft into a validated IR. `enhanceProfile` pins which
 * PR-06 enhance profile the real model adapter uses.
 */
export interface LoopCompilerProfile {
  id: string;
  version: string;
  displayName: string;
  description: string;
  systemInstruction: string;
  referenceAssets: CompilerAsset[];
  defaultBudget: LoopBudgetContract;
  enhanceProfile: 'loop_design';
  /**
   * Compile a request into a result. `model` is injected: the real one calls the
   * loop_design enhance; the harness scripts a fake. Never throws on bad model
   * output — returns `invalid` with findings instead.
   */
  compile(input: LoopCompileInput, model: LoopCompileModel): Promise<LoopCompileResult>;
  /** Optional profile-specific validation over a built IR (beyond generic rules). */
  validateProfileData?(ir: LoopIR): ValidationFinding[];
}
