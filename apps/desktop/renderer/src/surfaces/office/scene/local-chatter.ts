/**
 * Pure deterministic local office chatter selector (presentation-only).
 *
 * All time, seed, visibility, suppression, actor eligibility, and history are
 * explicit inputs. This module never invents runtime truth, never calls a
 * model/network/persistence layer, and never reads wall-clock or Math.random.
 *
 * Priority: runtime truth > status explanation > local chatter.
 */

import {
  type ChatterCopyKey,
  type ChatterLocale,
  PAIR_DIALOGUE_SCRIPTS,
  REST_PAIR_DIALOGUE_SCRIPTS,
  SOLO_COMPLAINT_COPY_KEYS,
  SOLO_PLAYFUL_COPY_KEYS,
  normalizeChatterLocale,
  resolveChatterCopy,
} from './local-chatter-copy.js';
import { hashStringToInt } from './r3d/scene-hash.js';

/** Time quantization for deterministic variation across buckets. */
export const CHATTER_TIME_BUCKET_MS = 15_000;

/** Minimum gap between any two chatter presentations (scene-wide). */
export const CHATTER_GLOBAL_COOLDOWN_MS = 8_000;

/** Minimum gap before the same actor may speak again. */
export const CHATTER_ACTOR_COOLDOWN_MS = 20_000;

/** Minimum gap before the same unordered actor pair may dialogue again. */
export const CHATTER_PAIR_COOLDOWN_MS = 30_000;

/** Default concurrent local-chatter bubble budget. */
export const CHATTER_MAX_VISIBLE_DEFAULT = 2;

/** Solo bubble hold duration. */
const CHATTER_SOLO_HOLD_MS = 3_200;

/** Each utterance hold in a pair dialogue. */
const CHATTER_PAIR_UTTERANCE_HOLD_MS = 2_400;

/** Gap between pair utterances. */
const CHATTER_PAIR_UTTERANCE_GAP_MS = 450;

/** Copy-history window used to avoid immediate local repetition. */
const CHATTER_RECENT_COPY_LIMIT = 4;

type ChatterActorPresentationState = 'idle' | 'ambient' | 'busy' | 'working' | 'other';

export interface LocalChatterActor {
  readonly actorId: string;
  /** Only `idle` and `ambient` are eligible for local chatter. */
  readonly presentationState: ChatterActorPresentationState;
  /** Caller-supplied safe visual window (camera/occlusion/UI). */
  readonly safeVisualWindow: boolean;
  /** Canonical paired-break participant key (`a|b` sorted), when dwelling. */
  readonly pairHint?: string | null;
}

export interface LocalChatterPairHistory {
  readonly lastAtMs: number;
  /** Index of the script that must play next for this pair. */
  readonly nextScriptIndex: number;
  readonly lastScriptId: string;
}

export interface LocalChatterHistory {
  readonly lastGlobalAtMs: number | null;
  /** actorId → last chatter start ms */
  readonly lastActorAtMs: Readonly<Record<string, number>>;
  /** canonical pair key (`a|b` sorted) → pair-local cooldown/rotation */
  readonly perPair: Readonly<Record<string, LocalChatterPairHistory>>;
  /** Most recently presented copy keys, newest last. */
  readonly recentCopyKeys: readonly ChatterCopyKey[];
}

export interface LocalChatterInput {
  readonly nowMs: number;
  readonly seed: string;
  /** Raw locale tag; normalized via `normalizeChatterLocale`. */
  readonly locale: string;
  readonly reducedMotion: boolean;
  readonly runtimeTruthActive: boolean;
  readonly statusExplanationActive: boolean;
  readonly activeChatterCount: number;
  /** Defaults to `CHATTER_MAX_VISIBLE_DEFAULT`. Zero suppresses. */
  readonly maxVisible?: number;
  readonly actors: readonly LocalChatterActor[];
  readonly history: LocalChatterHistory;
}

type LocalChatterSuppressedReason =
  | 'runtime-truth'
  | 'status-explanation'
  | 'max-visible'
  | 'global-cooldown'
  | 'actor-cooldown'
  | 'pair-cooldown'
  | 'no-eligible-actor'
  | 'no-candidate';

type LocalChatterKind = 'solo-playful' | 'solo-complaint' | 'pair-dialogue';

export interface LocalChatterUtterance {
  readonly actorId: string;
  readonly copyKey: ChatterCopyKey;
  readonly text: string;
}

export interface LocalChatterPresentation {
  readonly id: string;
  readonly kind: LocalChatterKind;
  readonly locale: ChatterLocale;
  readonly actorIds: readonly string[];
  readonly utterances: readonly LocalChatterUtterance[];
  readonly startAtMs: number;
  readonly holdMs: number;
  readonly utteranceGapMs: number;
  /** Stable priority marker for integration layering. */
  readonly priority: 'local-chatter';
  readonly motion: 'animated' | 'static';
  /** Pair script id when kind is pair-dialogue; otherwise null. */
  readonly pairScriptId: string | null;
}

