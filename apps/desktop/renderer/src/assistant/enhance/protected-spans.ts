/**
 * Deterministic protected-span extraction + validation (PR-06).
 *
 * "Protected" spans are substrings of the user's message that MUST survive
 * enhancement byte-for-byte — @mentions, {{variables}}, fenced code, file paths,
 * attachment ids, and Loop reference tokens. The extractor is pure and the
 * validator is a plain substring-presence check: if any span's `source` is missing
 * from the enhanced text the result is INVALID and Apply is blocked. No model is
 * involved in either step — that is the whole point (the model can rephrase, but
 * it cannot silently mangle a mention or a code block past this gate).
 *
 * Pure module (no React / Tauri) so the harness imports it directly.
 */

import { parseMentionSegments } from '../composer/composer-triggers.js';
import type { MentionEmployee } from '../composer/composer-triggers.js';
import { ENHANCE_SPAN_LOST_WARNING, type ProtectedSpan } from './contract.js';

/**
 * The stable chip-token form for a Loop reference. PR-10 ("Office references a
 * Loop") will mint these when a user inserts a Loop into a message; PR-06 detects
 * them now so the protected-span pipeline already guards them and PR-10 is purely
 * additive. Shape: `[[loop:<id>]]` where id is url-safe. Frozen with the contract.
 */
