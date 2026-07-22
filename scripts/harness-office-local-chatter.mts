/**
 * Office local-chatter foundation gate.
 *
 * Locks the pure deterministic selector + keyed en/zh-CN copy catalog before
 * any React/scene integration. No wall-clock, Math.random, model, network, or
 * persistence is involved.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CHATTER_COPY_MAX_CHARS_EN,
  CHATTER_COPY_MAX_CHARS_ZH,
  type ChatterCopyKey,
  PAIR_DIALOGUE_SCRIPTS,
  SOLO_COMPLAINT_COPY_KEYS,
  SOLO_PLAYFUL_COPY_KEYS,
  allChatterCopyKeys,
  chatterCopyCatalog,
  normalizeChatterLocale,
  resolveChatterCopy,
} from '../apps/desktop/renderer/src/surfaces/office/scene/local-chatter-copy.js';
import {
  CHATTER_ACTOR_COOLDOWN_MS,
  CHATTER_GLOBAL_COOLDOWN_MS,
  CHATTER_MAX_VISIBLE_DEFAULT,
  CHATTER_PAIR_COOLDOWN_MS,
  CHATTER_TIME_BUCKET_MS,
  type LocalChatterActor,
  type LocalChatterHistory,
  type LocalChatterInput,
  type LocalChatterPairHistory,
  type LocalChatterResult,
  emptyLocalChatterHistory,
  pairKeyFor,
  selectLocalChatter,
} from '../apps/desktop/renderer/src/surfaces/office/scene/local-chatter.js';
import { createHarness, deepFreeze } from './lib/harness-runner.mjs';

const h = createHarness('office-local-chatter gate');
const { check, section } = h;

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELECTOR_SRC = `${ROOT}/apps/desktop/renderer/src/surfaces/office/scene/local-chatter.ts`;
const COPY_SRC = `${ROOT}/apps/desktop/renderer/src/surfaces/office/scene/local-chatter-copy.ts`;

function json(value: unknown): string {
  return JSON.stringify(value);
}

function copySignature(result: LocalChatterResult): string | null {
  if (result.status !== 'chatter') return null;
  return `${result.presentation.kind}:${result.presentation.utterances
    .map((utterance) => utterance.copyKey)
    .join('|')}`;
}

function actor(
  actorId: string,
  over: Partial<Omit<LocalChatterActor, 'actorId'>> = {},
): LocalChatterActor {
  return {
    actorId,
    presentationState: over.presentationState ?? 'idle',
    safeVisualWindow: over.safeVisualWindow ?? true,
  };
}

function baseInput(over: Partial<LocalChatterInput> = {}): LocalChatterInput {
  return {
    nowMs: over.nowMs ?? 1_000_000,
    seed: over.seed ?? 'office-chatter-seed',
    locale: over.locale ?? 'en',
    reducedMotion: over.reducedMotion ?? false,
    runtimeTruthActive: over.runtimeTruthActive ?? false,
    statusExplanationActive: over.statusExplanationActive ?? false,
    activeChatterCount: over.activeChatterCount ?? 0,
    maxVisible: over.maxVisible,
    actors: over.actors ?? [actor('ava'), actor('ben')],
    history: over.history ?? emptyLocalChatterHistory(),
  };
}

function mustChatter(
  result: LocalChatterResult,
  label: string,
): Extract<LocalChatterResult, { status: 'chatter' }> {
  check(label, result.status === 'chatter', json(result));
  if (result.status === 'chatter') return result;
  // Unreachable for later field checks when the gate fails; keep a typed stub.
  return {
    status: 'chatter',
    presentation: {
      id: 'chatter:missing',
      kind: 'solo-playful',
      locale: 'en',
      actorIds: [],
      utterances: [],
      startAtMs: 0,
      holdMs: 0,
      utteranceGapMs: 0,
      priority: 'local-chatter',
      motion: 'animated',
      pairScriptId: null,
    },
    nextHistory: emptyLocalChatterHistory(),
  };
}

function historyWith(
  over: Partial<{
    lastGlobalAtMs: number | null;
    lastActorAtMs: Record<string, number>;
    perPair: Record<string, LocalChatterPairHistory>;
    recentCopyKeys: readonly ChatterCopyKey[];
  }> = {},
): LocalChatterHistory {
  return {
    lastGlobalAtMs: over.lastGlobalAtMs ?? null,
    lastActorAtMs: over.lastActorAtMs ?? {},
    perPair: over.perPair ?? {},
    recentCopyKeys: over.recentCopyKeys ?? [],
  };
}

// ── Determinism ─────────────────────────────────────────────────────────────

section('[determinism] identity and actor-order invariant');
{
  const input = baseInput({
    actors: [actor('ava'), actor('ben'), actor('cy')],
    seed: 'det-seed-1',
    nowMs: 2_000_000,
  });
  const a = selectLocalChatter(input);
  const b = selectLocalChatter(input);
  check('identical input → deep-equal output', json(a) === json(b), json(a));

  const reordered = selectLocalChatter(
    baseInput({
      ...input,
      actors: [actor('cy'), actor('ben'), actor('ava')],
    }),
  );
  check(
    'actor input order does not affect output',
    json(a) === json(reordered),
    `ordered=${json(a)} reordered=${json(reordered)}`,
  );
}

section('[determinism] seed/time-bucket variation');
{
  const nowA = 3_000_000;
  const nowB = nowA + CHATTER_TIME_BUCKET_MS;
  let foundVariation = false;
  let sampleA: LocalChatterResult | null = null;
  let sampleB: LocalChatterResult | null = null;
  for (let i = 0; i < 64; i += 1) {
    const seed = `bucket-var-${i}`;
    const left = selectLocalChatter(
      baseInput({
        seed,
        nowMs: nowA,
        actors: [actor('ava'), actor('ben')],
      }),
    );
    const right = selectLocalChatter(
      baseInput({
        seed,
        nowMs: nowB,
        actors: [actor('ava'), actor('ben')],
      }),
    );
    if (
      left.status === 'chatter' &&
      right.status === 'chatter' &&
      copySignature(left) !== copySignature(right)
    ) {
      foundVariation = true;
      sampleA = left;
      sampleB = right;
      break;
    }
  }
  check(
    'known seed/time-bucket pair yields distinct chatter (fixture search)',
    foundVariation,
    `a=${json(sampleA)} b=${json(sampleB)}`,
  );

  let soloVariation = false;
  let soloA: LocalChatterResult | null = null;
  let soloB: LocalChatterResult | null = null;
  for (let i = 0; i < 64; i += 1) {
    const left = selectLocalChatter(
      baseInput({ seed: `solo-var-a-${i}`, nowMs: nowA, actors: [actor('solo-only')] }),
    );
    const right = selectLocalChatter(
      baseInput({ seed: `solo-var-b-${i}`, nowMs: nowA, actors: [actor('solo-only')] }),
    );
    if (
      left.status === 'chatter' &&
      right.status === 'chatter' &&
      copySignature(left) !== copySignature(right)
    ) {
      soloVariation = true;
      soloA = left;
      soloB = right;
      break;
    }
  }
  check(
    'different seeds can vary solo copy under one bucket',
    soloVariation,
    `a=${json(soloA)} b=${json(soloB)}`,
  );
}

// ── Suppression priority ────────────────────────────────────────────────────

section('[suppress] priority and eligibility');
function suppressedReason(result: LocalChatterResult): string | null {
  return result.status === 'suppressed' ? result.reason : null;
}
check(
  'runtime truth suppresses',
  suppressedReason(selectLocalChatter(baseInput({ runtimeTruthActive: true }))) === 'runtime-truth',
);
check(
  'runtime truth wins over status explanation',
  suppressedReason(
    selectLocalChatter(baseInput({ runtimeTruthActive: true, statusExplanationActive: true })),
  ) === 'runtime-truth',
);
check(
  'status explanation suppresses when alone',
  suppressedReason(selectLocalChatter(baseInput({ statusExplanationActive: true }))) ===
    'status-explanation',
);
check(
  'status wins over chatter (no runtime truth)',
  suppressedReason(
    selectLocalChatter(baseInput({ statusExplanationActive: true, runtimeTruthActive: false })),
  ) === 'status-explanation',
);
check(
  'non-idle / non-ambient actor is ineligible',
  suppressedReason(
    selectLocalChatter(baseInput({ actors: [actor('ava', { presentationState: 'busy' })] })),
  ) === 'no-eligible-actor',
);
check(
  'unsafe visual window is ineligible',
  suppressedReason(
    selectLocalChatter(baseInput({ actors: [actor('ava', { safeVisualWindow: false })] })),
  ) === 'no-eligible-actor',
);
check(
  'ambient + safe window remains eligible (solo)',
  mustChatter(
    selectLocalChatter(baseInput({ actors: [actor('ava', { presentationState: 'ambient' })] })),
    'ambient eligible',
  ).presentation.kind.startsWith('solo'),
);
check(
  'maxVisible=0 suppresses',
  suppressedReason(selectLocalChatter(baseInput({ maxVisible: 0 }))) === 'max-visible',
);
check(
  'activeChatterCount >= maxVisible suppresses',
  suppressedReason(selectLocalChatter(baseInput({ maxVisible: 1, activeChatterCount: 1 }))) ===
    'max-visible',
);
check(
  'activeChatterCount below maxVisible remains eligible',
  selectLocalChatter(baseInput({ maxVisible: 2, activeChatterCount: 1 })).status === 'chatter',
);
check(
  'default maxVisible constant is positive',
  CHATTER_MAX_VISIBLE_DEFAULT > 0,
  String(CHATTER_MAX_VISIBLE_DEFAULT),
);

// ── Solo / pair paths ───────────────────────────────────────────────────────

section('[paths] solo and pair');
{
  const solo = mustChatter(
    selectLocalChatter(baseInput({ actors: [actor('ava')], seed: 'solo-path' })),
    'solo path reachable',
  );
  check(
    'solo kind is playful or complaint',
    solo.presentation.kind === 'solo-playful' || solo.presentation.kind === 'solo-complaint',
    solo.presentation.kind,
  );
  check(
    'solo has one utterance and one actor',
    solo.presentation.actorIds.length === 1 && solo.presentation.utterances.length === 1,
  );

  const pair = mustChatter(
    selectLocalChatter(baseInput({ actors: [actor('ava'), actor('ben')], seed: 'pair-path' })),
    'pair path reachable',
  );
  check('pair kind is pair-dialogue', pair.presentation.kind === 'pair-dialogue');
  check(
    'pair participants are distinct',
    pair.presentation.actorIds.length === 2 &&
      pair.presentation.actorIds[0] !== pair.presentation.actorIds[1],
    json(pair.presentation.actorIds),
  );
  check(
    'pair utterances match distinct eligible actors',
    pair.presentation.utterances.length === 2 &&
      pair.presentation.utterances[0]?.actorId === pair.presentation.actorIds[0] &&
      pair.presentation.utterances[1]?.actorId === pair.presentation.actorIds[1],
  );
  check(
    'pair script id is set',
    typeof pair.presentation.pairScriptId === 'string' &&
      PAIR_DIALOGUE_SCRIPTS.some((s) => s.id === pair.presentation.pairScriptId),
    String(pair.presentation.pairScriptId),
  );
}

section('[paths] pair rotation');
{
  const nowMs = 5_000_000;
  const actors = [actor('ava'), actor('ben')];
  const first = mustChatter(
    selectLocalChatter(
      baseInput({ actors, seed: 'rotate', nowMs, history: emptyLocalChatterHistory() }),
    ),
    'first pair chatter',
  );
  const firstScript = first.presentation.pairScriptId;
  check('first pair has script', firstScript != null);

  const second = mustChatter(
    selectLocalChatter(
      baseInput({
        actors,
        seed: 'rotate',
        nowMs: nowMs + CHATTER_PAIR_COOLDOWN_MS,
        history: first.nextHistory,
      }),
    ),
    'second pair chatter after pair cooldown',
  );
  check(
    'immediate pair script repetition is prevented when alternatives exist',
    second.presentation.pairScriptId !== firstScript,
    `first=${firstScript} second=${second.presentation.pairScriptId}`,
  );

  // Deterministic rotation: same inputs after the same history → same next script.
  const secondReplay = selectLocalChatter(
    baseInput({
      actors,
      seed: 'rotate',
      nowMs: nowMs + CHATTER_PAIR_COOLDOWN_MS,
      history: first.nextHistory,
    }),
  );
  check('pair rotation is deterministic', json(second) === json(secondReplay));

  const seen = new Set<string>();
  let history = emptyLocalChatterHistory();
  let t = nowMs;
  for (let step = 0; step < PAIR_DIALOGUE_SCRIPTS.length; step += 1) {
    const result = mustChatter(
      selectLocalChatter(
        baseInput({
          actors,
          seed: 'rotate-cycle',
          nowMs: t,
          history,
        }),
      ),
      `rotation step ${step}`,
    );
    if (result.presentation.pairScriptId) seen.add(result.presentation.pairScriptId);
    history = result.nextHistory;
    t += CHATTER_PAIR_COOLDOWN_MS;
  }
  check(
    'rotation visits more than one pair script across a cycle',
    seen.size >= 2,
    json([...seen]),
  );

  const pairAB = pairKeyFor('ava', 'ben');
  const pairCD = pairKeyFor('cy', 'dia');
  const isolatedHistory = historyWith({
    lastGlobalAtMs: nowMs - CHATTER_GLOBAL_COOLDOWN_MS,
    perPair: {
      [pairAB]: {
        lastAtMs: nowMs,
        nextScriptIndex: 2,
        lastScriptId: 'pair.window',
      },
    },
  });
  const unrelatedPair = mustChatter(
    selectLocalChatter(
      baseInput({
        actors: [actor('cy'), actor('dia')],
        seed: 'pair-local-history',
        nowMs,
        history: isolatedHistory,
      }),
    ),
    'unrelated pair remains eligible',
  );
  check(
    'pair rotation state is stored per pair',
    isolatedHistory.perPair[pairCD] === undefined &&
      unrelatedPair.nextHistory.perPair[pairAB] === isolatedHistory.perPair[pairAB] &&
      unrelatedPair.nextHistory.perPair[pairCD]?.lastScriptId ===
        unrelatedPair.presentation.pairScriptId,
  );
}

section('[paths] recent solo copy rotation');
{
  const nowMs = 6_000_000;
  const first = mustChatter(
    selectLocalChatter(baseInput({ actors: [actor('ava')], seed: 'solo-copy-rotation', nowMs })),
    'first solo copy',
  );
  const firstKey = first.presentation.utterances[0]?.copyKey;
  const second = mustChatter(
    selectLocalChatter(
      baseInput({
        actors: [actor('ava')],
        seed: 'solo-copy-rotation',
        nowMs,
        history: historyWith({
          lastGlobalAtMs: nowMs - CHATTER_GLOBAL_COOLDOWN_MS,
          lastActorAtMs: { ava: nowMs - CHATTER_ACTOR_COOLDOWN_MS },
          recentCopyKeys: firstKey ? [firstKey] : [],
        }),
      }),
    ),
    'second solo copy',
  );
  check(
    'recent solo copy does not immediately repeat',
    firstKey != null && second.presentation.utterances[0]?.copyKey !== firstKey,
    `first=${firstKey} second=${second.presentation.utterances[0]?.copyKey}`,
  );
}

// ── Cooldown boundaries ─────────────────────────────────────────────────────

section('[cooldown] global / actor / pair boundaries');
{
  const nowMs = 8_000_000;

  check(
    'global cooldown: 1ms before → suppressed',
    suppressedReason(
      selectLocalChatter(
        baseInput({
          actors: [actor('ava')],
          nowMs,
          history: historyWith({ lastGlobalAtMs: nowMs - CHATTER_GLOBAL_COOLDOWN_MS + 1 }),
        }),
      ),
    ) === 'global-cooldown',
  );
  check(
    'global cooldown: exactly at → eligible',
    mustChatter(
      selectLocalChatter(
        baseInput({
          actors: [actor('ava')],
          nowMs,
          history: historyWith({ lastGlobalAtMs: nowMs - CHATTER_GLOBAL_COOLDOWN_MS }),
        }),
      ),
      'global exact',
    ).status === 'chatter',
  );

  check(
    'actor cooldown: 1ms before → suppressed',
    suppressedReason(
      selectLocalChatter(
        baseInput({
          actors: [actor('ava')],
          nowMs,
          history: historyWith({
            lastGlobalAtMs: nowMs - CHATTER_GLOBAL_COOLDOWN_MS,
            lastActorAtMs: { ava: nowMs - CHATTER_ACTOR_COOLDOWN_MS + 1 },
          }),
        }),
      ),
    ) === 'actor-cooldown',
  );
  check(
    'actor cooldown: exactly at → eligible',
    mustChatter(
      selectLocalChatter(
        baseInput({
          actors: [actor('ava')],
          nowMs,
          history: historyWith({
            lastGlobalAtMs: nowMs - CHATTER_GLOBAL_COOLDOWN_MS,
            lastActorAtMs: { ava: nowMs - CHATTER_ACTOR_COOLDOWN_MS },
          }),
        }),
      ),
      'actor exact',
    ).status === 'chatter',
  );

  const pairKey = pairKeyFor('ava', 'ben');
  check(
    'pair cooldown: 1ms before → suppressed',
    suppressedReason(
      selectLocalChatter(
        baseInput({
          actors: [actor('ava'), actor('ben')],
          nowMs,
          history: historyWith({
            lastGlobalAtMs: nowMs - CHATTER_GLOBAL_COOLDOWN_MS,
            perPair: {
              [pairKey]: {
                lastAtMs: nowMs - CHATTER_PAIR_COOLDOWN_MS + 1,
                nextScriptIndex: 1,
                lastScriptId: 'pair.coffee',
              },
            },
          }),
        }),
      ),
    ) === 'pair-cooldown',
  );
  check(
    'pair cooldown: exactly at → eligible',
    mustChatter(
      selectLocalChatter(
        baseInput({
          actors: [actor('ava'), actor('ben')],
          nowMs,
          history: historyWith({
            lastGlobalAtMs: nowMs - CHATTER_GLOBAL_COOLDOWN_MS,
            perPair: {
              [pairKey]: {
                lastAtMs: nowMs - CHATTER_PAIR_COOLDOWN_MS,
                nextScriptIndex: 1,
                lastScriptId: 'pair.coffee',
              },
            },
          }),
        }),
      ),
      'pair exact',
    ).presentation.kind === 'pair-dialogue',
  );
}

// ── Motion / locale ─────────────────────────────────────────────────────────

section('[motion] reducedMotion');
{
  const animated = mustChatter(
    selectLocalChatter(baseInput({ actors: [actor('ava')], reducedMotion: false })),
    'animated',
  );
  const staticMotion = mustChatter(
    selectLocalChatter(baseInput({ actors: [actor('ava')], reducedMotion: true })),
    'static',
  );
  check('normal motion is animated', animated.presentation.motion === 'animated');
  check(
    'reducedMotion does not suppress; motion=static',
    staticMotion.status === 'chatter' && staticMotion.presentation.motion === 'static',
  );
}

section('[locale] normalize + resolve');
{
  check('en → en', normalizeChatterLocale('en') === 'en');
  check('en-US → en', normalizeChatterLocale('en-US') === 'en');
  check('zh → zh-CN', normalizeChatterLocale('zh') === 'zh-CN');
  check('zh-CN → zh-CN', normalizeChatterLocale('zh-CN') === 'zh-CN');
  check('zh-Hans → zh-CN', normalizeChatterLocale('zh-Hans') === 'zh-CN');
  check('zh_CN → zh-CN', normalizeChatterLocale('zh_CN') === 'zh-CN');
  check('zh-Hans-CN → zh-CN', normalizeChatterLocale('zh-Hans-CN') === 'zh-CN');
  check('zh-TW → zh-CN', normalizeChatterLocale('zh-TW') === 'zh-CN');
  check('zh-Hant → zh-CN', normalizeChatterLocale('zh-Hant') === 'zh-CN');
  check('unknown → en', normalizeChatterLocale('fr-CA') === 'en');
  check('empty → en', normalizeChatterLocale('') === 'en');
  check('nullish → en', normalizeChatterLocale(undefined) === 'en');

  const en = mustChatter(
    selectLocalChatter(baseInput({ actors: [actor('ava')], locale: 'en', seed: 'locale' })),
    'en chatter',
  );
  const zh = mustChatter(
    selectLocalChatter(baseInput({ actors: [actor('ava')], locale: 'zh-Hans', seed: 'locale' })),
    'zh chatter',
  );
  check('en presentation locale', en.presentation.locale === 'en');
  check('zh alias presentation locale', zh.presentation.locale === 'zh-CN');
  check(
    'en/zh texts differ for same key path',
    en.presentation.utterances[0]?.copyKey === zh.presentation.utterances[0]?.copyKey &&
      en.presentation.utterances[0]?.text !== zh.presentation.utterances[0]?.text,
    `en=${en.presentation.utterances[0]?.text} zh=${zh.presentation.utterances[0]?.text}`,
  );
}

// ── Copy catalog integrity ──────────────────────────────────────────────────

section('[copy] catalog integrity and safety');
{
  const keys = allChatterCopyKeys();
  const en = chatterCopyCatalog('en');
  const zh = chatterCopyCatalog('zh-CN');
  check('catalog non-empty', keys.length > 0, String(keys.length));
  check(
    'solo playful keys registered',
    SOLO_PLAYFUL_COPY_KEYS.every((k) => keys.includes(k)),
  );
  check(
    'solo complaint keys registered',
    SOLO_COMPLAINT_COPY_KEYS.every((k) => keys.includes(k)),
  );
  check(
    'pair script keys registered',
    PAIR_DIALOGUE_SCRIPTS.every((script) => script.keys.every((k) => keys.includes(k))),
  );

  const forbiddenEn =
    /\b(progress|tool|model|commit|build|test|upload|deliver|deploy|token|agent|ship|merge|release|complete|finish)\w*\b/i;
  const forbiddenZh =
    /(进度|工具|模型|提交|构建|测试|上传|交付|部署|令牌|代理|发布|合并|上线|完成|做完|通过|出货)/;

  let missing = 0;
  let tooLong = 0;
  let unsafe = 0;
  for (const key of keys) {
    const enText = resolveChatterCopy('en', key);
    const zhText = resolveChatterCopy('zh-CN', key);
    if (!enText || !zhText) missing += 1;
    if (enText.length > CHATTER_COPY_MAX_CHARS_EN) tooLong += 1;
    if (zhText.length > CHATTER_COPY_MAX_CHARS_ZH) tooLong += 1;
    if (forbiddenEn.test(enText) || forbiddenZh.test(zhText)) unsafe += 1;
    if (forbiddenEn.test(en[key]) || forbiddenZh.test(zh[key])) unsafe += 1;
  }
  check('every key resolves in en and zh-CN', missing === 0, `missing=${missing}`);
  check(
    'concise limits hold',
    tooLong === 0,
    `tooLong=${tooLong} enMax=${CHATTER_COPY_MAX_CHARS_EN} zhMax=${CHATTER_COPY_MAX_CHARS_ZH}`,
  );
  check(
    'catalog has no progress/tool/model/commit/build/test/upload/delivery claims',
    unsafe === 0,
    `unsafe=${unsafe}`,
  );

  // Presentation keys from a live selection must resolve.
  const live = mustChatter(
    selectLocalChatter(
      baseInput({ actors: [actor('ava'), actor('ben')], locale: 'zh-CN', seed: 'live-keys' }),
    ),
    'live keys',
  );
  check(
    'live presentation keys exist in both locales',
    live.presentation.utterances.every((u) => {
      const key = u.copyKey as ChatterCopyKey;
      return Boolean(resolveChatterCopy('en', key) && resolveChatterCopy('zh-CN', key));
    }),
  );
}

// ── Immutability / no global bleed ──────────────────────────────────────────

section('[purity] immutability and no global state');
{
  const history = historyWith({
    lastGlobalAtMs: 1,
    lastActorAtMs: { ava: 1 },
    perPair: {
      'ava|ben': { lastAtMs: 1, nextScriptIndex: 1, lastScriptId: 'pair.coffee' },
    },
    recentCopyKeys: ['pair.coffee.a', 'pair.coffee.b'],
  });
  const actors = [actor('ava'), actor('ben')];
  const input = deepFreeze(
    baseInput({
      nowMs: 9_000_000,
      actors,
      history,
      seed: 'immut',
    }),
  );
  const historyBefore = json(history);
  const actorsBefore = json(actors);
  const first = selectLocalChatter(input);
  const second = selectLocalChatter(input);
  check('repeated calls deep-equal (no global bleed)', json(first) === json(second));
  check('history input not mutated', json(history) === historyBefore);
  check('actors input not mutated', json(actors) === actorsBefore);
  if (first.status === 'chatter') {
    check(
      'nextHistory is a fresh object',
      first.nextHistory !== history && json(first.nextHistory) !== historyBefore,
    );
  }
}

// ── Source boundary ─────────────────────────────────────────────────────────

section('[boundary] forbidden imports/calls in selector modules');
{
  const selector = readFileSync(SELECTOR_SRC, 'utf8');
  const copy = readFileSync(COPY_SRC, 'utf8');
  const combined = `${selector}\n${copy}`;

  // Strip block/line comments so documentary mentions (e.g. "no Math.random")
  // do not trip the call/import boundary scan.
  const codeOnly = combined.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  const forbiddenPatterns: Array<[string, RegExp]> = [
    ['Date.now call', /\bDate\.now\s*\(/],
    ['Math.random call', /\bMath\.random\s*\(/],
    ['localeCompare call', /\blocaleCompare\s*\(/],
    ['fetch(', /\bfetch\s*\(/],
    ['localStorage', /\blocalStorage\b/],
    ['sessionStorage', /\bsessionStorage\b/],
    ['indexedDB', /\bindexedDB\b/],
    ['WebSocket', /\bWebSocket\b/],
    ['XMLHttpRequest', /\bXMLHttpRequest\b/],
    ['EventSource', /\bEventSource\b/],
    ['sendBeacon', /\bsendBeacon\s*\(/],
    ['react import', /from\s+['"]react['"]/],
    ['react-dom import', /from\s+['"]react-dom['"]/],
    ['tauri import', /@tauri-apps\//],
    ['scene-cue-projection', /scene-cue-projection/],
    ['dramaturgy ambient', /packages\/dramaturgy|@offisim\/dramaturgy/],
  ];

  for (const [label, pattern] of forbiddenPatterns) {
    check(`selector/copy free of ${label}`, !pattern.test(codeOnly));
  }
  check(
    'selector reuses hashStringToInt from scene-hash',
    /from\s+['"]\.\/r3d\/scene-hash\.js['"]/.test(selector) && /\bhashStringToInt\b/.test(selector),
  );
  check(
    'timing constants are documented positive integers',
    [
      CHATTER_TIME_BUCKET_MS,
      CHATTER_GLOBAL_COOLDOWN_MS,
      CHATTER_ACTOR_COOLDOWN_MS,
      CHATTER_PAIR_COOLDOWN_MS,
      CHATTER_MAX_VISIBLE_DEFAULT,
    ].every((n) => Number.isInteger(n) && n > 0),
  );
}

// Presentation shape smoke for integration readiness
section('[presentation] integration shape');
{
  const result = mustChatter(
    selectLocalChatter(baseInput({ actors: [actor('ava')], seed: 'shape', locale: 'en' })),
    'shape',
  );
  const p = result.presentation;
  check('stable id present', typeof p.id === 'string' && p.id.startsWith('chatter:'));
  check('priority marker', p.priority === 'local-chatter');
  check('timing metadata', typeof p.startAtMs === 'number' && typeof p.holdMs === 'number');
  check(
    'utterance fields',
    p.utterances.every(
      (u) =>
        typeof u.actorId === 'string' &&
        typeof u.copyKey === 'string' &&
        typeof u.text === 'string' &&
        u.text.length > 0,
    ),
  );
}

h.report();
