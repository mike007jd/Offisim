/**
 * Prompt Enhance service (PR-06).
 *
 * Builds the request → runs it through a model transport → validates protected
 * spans → assembles the `PromptEnhanceResult`. The model call is injected as a
 * `EnhanceTransport`, so:
 *   - the live UI passes the Tauri-backed transport (`tauri-enhance-transport.ts`,
 *     which calls the no-tools, no-persistence Pi enhance path), and
 *   - the harness passes a deterministic transport that returns canned text, so
 *     the validation/contract layer is fully testable WITHOUT a live model.
 *
 * The two interfaces at the bottom (`runEnhance` + `EnhanceTransport`) are what
 * PR-05 / PR-08 / PR-10 consume. Pure except for the injected transport — no React.
 */

import type {
  PromptEnhanceProfile,
  PromptEnhanceRequest,
  PromptEnhanceResult,
} from './contract.js';
import { type EnhanceProfileDefinition, getEnhanceProfile } from './profiles.js';
import {
  type SpanValidation,
  spanLossWarnings,
  validateProtectedSpans,
} from './protected-spans.js';

/**
 * What the transport returns: the raw enhanced text the model produced, plus an
 * optional structured-hints object (loop_design). The transport does NOT validate
 * spans or build the result — that stays here so every transport shares the same
 * deterministic contract layer.
 */
export interface EnhanceTransportResult {
  text: string;
  structuredHints?: Record<string, unknown>;
}

/** The model-call seam. `signal` lets the UI cancel an in-flight enhance. */
export interface EnhanceTransport {
  run(input: {
    profile: EnhanceProfileDefinition;
    request: PromptEnhanceRequest;
    signal?: AbortSignal;
  }): Promise<EnhanceTransportResult>;
}

/** Thrown when the user cancelled the enhance (so the UI can ignore it quietly). */
export class EnhanceCancelledError extends Error {
  constructor() {
    super('Prompt enhance cancelled');
    this.name = 'EnhanceCancelledError';
  }
}

/**
 * loop_design: pull out clarifying questions (lines that read as a question) and
 * cap them at 3 — the contract's "at most 3 high-impact questions" rule, enforced
 * deterministically here rather than trusting the model to count. Returns the
 * questions plus a flag the structured hints carry so PR-08 can branch on it.
 */
function extractLoopQuestions(text: string): string[] {
  const questions: string[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim();
    if (line.endsWith('?')) questions.push(line);
  }
  // Hard cap at 3 regardless of how many the model emitted.
  return questions.slice(0, 3);
}

/**
 * Assemble a `PromptEnhanceResult` from a request + the transport's raw output.
 * PURE and deterministic — this is the function the harness exercises with canned
 * text to prove span-loss blocks Apply, questions cap at 3, etc. It never calls a
 * model and never touches Tauri.
 */
export function assembleEnhanceResult(
  request: PromptEnhanceRequest,
  profile: EnhanceProfileDefinition,
  transportResult: EnhanceTransportResult,
): PromptEnhanceResult {
  const enhanced = transportResult.text;
  const validation: SpanValidation = validateProtectedSpans(enhanced, request.protectedSpans);
  const warnings = spanLossWarnings(validation);

  const rationale = buildRationale(request, validation);

  let structuredHints = transportResult.structuredHints;
  if (profile.wantsStructuredHints) {
    const questions = extractLoopQuestions(enhanced);
    structuredHints = {
      ...(structuredHints ?? {}),
      ...(questions.length > 0 ? { questions } : {}),
    };
  }

  return {
    original: request.text,
    enhanced,
    rationale,
    preservedSpanIds: validation.preservedSpanIds,
    warnings,
    profileVersion: profile.version,
    ...(structuredHints && Object.keys(structuredHints).length > 0 ? { structuredHints } : {}),
  };
}

/** Short, surface-agnostic rationale lines. Never injected into the message text;
 *  shown in the review dialog only. */
function buildRationale(request: PromptEnhanceRequest, validation: SpanValidation): string[] {
  const lines: string[] = [];
  if (request.protectedSpans.length > 0) {
    lines.push(
      validation.valid
        ? `Preserved ${request.protectedSpans.length} protected element${request.protectedSpans.length === 1 ? '' : 's'} (mentions, code, paths, refs).`
        : `Protected element${validation.lostSpanIds.length === 1 ? '' : 's'} were lost — apply is blocked.`,
    );
  }
  if (request.feedback?.trim()) {
    lines.push(`Applied your steer: "${request.feedback.trim()}".`);
  }
  return lines;
}

/**
 * Build a `PromptEnhanceRequest` from raw inputs. Centralized so every surface
 * builds the request the same way (locale defaulting, span extraction is done by
 * the caller and passed in). Kept tiny on purpose — the surfaces own context.
 */
export function buildEnhanceRequest(input: {
  profile: PromptEnhanceProfile;
  text: string;
  locale?: string;
  protectedSpans: PromptEnhanceRequest['protectedSpans'];
  context?: Record<string, unknown>;
  feedback?: string;
}): PromptEnhanceRequest {
  return {
    profile: input.profile,
    text: input.text,
    locale: input.locale?.trim() || 'en',
    protectedSpans: input.protectedSpans,
    context: input.context ?? {},
    ...(input.feedback?.trim() ? { feedback: input.feedback.trim() } : {}),
  };
}

/**
 * Run an enhance end-to-end: resolve the versioned profile, call the transport,
 * assemble the validated result. The single entry point PR-05 / PR-08 / PR-10 use.
 * Throws `EnhanceCancelledError` if the signal aborts; other transport errors
 * propagate so the UI can show an error/rate-limit state.
 */
export async function runEnhance(
  request: PromptEnhanceRequest,
  transport: EnhanceTransport,
  signal?: AbortSignal,
): Promise<PromptEnhanceResult> {
  if (signal?.aborted) throw new EnhanceCancelledError();
  const profile = getEnhanceProfile(request.profile);
  const transportResult = await transport.run({ profile, request, signal });
  if (signal?.aborted) throw new EnhanceCancelledError();
  return assembleEnhanceResult(request, profile, transportResult);
}