const LOOP_REF_RE = /\[\[loop:[A-Za-z0-9._-]+\]\]/g;
/** `{{variable}}` template tokens (single set of braces, no nesting needed). */
const VARIABLE_RE = /\{\{[^{}\n]+\}\}/g;
/** Fenced code blocks (``` … ```), the whole block including fences. */
const CODE_FENCE_RE = /```[\s\S]*?```/g;
/** Inline `code` spans — a smaller protected unit than a full fence. */
const INLINE_CODE_RE = /`[^`\n]+`/g;
/**
 * The stable attachment-reference token. Staged attachments are surfaced to the
 * model as `@@att:<id>` so they are detectable and protectable; a bare filename is
 * NOT treated as an attachment id (too ambiguous). Frozen with the contract.
 */
const ATTACHMENT_RE = /@@att:[A-Za-z0-9._-]+/g;
/**
 * Inline file paths: a POSIX-ish or Windows-ish path with at least one separator
 * and a recognizable segment. Conservative on purpose — we only protect things
 * that clearly read as a path (contain a `/` or `\`), never a lone word.
 */
const PATH_RE = /(?:[A-Za-z]:\\|\.{0,2}\/)?(?:[\w.@~-]+[/\\])+[\w.@~-]+(?:\.[A-Za-z0-9]+)?/g;

interface SpanHit {
  kind: ProtectedSpan['kind'];
  source: string;
  start: number;
  end: number;
}

function pushMatches(text: string, re: RegExp, kind: ProtectedSpan['kind'], hits: SpanHit[]): void {
  // Each detector gets a fresh lastIndex (the literals above are /g; clone-safe
  // because we never share a RegExp instance across calls concurrently).
  re.lastIndex = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (!m[0]) {
      re.lastIndex += 1;
      continue;
    }
    hits.push({ kind, source: m[0], start: m.index, end: m.index + m[0].length });
  }
}

/** Detect `@mention` spans by reusing the composer's own mention tokenizer. */
function mentionHits(text: string, roster: readonly MentionEmployee[]): SpanHit[] {
  if (!roster.length) return [];
  const hits: SpanHit[] = [];
  let cursor = 0;
  for (const segment of parseMentionSegments(text, roster)) {
    if (segment.kind === 'mention') {
      const source = `@${segment.label}`;
      const start = text.indexOf(source, cursor);
      if (start >= 0) {
        hits.push({ kind: 'mention', source, start, end: start + source.length });
        cursor = start + source.length;
      }
    } else {
      cursor += segment.text.length;
    }
  }
  return hits;
}

/**
 * Extract every protected span from `text`. Detectors run in priority order
 * (most-specific first) and a later, lower-priority hit is dropped if it overlaps
 * a span already claimed — so a path inside a fenced code block is covered once,
 * by the code span, not double-counted. Ids are stable and deterministic
 * (`<kind>-<index>`), so two runs over the same text yield identical span ids.
 */
export function extractProtectedSpans(
  text: string,
  roster: readonly MentionEmployee[] = [],
): ProtectedSpan[] {
  const raw: SpanHit[] = [];
  // Priority: code fences, then loop refs / attachments / variables (token forms),
  // then inline code, then mentions, then loose paths. Higher-priority kinds claim
  // their range first; overlapping lower-priority hits are discarded.
  pushMatches(text, CODE_FENCE_RE, 'code', raw);
  pushMatches(text, LOOP_REF_RE, 'loop_ref', raw);
  pushMatches(text, ATTACHMENT_RE, 'attachment', raw);
  pushMatches(text, VARIABLE_RE, 'variable', raw);
  pushMatches(text, INLINE_CODE_RE, 'code', raw);
  for (const hit of mentionHits(text, roster)) raw.push(hit);
  pushMatches(text, PATH_RE, 'path', raw);

  // Resolve overlaps by start order, keeping the first (higher-priority) claimer.
  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  const claimed: SpanHit[] = [];
  for (const hit of raw) {
    const overlaps = claimed.some((c) => hit.start < c.end && c.start < hit.end);
    if (!overlaps) claimed.push(hit);
  }
  claimed.sort((a, b) => a.start - b.start);

  const counters = new Map<ProtectedSpan['kind'], number>();
  return claimed.map((hit) => {
    const n = counters.get(hit.kind) ?? 0;
    counters.set(hit.kind, n + 1);
    return { id: `${hit.kind}-${n}`, kind: hit.kind, source: hit.source };
  });
}

export interface SpanValidation {
  /** Ids whose `source` is still present, intact, in the enhanced text. */
  preservedSpanIds: string[];
  /** Ids whose `source` is missing → the result is INVALID. */
  lostSpanIds: string[];
  /** True when every span survived. */
  valid: boolean;
}

/**
 * Deterministically check that every protected span's exact `source` still appears
 * in `enhanced`. Plain substring presence — no fuzzy match — because the contract
 * is "byte-for-byte intact".
 *
 * Multiplicity IS protected: if the original carried N distinct spans that share
 * the same `source` string (e.g. `{{deadline}}` used twice → two spans), the
 * enhanced text must contain that source at least N times. We consume one
 * occurrence per span, so dropping any single occurrence marks exactly one span
 * lost and disables Apply — a model cannot silently collapse `X … X` to `X`.
 */
export function validateProtectedSpans(
  enhanced: string,
  spans: readonly ProtectedSpan[],
): SpanValidation {
  // Pre-count available occurrences of each distinct source in the enhanced text.
  const available = new Map<string, number>();
  for (const span of spans) {
    if (available.has(span.source)) continue;
    let count = 0;
    for (let from = enhanced.indexOf(span.source); from >= 0; ) {
      count += 1;
      from = enhanced.indexOf(span.source, from + Math.max(span.source.length, 1));
    }
    available.set(span.source, count);
  }
  const preservedSpanIds: string[] = [];
  const lostSpanIds: string[] = [];
  for (const span of spans) {
    const remaining = available.get(span.source) ?? 0;
    if (remaining > 0) {
      available.set(span.source, remaining - 1);
      preservedSpanIds.push(span.id);
    } else {
      lostSpanIds.push(span.id);
    }
  }
  return { preservedSpanIds, lostSpanIds, valid: lostSpanIds.length === 0 };
}

/**
 * Map a span validation to the warning(s) that gate Apply. Emits the stable
 * `ENHANCE_SPAN_LOST_WARNING` marker when anything was lost; the UI keys
 * Apply-disabled off that marker via `resultIsApplyable()`. Returns an empty array
 * on success so callers can spread it into `warnings`.
 */
export function spanLossWarnings(validation: SpanValidation): string[] {
  return validation.valid ? [] : [ENHANCE_SPAN_LOST_WARNING];
}