export type LocalChatterResult =
  | { readonly status: 'suppressed'; readonly reason: LocalChatterSuppressedReason }
  | {
      readonly status: 'chatter';
      readonly presentation: LocalChatterPresentation;
      readonly nextHistory: LocalChatterHistory;
    };

export function emptyLocalChatterHistory(): LocalChatterHistory {
  return {
    lastGlobalAtMs: null,
    lastActorAtMs: {},
    perPair: {},
    recentCopyKeys: [],
  };
}

export function pairKeyFor(actorIdA: string, actorIdB: string): string {
  return actorIdA < actorIdB ? `${actorIdA}|${actorIdB}` : `${actorIdB}|${actorIdA}`;
}

function cooldownElapsed(
  nowMs: number,
  lastAtMs: number | null | undefined,
  cooldownMs: number,
): boolean {
  if (lastAtMs == null) return true;
  return nowMs - lastAtMs >= cooldownMs;
}

function isEligiblePresentationState(state: ChatterActorPresentationState): boolean {
  return state === 'idle' || state === 'ambient';
}

function sortedActors(actors: readonly LocalChatterActor[]): LocalChatterActor[] {
  return [...actors].sort((a, b) => (a.actorId < b.actorId ? -1 : a.actorId > b.actorId ? 1 : 0));
}

function pickIndex(seedMaterial: string, length: number): number {
  if (length <= 0) return 0;
  let mixed = hashStringToInt(seedMaterial);
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x85ebca6b);
  mixed ^= mixed >>> 13;
  mixed = Math.imul(mixed, 0xc2b2ae35);
  mixed ^= mixed >>> 16;
  return (mixed >>> 0) % length;
}

type SoloCandidate = {
  readonly kind: 'solo-playful' | 'solo-complaint';
  readonly actorIds: readonly [string];
  readonly copyKey: ChatterCopyKey;
  readonly pairScriptId: null;
  readonly pairKey: null;
};

type PairCandidate = {
  readonly kind: 'pair-dialogue';
  readonly actorIds: readonly [string, string];
  readonly copyKeys: readonly [ChatterCopyKey, ChatterCopyKey];
  readonly pairScriptId: string;
  readonly pairKey: string;
  readonly restPair: boolean;
};

type ChatterCandidate = SoloCandidate | PairCandidate;

function buildSoloCandidates(
  eligibleAfterActorCd: readonly LocalChatterActor[],
  recentCopyKeys: readonly ChatterCopyKey[],
): SoloCandidate[] {
  const solos: SoloCandidate[] = [];
  const recent = new Set(recentCopyKeys);
  for (const actor of eligibleAfterActorCd) {
    for (const key of SOLO_PLAYFUL_COPY_KEYS) {
      if (recent.has(key)) continue;
      solos.push({
        kind: 'solo-playful',
        actorIds: [actor.actorId],
        copyKey: key,
        pairScriptId: null,
        pairKey: null,
      });
    }
    for (const key of SOLO_COMPLAINT_COPY_KEYS) {
      if (recent.has(key)) continue;
      solos.push({
        kind: 'solo-complaint',
        actorIds: [actor.actorId],
        copyKey: key,
        pairScriptId: null,
        pairKey: null,
      });
    }
  }
  return solos;
}

function buildPairCandidates(
  eligibleAfterActorCd: readonly LocalChatterActor[],
  history: LocalChatterHistory,
  nowMs: number,
  seed: string,
  timeBucket: number,
): { readonly pairs: PairCandidate[]; readonly anyPairOnCooldown: boolean } {
  const pairs: PairCandidate[] = [];
  let anyPairOnCooldown = false;
  for (let i = 0; i < eligibleAfterActorCd.length; i += 1) {
    for (let j = i + 1; j < eligibleAfterActorCd.length; j += 1) {
      const a = eligibleAfterActorCd[i];
      const b = eligibleAfterActorCd[j];
      if (!a || !b || a.actorId === b.actorId) continue;
      const pairKey = pairKeyFor(a.actorId, b.actorId);
      const pairHistory = history.perPair[pairKey];
      if (!cooldownElapsed(nowMs, pairHistory?.lastAtMs, CHATTER_PAIR_COOLDOWN_MS)) {
        anyPairOnCooldown = true;
        continue;
      }
      const restPair = a.pairHint != null && a.pairHint === pairKey && b.pairHint === a.pairHint;
      const scripts = restPair ? REST_PAIR_DIALOGUE_SCRIPTS : PAIR_DIALOGUE_SCRIPTS;
      const scriptIndex =
        pairHistory?.nextScriptIndex ??
        pickIndex(`${seed}|${timeBucket}|${pairKey}|initial-script`, scripts.length);
      const normalizedScriptIndex =
        ((scriptIndex % scripts.length) + scripts.length) % scripts.length;
      const script = scripts[normalizedScriptIndex];
      if (!script) continue;
      pairs.push({
        kind: 'pair-dialogue',
        actorIds: [a.actorId, b.actorId],
        copyKeys: script.keys,
        pairScriptId: script.id,
        pairKey,
        restPair,
      });
    }
  }
  return { pairs, anyPairOnCooldown };
}

