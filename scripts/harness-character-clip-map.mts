import { readFileSync } from 'node:fs';
import type {
  CharacterPerformanceState,
  Expression,
  Locomotion,
  Posture,
  Prop,
  SocialGesture,
  WorkGesture,
} from '@offisim/shared-types';
import {
  CLIP_META,
  CLIP_NAMES,
  POSTURE_TRANSITION_CLIPS,
  clipForPerformance,
  idleClipForPosture,
} from '../apps/desktop/renderer/src/surfaces/office/scene/character/clip-map.js';

/**
 * Clip-map gate (production-work-dramaturgy I6).
 *
 * Locks the GltfCharacter animation contract:
 *  - totality: every CharacterPerformanceState in the full semantic space
 *    (locomotion × posture × workGesture × socialGesture × expression × prop ×
 *    intensity — unions enumerated exhaustively, compiler-enforced) yields a
 *    defined selection whose clip exists in CLIP_NAMES;
 *  - determinism: identical inputs give identical selections;
 *  - manifest sync: CLIP_NAMES matches exactly the clip set emitted into
 *    animations.glb by scripts/build-character-assets.mjs (manifest.json);
 *  - semantic anchors: the documented proxy choices stay pinned.
 */

let failures = 0;
function check(condition: boolean, message: string): void {
  if (condition) return;
  failures += 1;
  console.error(`FAIL: ${message}`);
}

/** Compile-time exhaustive union enumeration: Record<Union, true> → keys. */
function keysOf<T extends string>(record: Record<T, true>): T[] {
  return Object.keys(record) as T[];
}

const LOCOMOTIONS = keysOf<Locomotion>({ idle: true, walk: true });
const POSTURES = keysOf<Posture>({ stand: true, sit: true });
const WORK_GESTURES = keysOf<WorkGesture>({
  none: true,
  type: true,
  read: true,
  note: true,
  'inspect-terminal': true,
  'write-board': true,
  point: true,
  annotate: true,
  handoff: true,
});
const SOCIAL_GESTURES = keysOf<SocialGesture>({
  none: true,
  listen: true,
  nod: true,
  discuss: true,
});
const EXPRESSIONS = keysOf<Expression>({
  neutral: true,
  focus: true,
  thinking: true,
  worried: true,
  happy: true,
});
const PROPS: (Prop | undefined)[] = [
  undefined,
  ...keysOf<Prop>({ laptop: true, document: true, tablet: true, terminal: true, pointer: true }),
];
const INTENSITIES: CharacterPerformanceState['intensity'][] = [0, 1, 2];

const clipNameSet = new Set<string>(CLIP_NAMES);

// 1. Manifest sync — CLIP_NAMES must equal the emitted animations.glb clip set.
const manifestUrl = new URL(
  '../apps/desktop/renderer/src/assets/characters/manifest.json',
  import.meta.url,
);
const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8')) as { clips: string[] };
const manifestClips = [...manifest.clips].sort();
const declaredClips = [...CLIP_NAMES].sort();
check(
  JSON.stringify(manifestClips) === JSON.stringify(declaredClips),
  `CLIP_NAMES/manifest drift\n  clip-map: ${declaredClips.join(', ')}\n  manifest: ${manifestClips.join(', ')}`,
);

// 2. CLIP_META totality (the Record type enforces it; lock it at runtime too).
for (const clip of CLIP_NAMES) {
  const meta = CLIP_META[clip];
  check(meta !== undefined, `CLIP_META missing '${clip}'`);
  check(typeof meta.loop === 'boolean' && meta.fade > 0, `CLIP_META['${clip}'] invalid`);
}

// 3. Totality + determinism over the full semantic space.
let states = 0;
for (const locomotion of LOCOMOTIONS) {
  for (const posture of POSTURES) {
    for (const workGesture of WORK_GESTURES) {
      for (const socialGesture of SOCIAL_GESTURES) {
        for (const expression of EXPRESSIONS) {
          for (const prop of PROPS) {
            for (const intensity of INTENSITIES) {
              const perf: CharacterPerformanceState = {
                locomotion,
                posture,
                workGesture,
                socialGesture,
                expression,
                ...(prop === undefined ? {} : { prop }),
                intensity,
              };
              states += 1;
              const first = clipForPerformance(perf);
              if (
                first === undefined ||
                !clipNameSet.has(first.clip) ||
                typeof first.loop !== 'boolean' ||
                !(first.fade > 0)
              ) {
                check(
                  false,
                  `non-total selection for ${JSON.stringify(perf)} → ${JSON.stringify(first)}`,
                );
                continue;
              }
              const second = clipForPerformance(perf);
              check(
                JSON.stringify(first) === JSON.stringify(second),
                `non-deterministic selection for ${JSON.stringify(perf)}`,
              );
            }
          }
        }
      }
    }
  }
}
// 2 locomotion × 2 posture × 9 work × 4 social × 5 expression × 6 prop × 3 intensity.
check(states === 12960, `expected 12960 enumerated states, saw ${states}`);

// 4. Posture idles + transitions resolve against the shipped clip set.
for (const posture of POSTURES) {
  check(clipNameSet.has(idleClipForPosture(posture).clip), `idle clip missing for '${posture}'`);
}
for (const clip of Object.values(POSTURE_TRANSITION_CLIPS)) {
  check(clipNameSet.has(clip), `transition clip '${clip}' missing from CLIP_NAMES`);
}

// 5. Semantic anchors (documented proxy decisions must not silently drift).
const anchor = (
  overrides: Partial<CharacterPerformanceState>,
  expected: string,
  label: string,
): void => {
  const perf: CharacterPerformanceState = {
    locomotion: 'idle',
    posture: 'stand',
    workGesture: 'none',
    socialGesture: 'none',
    expression: 'neutral',
    intensity: 1,
    ...overrides,
  };
  const got = clipForPerformance(perf).clip;
  check(got === expected, `${label}: expected '${expected}', got '${got}'`);
};
anchor({ locomotion: 'walk', prop: 'laptop' }, 'carry', 'walk+laptop carries');
anchor({ locomotion: 'walk', intensity: 2 }, 'walk.formal', 'urgent walk is formal');
anchor({ posture: 'sit', workGesture: 'type', prop: 'laptop' }, 'sit.talk', 'seated typing proxy');
anchor({ workGesture: 'read', prop: 'document' }, 'inspect.open', 'standing read proxy');
anchor({ expression: 'worried' }, 'wait.foldarms', 'worried folds arms');
anchor({ expression: 'worried', intensity: 2 }, 'blocked.headshake', 'blocked shakes head');
anchor(
  { workGesture: 'point', expression: 'happy', intensity: 2 },
  'celebrate.dance',
  'peak completion dances',
);
anchor({ workGesture: 'handoff', prop: 'document' }, 'pickup', 'handoff picks up');
anchor({ posture: 'sit' }, 'sit.idle', 'seated rest idles');

if (failures > 0) {
  console.error(`\nharness-character-clip-map: ${failures} failure(s)`);
  process.exit(1);
}
console.log(
  `PASS harness-character-clip-map — ${states} states total+deterministic, ${CLIP_NAMES.length} clips in sync with manifest`,
);