function candidateSeedMaterial(
  seed: string,
  timeBucket: number,
  candidate: ChatterCandidate,
): string {
  if (candidate.kind === 'pair-dialogue') {
    return [
      seed,
      timeBucket,
      candidate.kind,
      candidate.pairScriptId,
      candidate.actorIds.join(','),
      candidate.copyKeys.join(','),
    ].join('|');
  }
  return [seed, timeBucket, candidate.kind, candidate.actorIds[0], candidate.copyKey].join('|');
}

function selectCandidate(
  seed: string,
  timeBucket: number,
  candidates: readonly ChatterCandidate[],
): ChatterCandidate {
  // Balance playful/complaint solo families before the deterministic in-family
  // pick. Pair candidates naturally form one family.
  const kinds = [...new Set(candidates.map((c) => c.kind))].sort();
  const kind = kinds[pickIndex(`${seed}|${timeBucket}|kind`, kinds.length)] ?? kinds[0];
  if (!kind) {
    throw new Error('selectCandidate requires a non-empty candidate list');
  }
  const inKind = candidates.filter((c) => c.kind === kind);
  const ranked = [...inKind].sort((a, b) => {
    const left = candidateSeedMaterial(seed, timeBucket, a);
    const right = candidateSeedMaterial(seed, timeBucket, b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const picked =
    ranked[pickIndex(`${seed}|${timeBucket}|pick|${kind}`, ranked.length)] ?? ranked[0];
  if (!picked) {
    throw new Error('selectCandidate failed to pick within kind');
  }
  return picked;
}

function presentationId(
  seed: string,
  timeBucket: number,
  kind: LocalChatterKind,
  actorIds: readonly string[],
  copyKeys: readonly string[],
  pairScriptId: string | null,
): string {
  const material = [
    seed,
    timeBucket,
    kind,
    actorIds.join(','),
    copyKeys.join(','),
    pairScriptId ?? '-',
  ].join('|');
  return `chatter:${hashStringToInt(material).toString(16)}`;
}

function nextHistoryFrom(
  history: LocalChatterHistory,
  nowMs: number,
  actorIds: readonly string[],
  pairKey: string | null,
  pairScriptId: string | null,
  copyKeys: readonly ChatterCopyKey[],
): LocalChatterHistory {
  const lastActorAtMs: Record<string, number> = { ...history.lastActorAtMs };
  for (const actorId of actorIds) {
    lastActorAtMs[actorId] = nowMs;
  }
  const perPair: Record<string, LocalChatterPairHistory> = { ...history.perPair };
  if (pairKey != null && pairScriptId != null) {
    const scripts = REST_PAIR_DIALOGUE_SCRIPTS.some((script) => script.id === pairScriptId)
      ? REST_PAIR_DIALOGUE_SCRIPTS
      : PAIR_DIALOGUE_SCRIPTS;
    const scriptIndex = scripts.findIndex((script) => script.id === pairScriptId);
    perPair[pairKey] = {
      lastAtMs: nowMs,
      nextScriptIndex: (scriptIndex + 1) % scripts.length,
      lastScriptId: pairScriptId,
    };
  }
  return {
    lastGlobalAtMs: nowMs,
    lastActorAtMs,
    perPair,
    recentCopyKeys: [...history.recentCopyKeys, ...copyKeys].slice(-CHATTER_RECENT_COPY_LIMIT),
  };
}

/**
 * Select the next local chatter presentation, or a stable suppressed reason.
 * Pure and deterministic for identical inputs.
 */
export function selectLocalChatter(input: LocalChatterInput): LocalChatterResult {
  // Priority suppressions — runtime truth always wins over status explanation.
  if (input.runtimeTruthActive) {
    return { status: 'suppressed', reason: 'runtime-truth' };
  }
  if (input.statusExplanationActive) {
    return { status: 'suppressed', reason: 'status-explanation' };
  }

  const maxVisible = input.maxVisible ?? CHATTER_MAX_VISIBLE_DEFAULT;
  if (maxVisible <= 0 || input.activeChatterCount >= maxVisible) {
    return { status: 'suppressed', reason: 'max-visible' };
  }

  if (!cooldownElapsed(input.nowMs, input.history.lastGlobalAtMs, CHATTER_GLOBAL_COOLDOWN_MS)) {
    return { status: 'suppressed', reason: 'global-cooldown' };
  }

  const locale = normalizeChatterLocale(input.locale);
  const timeBucket = Math.floor(input.nowMs / CHATTER_TIME_BUCKET_MS);
  const actors = sortedActors(input.actors);

  const baseEligible = actors.filter(
    (actor) => isEligiblePresentationState(actor.presentationState) && actor.safeVisualWindow,
  );
  if (baseEligible.length === 0) {
    return { status: 'suppressed', reason: 'no-eligible-actor' };
  }

  const eligibleAfterActorCd = baseEligible.filter((actor) =>
    cooldownElapsed(
      input.nowMs,
      input.history.lastActorAtMs[actor.actorId],
      CHATTER_ACTOR_COOLDOWN_MS,
    ),
  );
  if (eligibleAfterActorCd.length === 0) {
    return { status: 'suppressed', reason: 'actor-cooldown' };
  }

  // Prefer paired dialogue whenever at least one pair is playable. If every
  // pair is cooling down, keep the office alive with a solo line instead.
  let candidates: readonly ChatterCandidate[];
  if (eligibleAfterActorCd.length >= 2) {
    const { pairs, anyPairOnCooldown } = buildPairCandidates(
      eligibleAfterActorCd,
      input.history,
      input.nowMs,
      input.seed,
      timeBucket,
    );
    if (pairs.length > 0) {
      const restPairs = pairs.filter((pair) => pair.restPair);
      candidates = restPairs.length > 0 ? restPairs : pairs;
    } else {
      candidates = buildSoloCandidates(eligibleAfterActorCd, input.history.recentCopyKeys);
      if (candidates.length === 0 && input.history.recentCopyKeys.length > 0) {
        candidates = buildSoloCandidates(eligibleAfterActorCd, []);
      }
      if (candidates.length === 0) {
        return {
          status: 'suppressed',
          reason: anyPairOnCooldown ? 'pair-cooldown' : 'no-candidate',
        };
      }
    }
  } else {
    candidates = buildSoloCandidates(eligibleAfterActorCd, input.history.recentCopyKeys);
    if (candidates.length === 0 && input.history.recentCopyKeys.length > 0) {
      candidates = buildSoloCandidates(eligibleAfterActorCd, []);
    }
    if (candidates.length === 0) {
      return { status: 'suppressed', reason: 'no-candidate' };
    }
  }

  const chosen = selectCandidate(input.seed, timeBucket, candidates);
  const motion = input.reducedMotion ? 'static' : 'animated';

  if (chosen.kind === 'pair-dialogue') {
    const [actorA, actorB] = chosen.actorIds;
    const [keyA, keyB] = chosen.copyKeys;
    const utterances = [
      {
        actorId: actorA,
        copyKey: keyA,
        text: resolveChatterCopy(locale, keyA),
      },
      {
        actorId: actorB,
        copyKey: keyB,
        text: resolveChatterCopy(locale, keyB),
      },
    ] as const;
    const presentation: LocalChatterPresentation = {
      id: presentationId(
        input.seed,
        timeBucket,
        chosen.kind,
        chosen.actorIds,
        chosen.copyKeys,
        chosen.pairScriptId,
      ),
      kind: chosen.kind,
      locale,
      actorIds: chosen.actorIds,
      utterances,
      startAtMs: input.nowMs,
      holdMs: CHATTER_PAIR_UTTERANCE_HOLD_MS,
      utteranceGapMs: CHATTER_PAIR_UTTERANCE_GAP_MS,
      priority: 'local-chatter',
      motion,
      pairScriptId: chosen.pairScriptId,
    };
    return {
      status: 'chatter',
      presentation,
      nextHistory: nextHistoryFrom(
        input.history,
        input.nowMs,
        chosen.actorIds,
        chosen.pairKey,
        chosen.pairScriptId,
        chosen.copyKeys,
      ),
    };
  }

  const actorId = chosen.actorIds[0];
  const utterances = [
    {
      actorId,
      copyKey: chosen.copyKey,
      text: resolveChatterCopy(locale, chosen.copyKey),
    },
  ] as const;
  const presentation: LocalChatterPresentation = {
    id: presentationId(
      input.seed,
      timeBucket,
      chosen.kind,
      chosen.actorIds,
      [chosen.copyKey],
      null,
    ),
    kind: chosen.kind,
    locale,
    actorIds: chosen.actorIds,
    utterances,
    startAtMs: input.nowMs,
    holdMs: CHATTER_SOLO_HOLD_MS,
    utteranceGapMs: 0,
    priority: 'local-chatter',
    motion,
    pairScriptId: null,
  };
  return {
    status: 'chatter',
    presentation,
    nextHistory: nextHistoryFrom(input.history, input.nowMs, chosen.actorIds, null, null, [
      chosen.copyKey,
    ]),
  };
}
