/**
 * Office local-chatter 3D integration gate.
 *
 * Drives the injected-clock state machine with a manual timer queue and locks
 * pure projection/suppression helpers plus React/scene source boundaries. No
 * browser DOM, model, network, or persistence.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AmbientActorDirection } from '@offisim/shared-types';
import {
  type LocalChatterClock,
  type LocalChatterMachineInput,
  createLocalChatterMachine,
} from '../apps/desktop/renderer/src/surfaces/office/scene/local-chatter-machine.js';
import {
  CHATTER_MAX_VISIBLE_DEFAULT,
  type LocalChatterActor,
  type LocalChatterResult,
  emptyLocalChatterHistory,
  selectLocalChatter,
} from '../apps/desktop/renderer/src/surfaces/office/scene/local-chatter.js';
import {
  LOCAL_CHATTER_FIRST_ATTEMPT_MS,
  LOCAL_CHATTER_RETRY_MS,
  type LocalChatterFrameActor,
  type LocalChatterFrameSlice,
  type LocalChatterPresentation,
  deriveLocalChatterActors,
  deriveRuntimeTruthActive,
  deriveStatusExplanationActive,
  localChatterActorAcceptsIdle,
  localChatterLifecycleScope,
  localChatterPresentationEndAtMs,
  localChatterSeed,
  nextLocalChatterBoundaryMs,
  presentationSpeakersEligible,
  projectLocalChatterAt,
  resolveRawChatterLocale,
  visibleBubblesFromPresentation,
} from '../apps/desktop/renderer/src/surfaces/office/scene/use-local-chatter.js';
import { createHarness } from './lib/harness-runner.mjs';

const h = createHarness('office-local-chatter-integration gate');
const { check, section } = h;

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HOOK_SRC = `${ROOT}/apps/desktop/renderer/src/surfaces/office/scene/use-local-chatter.ts`;
const MACHINE_SRC = `${ROOT}/apps/desktop/renderer/src/surfaces/office/scene/local-chatter-machine.ts`;
const SCENE3D_SRC = `${ROOT}/apps/desktop/renderer/src/surfaces/office/scene/OfficeScene3D.tsx`;
const SCENE2D_SRC = `${ROOT}/apps/desktop/renderer/src/surfaces/office/scene/OfficeScene2D.tsx`;
const CUE_REACT_SRC = `${ROOT}/apps/desktop/renderer/src/assistant/runtime/scene-cue-react.ts`;
const CUE_PROJ_SRC = `${ROOT}/apps/desktop/renderer/src/assistant/runtime/scene-cue-projection.ts`;
const ANNOTATION_SRC = `${ROOT}/apps/desktop/renderer/src/surfaces/office/scene/r3d/SceneAnnotation.tsx`;
const CSS_SRC = `${ROOT}/apps/desktop/renderer/src/surfaces/office/office.css`;
const FOUNDATION_SRC = `${ROOT}/apps/desktop/renderer/src/surfaces/office/scene/local-chatter.ts`;
const FOUNDATION_COPY_SRC = `${ROOT}/apps/desktop/renderer/src/surfaces/office/scene/local-chatter-copy.ts`;

function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function actorCue(
  employeeId: string,
  over: Partial<LocalChatterFrameActor> = {},
): LocalChatterFrameActor {
  return {
    employeeId,
    selected: over.selected ?? false,
    hovered: over.hovered ?? false,
    dragging: over.dragging ?? false,
    status: over.status ?? 'idle',
    delivering: over.delivering ?? false,
    running: over.running ?? false,
    performance: over.performance ?? null,
    staging: over.staging ?? null,
  };
}

function frameOf(
  actors: readonly LocalChatterFrameActor[],
  over: Partial<LocalChatterFrameSlice> = {},
): LocalChatterFrameSlice {
  return {
    actors,
    flows: over.flows ?? [],
    delivery: over.delivery ?? {
      latest: null,
      recentCount: 0,
    },
    attention: over.attention ?? null,
  };
}

function ambientDirection(
  employeeId: string,
  partnerId: string | null,
  over: Partial<AmbientActorDirection> = {},
): AmbientActorDirection {
  return {
    employeeId,
    routine: over.routine ?? 'break',
    phase: over.phase ?? 'dwell',
    away: over.away ?? true,
    partnerId,
    performance: over.performance ?? {
      locomotion: 'idle',
      posture: 'sit',
      workGesture: 'none',
      socialGesture: 'listen',
      expression: 'happy',
      intensity: 0,
      variant: 0,
    },
    staging: over.staging ?? null,
  };
}

function mustChatter(result: LocalChatterResult, label: string): LocalChatterPresentation {
  check(label, result.status === 'chatter', JSON.stringify(result));
  if (result.status === 'chatter') return result.presentation;
  throw new Error(`expected chatter for ${label}`);
}

class VirtualChatterClock implements LocalChatterClock<number> {
  private nextId = 1;
  private runCount = 0;
  private readonly timers = new Map<
    number,
    { readonly atMs: number; readonly callback: () => void }
  >();

  constructor(private currentMs: number) {}

  now = (): number => this.currentMs;

  setTimeout = (callback: () => void, delayMs: number): number => {
    const id = this.nextId++;
    this.timers.set(id, {
      atMs: this.currentMs + Math.max(0, delayMs),
      callback,
    });
    return id;
  };

  clearTimeout = (id: number): void => {
    this.timers.delete(id);
  };

  advanceBy(deltaMs: number): void {
    const targetMs = this.currentMs + deltaMs;
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.atMs <= targetMs)
        .sort(([leftId, left], [rightId, right]) => left.atMs - right.atMs || leftId - rightId)[0];
      if (!next) break;
      const [id, timer] = next;
      this.timers.delete(id);
      this.currentMs = timer.atMs;
      this.runCount += 1;
      timer.callback();
    }
    this.currentMs = targetMs;
  }

  pendingCount(): number {
    return this.timers.size;
  }

  callbacksRun(): number {
    return this.runCount;
  }

  nextDueAtMs(): number | null {
    const dueTimes = [...this.timers.values()].map((timer) => timer.atMs);
    return dueTimes.length === 0 ? null : Math.min(...dueTimes);
  }
}

function machineInput(
  scopeKey: string,
  actors: readonly LocalChatterActor[],
  over: Partial<LocalChatterMachineInput> = {},
): LocalChatterMachineInput {
  return {
    enabled: over.enabled ?? true,
    scopeKey,
    locale: over.locale ?? 'en',
    reducedMotion: over.reducedMotion ?? false,
    runtimeTruthActive: over.runtimeTruthActive ?? false,
    statusExplanationActive: over.statusExplanationActive ?? false,
    actors,
    frameActorIds: over.frameActorIds ?? new Set(actors.map((actor) => actor.actorId)),
  };
}

// ── State-machine behavior ──────────────────────────────────────────────────

section('[machine] attempt through complete pair timeline');
{
  const startMs = 5_000_000;
  const clock = new VirtualChatterClock(startMs);
  const actors: readonly LocalChatterActor[] = [
    { actorId: 'ava', presentationState: 'idle', safeVisualWindow: true },
    { actorId: 'ben', presentationState: 'idle', safeVisualWindow: true },
  ];
  const machine = createLocalChatterMachine({ clock });
  machine.update(machineInput('co::timeline', actors));

  check(
    'machine schedules first attempt at 1750ms',
    clock.pendingCount() === 1 && clock.nextDueAtMs() === startMs + LOCAL_CHATTER_FIRST_ATTEMPT_MS,
  );
  clock.advanceBy(LOCAL_CHATTER_FIRST_ATTEMPT_MS - 1);
  check(
    'machine stays empty before first attempt',
    machine.getSnapshot().activePresentation == null,
  );

  clock.advanceBy(1);
  const presentation = machine.getSnapshot().activePresentation;
  check(
    'machine attempt starts pair presentation',
    presentation?.kind === 'pair-dialogue' &&
      visibleBubblesFromPresentation(presentation, machine.getSnapshot().clockMs).size === 1,
  );
  if (!presentation || presentation.kind !== 'pair-dialogue') {
    throw new Error('expected pair presentation from machine timeline');
  }
  const firstActorId = presentation.utterances[0]?.actorId;
  const secondActorId = presentation.utterances[1]?.actorId;

  clock.advanceBy(presentation.holdMs);
  check(
    'machine advances to pair gap boundary',
    visibleBubblesFromPresentation(
      machine.getSnapshot().activePresentation,
      machine.getSnapshot().clockMs,
    ).size === 0,
  );
  clock.advanceBy(presentation.utteranceGapMs);
  check(
    'machine advances from first to second utterance',
    firstActorId !== secondActorId &&
      visibleBubblesFromPresentation(
        machine.getSnapshot().activePresentation,
        machine.getSnapshot().clockMs,
      ).get(secondActorId ?? '')?.actorId === secondActorId,
  );
  clock.advanceBy(presentation.holdMs);
  check(
    'machine clears bubbles at presentation end',
    machine.getSnapshot().activePresentation == null &&
      visibleBubblesFromPresentation(
        machine.getSnapshot().activePresentation,
        machine.getSnapshot().clockMs,
      ).size === 0,
  );
  machine.dispose();
}

section('[machine] retry scheduling');
{
  const startMs = 5_100_000;
  const clock = new VirtualChatterClock(startMs);
  const busyActors: readonly LocalChatterActor[] = [
    { actorId: 'ava', presentationState: 'busy', safeVisualWindow: true },
  ];
  const eligibleActors: readonly LocalChatterActor[] = [
    { actorId: 'ava', presentationState: 'idle', safeVisualWindow: true },
  ];
  const machine = createLocalChatterMachine({ clock });
  machine.update(machineInput('co::retry', busyActors));
  clock.advanceBy(LOCAL_CHATTER_FIRST_ATTEMPT_MS);
  check(
    'machine schedules 4000ms retry after suppressed attempt',
    machine.getSnapshot().activePresentation == null &&
      clock.nextDueAtMs() === startMs + LOCAL_CHATTER_FIRST_ATTEMPT_MS + LOCAL_CHATTER_RETRY_MS,
  );
  machine.update(machineInput('co::retry', eligibleActors));
  clock.advanceBy(LOCAL_CHATTER_RETRY_MS);
  check(
    'machine retry uses latest eligible actors',
    machine.getSnapshot().activePresentation != null,
  );
  machine.dispose();
}

section('[machine] suppression and speaker preemption');
{
  const eligibleActors: readonly LocalChatterActor[] = [
    { actorId: 'ava', presentationState: 'idle', safeVisualWindow: true },
    { actorId: 'ben', presentationState: 'idle', safeVisualWindow: true },
  ];
  const suppressions: readonly [string, Partial<LocalChatterMachineInput>][] = [
    ['runtime truth', { runtimeTruthActive: true }],
    ['status explanation', { statusExplanationActive: true }],
    ['disabled', { enabled: false }],
  ];
  for (const [label, suppression] of suppressions) {
    const clock = new VirtualChatterClock(5_200_000);
    const machine = createLocalChatterMachine({ clock });
    machine.update(machineInput(`co::preempt-${label}`, eligibleActors));
    clock.advanceBy(LOCAL_CHATTER_FIRST_ATTEMPT_MS);
    machine.update(machineInput(`co::preempt-${label}`, eligibleActors, suppression));
    check(
      `machine ${label} preempts active presentation immediately`,
      machine.getSnapshot().activePresentation == null && clock.pendingCount() === 0,
    );
    machine.dispose();
  }

  const clock = new VirtualChatterClock(5_300_000);
  const machine = createLocalChatterMachine({ clock });
  machine.update(machineInput('co::speaker-preempt', eligibleActors));
  clock.advanceBy(LOCAL_CHATTER_FIRST_ATTEMPT_MS);
  const ineligibleActors = eligibleActors.map((actor, index) => ({
    ...actor,
    safeVisualWindow: index !== 0,
  }));
  machine.update(machineInput('co::speaker-preempt', ineligibleActors));
  check(
    'machine speaker ineligibility preempts active presentation',
    machine.getSnapshot().activePresentation == null &&
      clock.nextDueAtMs() === clock.now() + LOCAL_CHATTER_FIRST_ATTEMPT_MS,
  );
  machine.dispose();
}

section('[machine] scope reset');
{
  const clock = new VirtualChatterClock(5_400_000);
  const actors: readonly LocalChatterActor[] = [
    { actorId: 'ava', presentationState: 'idle', safeVisualWindow: true },
  ];
  const machine = createLocalChatterMachine({ clock });
  machine.update(machineInput('co::scope-a', actors));
  clock.advanceBy(LOCAL_CHATTER_FIRST_ATTEMPT_MS);
  check(
    'machine history records completed attempt before scope reset',
    machine.getSnapshot().history.lastGlobalAtMs === clock.now(),
  );
  machine.update(machineInput('co::scope-b', actors));
  const reset = machine.getSnapshot();
  check(
    'machine scope change clears active presentation and clock',
    reset.scopeKey === 'co::scope-b' && reset.activePresentation == null && reset.clockMs === 0,
  );
  check(
    'machine scope change resets all chatter history',
    reset.history.lastGlobalAtMs == null &&
      Object.keys(reset.history.lastActorAtMs).length === 0 &&
      Object.keys(reset.history.perPair).length === 0 &&
      reset.history.recentCopyKeys.length === 0,
  );
  check(
    'machine scope change replaces old timer with fresh first attempt',
    clock.pendingCount() === 1 &&
      clock.nextDueAtMs() === clock.now() + LOCAL_CHATTER_FIRST_ATTEMPT_MS,
  );
  machine.dispose();
}

section('[machine] dispose cleanup');
{
  const clock = new VirtualChatterClock(5_500_000);
  const actors: readonly LocalChatterActor[] = [
    { actorId: 'ava', presentationState: 'idle', safeVisualWindow: true },
    { actorId: 'ben', presentationState: 'idle', safeVisualWindow: true },
  ];
  const machine = createLocalChatterMachine({ clock });
  machine.update(machineInput('co::dispose', actors));
  clock.advanceBy(LOCAL_CHATTER_FIRST_ATTEMPT_MS);
  const callbacksBeforeDispose = clock.callbacksRun();
  check(
    'machine has owned presentation timer before dispose',
    machine.getSnapshot().activePresentation != null && clock.pendingCount() === 1,
  );
  machine.dispose();
  check(
    'machine dispose empties timer queue and active presentation',
    clock.pendingCount() === 0 && machine.getSnapshot().activePresentation == null,
  );
  clock.advanceBy(60_000);
  check(
    'machine dispose leaves no residual callbacks',
    clock.callbacksRun() === callbacksBeforeDispose && clock.pendingCount() === 0,
  );
}

// ── Scope / locale / attempt constants ──────────────────────────────────────

section('[scope] seed and locale');
check(
  'lifecycle scope uses project when present',
  localChatterLifecycleScope('co-1', 'proj-9') === 'co-1::proj-9',
);
check(
  'lifecycle scope falls back project→company',
  localChatterLifecycleScope('co-1', null) === 'co-1::co-1',
);
check(
  'seed matches lifecycle scope',
  localChatterSeed('co-1', 'proj-9') === localChatterLifecycleScope('co-1', 'proj-9'),
);
check('raw locale passthrough', resolveRawChatterLocale('zh-Hans') === 'zh-Hans');
check('empty locale → en', resolveRawChatterLocale('') === 'en');
check('nullish locale → en', resolveRawChatterLocale(undefined) === 'en');
check(
  'first attempt is between 1.5s and 2s',
  LOCAL_CHATTER_FIRST_ATTEMPT_MS >= 1_500 && LOCAL_CHATTER_FIRST_ATTEMPT_MS <= 2_000,
  String(LOCAL_CHATTER_FIRST_ATTEMPT_MS),
);
check('retry spacing is ~4s', LOCAL_CHATTER_RETRY_MS === 4_000);
check('maxVisible default remains 2', CHATTER_MAX_VISIBLE_DEFAULT === 2);

// ── Eligibility ─────────────────────────────────────────────────────────────

section('[eligibility] ambient / idle / busy / safe window');
{
  const ambientIds = new Set(['ava', 'ben']);
  const actors = deriveLocalChatterActors(
    frameOf([
      actorCue('ava', {
        performance: { kind: 'ambient' },
        staging: { anchorId: 'rest-a' },
      }),
      actorCue('ben', {
        performance: { kind: 'ambient' },
        staging: { anchorId: 'rest-b' },
      }),
      actorCue('cy'),
      actorCue('dia', { status: 'working', running: true }),
      actorCue('eli', { selected: true }),
    ]),
    ambientIds,
    [
      ambientDirection('ava', 'ben'),
      ambientDirection('ben', 'ava'),
      ambientDirection('cy', null, { routine: 'refreshment' }),
    ],
  );
  const byId = new Map(actors.map((a) => [a.actorId, a]));
  check(
    'ambient actor with ambient performance stays ambient',
    byId.get('ava')?.presentationState === 'ambient',
  );
  check('non-ambient idle stays idle', byId.get('cy')?.presentationState === 'idle');
  check('running actor is working', byId.get('dia')?.presentationState === 'working');
  check('selected actor loses safe visual window', byId.get('eli')?.safeVisualWindow === false);
  check('unselected idle keeps safe visual window', byId.get('cy')?.safeVisualWindow === true);
  check(
    'reciprocal paired break dwell actors share the canonical pairHint',
    byId.get('ava')?.pairHint === 'ava|ben' && byId.get('ben')?.pairHint === 'ava|ben',
  );
  check('non-break ambient actor has null pairHint', byId.get('cy')?.pairHint === null);
  check(
    'local idle predicate matches actorAcceptsAmbientCue shape',
    localChatterActorAcceptsIdle(actorCue('cy')) &&
      !localChatterActorAcceptsIdle(actorCue('ava', { performance: { kind: 'x' } })) &&
      !localChatterActorAcceptsIdle(actorCue('ava', { running: true })),
  );

  const outbound = deriveLocalChatterActors(
    frameOf([actorCue('ava'), actorCue('ben')]),
    ambientIds,
    [
      ambientDirection('ava', 'ben', { phase: 'outbound' }),
      ambientDirection('ben', 'ava', { phase: 'outbound' }),
    ],
  );
  check(
    'paired break outside dwell has null pairHint',
    outbound.every((actor) => actor.pairHint === null),
    JSON.stringify(outbound),
  );

  const oneSided = deriveLocalChatterActors(
    frameOf([actorCue('ava'), actorCue('ben')]),
    ambientIds,
    [ambientDirection('ava', 'ben')],
  );
  check(
    'incomplete direction pair fails closed to null pairHint',
    oneSided.every((actor) => actor.pairHint === null),
    JSON.stringify(oneSided),
  );
}

// ── Suppression ─────────────────────────────────────────────────────────────

section('[suppress] status explanation and runtime truth');
{
  check(
    'blocked/approval → status explanation',
    deriveStatusExplanationActive(frameOf([actorCue('ava', { status: 'blocked' })])),
  );
  check(
    'idle-only frame has no status explanation',
    !deriveStatusExplanationActive(frameOf([actorCue('ava'), actorCue('ben')])),
  );

  const ambientIds = new Set(['ava']);
  check(
    'attention is runtime truth',
    deriveRuntimeTruthActive(
      frameOf([actorCue('ava')], { attention: { target: 'employee' } }),
      ambientIds,
    ),
  );
  check(
    'flows are runtime truth',
    deriveRuntimeTruthActive(frameOf([actorCue('ava')], { flows: [{ id: 'f1' }] }), ambientIds),
  );
  check(
    'recent delivery is runtime truth',
    deriveRuntimeTruthActive(
      frameOf([actorCue('ava')], {
        delivery: { latest: null, recentCount: 1 },
      }),
      ambientIds,
    ),
  );
  check(
    'running actor is runtime truth',
    deriveRuntimeTruthActive(frameOf([actorCue('ava', { running: true })]), ambientIds),
  );
  check(
    'working status is runtime truth',
    deriveRuntimeTruthActive(frameOf([actorCue('ava', { status: 'working' })]), ambientIds),
  );
  check(
    'non-ambient performance is runtime truth',
    deriveRuntimeTruthActive(
      frameOf([actorCue('cy', { performance: { kind: 'talk' } })]),
      ambientIds,
    ),
  );
  check(
    'ambient performance/staging is NOT runtime truth',
    !deriveRuntimeTruthActive(
      frameOf([
        actorCue('ava', {
          performance: { kind: 'talk' },
          staging: { anchorId: 'rest-a' },
        }),
      ]),
      ambientIds,
    ),
  );
  check(
    'quiet idle frame is not runtime truth',
    !deriveRuntimeTruthActive(frameOf([actorCue('ava'), actorCue('ben')]), new Set()),
  );
}

// ── Timeline projection (no fake timers) ────────────────────────────────────

section('[timeline] solo and pair boundaries');
{
  const solo = mustChatter(
    selectLocalChatter({
      nowMs: 1_000_000,
      seed: 'timeline-solo',
      locale: 'en',
      reducedMotion: false,
      runtimeTruthActive: false,
      statusExplanationActive: false,
      activeChatterCount: 0,
      maxVisible: CHATTER_MAX_VISIBLE_DEFAULT,
      actors: [{ actorId: 'ava', presentationState: 'idle', safeVisualWindow: true }],
      history: emptyLocalChatterHistory(),
    }),
    'solo presentation',
  );
  const soloStart = solo.startAtMs;
  const soloHold = solo.holdMs;
  check('solo visible at start', projectLocalChatterAt(solo, soloStart)?.actorId === 'ava');
  check(
    'solo visible at hold-1ms',
    projectLocalChatterAt(solo, soloStart + soloHold - 1)?.actorId === 'ava',
  );
  check(
    'solo hidden at exact hold boundary',
    projectLocalChatterAt(solo, soloStart + soloHold) == null,
  );
  check('solo endAt matches hold', localChatterPresentationEndAtMs(solo) === soloStart + soloHold);

  const pair = mustChatter(
    selectLocalChatter({
      nowMs: 2_000_000,
      seed: 'timeline-pair',
      locale: 'zh-Hans',
      reducedMotion: true,
      runtimeTruthActive: false,
      statusExplanationActive: false,
      activeChatterCount: 0,
      maxVisible: CHATTER_MAX_VISIBLE_DEFAULT,
      actors: [
        { actorId: 'ava', presentationState: 'ambient', safeVisualWindow: true },
        { actorId: 'ben', presentationState: 'ambient', safeVisualWindow: true },
      ],
      history: emptyLocalChatterHistory(),
    }),
    'pair presentation',
  );
  check('locale passthrough to foundation', pair.locale === 'zh-CN');
  check('reducedMotion → static', pair.motion === 'static');
  check('pair has two utterances', pair.utterances.length === 2);

  const start = pair.startAtMs;
  const hold = pair.holdMs;
  const gap = pair.utteranceGapMs;
  const firstEnd = start + hold;
  const secondStart = firstEnd + gap;
  const secondEnd = secondStart + hold;
  const turnA = pair.utterances[0]?.actorId;
  const turnB = pair.utterances[1]?.actorId;

  check('turn A at start', projectLocalChatterAt(pair, start)?.actorId === turnA);
  check('turn A at hold-1ms', projectLocalChatterAt(pair, firstEnd - 1)?.actorId === turnA);
  check('gap at exact first boundary', projectLocalChatterAt(pair, firstEnd) == null);
  check('gap mid-window', projectLocalChatterAt(pair, firstEnd + Math.floor(gap / 2)) == null);
  check(
    'turn B at exact second start',
    projectLocalChatterAt(pair, secondStart)?.actorId === turnB,
  );
  check('turn B at end-1ms', projectLocalChatterAt(pair, secondEnd - 1)?.actorId === turnB);
  check('ended at exact second end', projectLocalChatterAt(pair, secondEnd) == null);

  let overlap = false;
  let exceededVisibleCap = false;
  for (let t = start; t <= secondEnd; t += 25) {
    const bubble = projectLocalChatterAt(pair, t);
    const map = visibleBubblesFromPresentation(pair, t);
    if (map.size > 1) overlap = true;
    if (map.size > CHATTER_MAX_VISIBLE_DEFAULT) exceededVisibleCap = true;
    if (bubble && map.size !== 1) overlap = true;
  }
  check('pair turns never overlap across sampled timeline', !overlap);
  check('single-presentation projection never exceeds maxVisible cap', !exceededVisibleCap);

  check(
    'next boundary after start is first end',
    nextLocalChatterBoundaryMs(pair, start) === firstEnd,
  );
  check(
    'next boundary in gap is second start',
    nextLocalChatterBoundaryMs(pair, firstEnd) === secondStart,
  );
  check(
    'next boundary during turn B is end',
    nextLocalChatterBoundaryMs(pair, secondStart) === secondEnd,
  );
  check('next boundary after end is null', nextLocalChatterBoundaryMs(pair, secondEnd) == null);
}

// ── Preemption / speaker eligibility ────────────────────────────────────────

section('[preempt] speaker eligibility');
{
  const presentation = mustChatter(
    selectLocalChatter({
      nowMs: 3_000_000,
      seed: 'preempt',
      locale: 'en',
      reducedMotion: false,
      runtimeTruthActive: false,
      statusExplanationActive: false,
      activeChatterCount: 0,
      maxVisible: CHATTER_MAX_VISIBLE_DEFAULT,
      actors: [
        { actorId: 'ava', presentationState: 'idle', safeVisualWindow: true },
        { actorId: 'ben', presentationState: 'idle', safeVisualWindow: true },
      ],
      history: emptyLocalChatterHistory(),
    }),
    'preempt presentation',
  );
  const frameIds = new Set(presentation.actorIds);
  check(
    'speakers eligible when idle + safe',
    presentationSpeakersEligible(
      presentation,
      presentation.actorIds.map((id) => ({
        actorId: id,
        presentationState: 'idle' as const,
        safeVisualWindow: true,
      })),
      frameIds,
    ),
  );
  check(
    'speaker busy → ineligible',
    !presentationSpeakersEligible(
      presentation,
      presentation.actorIds.map((id, index) => ({
        actorId: id,
        presentationState: index === 0 ? ('busy' as const) : ('idle' as const),
        safeVisualWindow: true,
      })),
      frameIds,
    ),
  );
  check(
    'speaker disappeared → ineligible',
    !presentationSpeakersEligible(
      presentation,
      presentation.actorIds.map((id) => ({
        actorId: id,
        presentationState: 'idle' as const,
        safeVisualWindow: true,
      })),
      new Set([presentation.actorIds[0] ?? '']),
    ),
  );
  check(
    'unsafe visual window → ineligible',
    !presentationSpeakersEligible(
      presentation,
      presentation.actorIds.map((id) => ({
        actorId: id,
        presentationState: 'ambient' as const,
        safeVisualWindow: false,
      })),
      frameIds,
    ),
  );
}

// ── maxVisible input ────────────────────────────────────────────────────────

section('[budget] maxVisible input');
const budgetResult = selectLocalChatter({
  nowMs: 4_000_000,
  seed: 'budget',
  locale: 'en',
  reducedMotion: false,
  runtimeTruthActive: false,
  statusExplanationActive: false,
  activeChatterCount: CHATTER_MAX_VISIBLE_DEFAULT,
  maxVisible: CHATTER_MAX_VISIBLE_DEFAULT,
  actors: [{ actorId: 'ava', presentationState: 'idle', safeVisualWindow: true }],
  history: emptyLocalChatterHistory(),
});
check(
  'activeChatterCount at maxVisible suppresses',
  budgetResult.status === 'suppressed' && budgetResult.reason === 'max-visible',
);

// ── Source boundaries ───────────────────────────────────────────────────────

section('[boundary] integration source contracts');
{
  const hook = readFileSync(HOOK_SRC, 'utf8');
  const machine = readFileSync(MACHINE_SRC, 'utf8');
  const scene3d = readFileSync(SCENE3D_SRC, 'utf8');
  const scene2d = readFileSync(SCENE2D_SRC, 'utf8');
  const cueReact = readFileSync(CUE_REACT_SRC, 'utf8');
  const cueProj = readFileSync(CUE_PROJ_SRC, 'utf8');
  const annotation = readFileSync(ANNOTATION_SRC, 'utf8');
  const css = readFileSync(CSS_SRC, 'utf8');
  const foundation = readFileSync(FOUNDATION_SRC, 'utf8');
  const foundationCopy = readFileSync(FOUNDATION_COPY_SRC, 'utf8');

  const hookCode = codeOnly(hook);
  const machineCode = codeOnly(machine);
  const cueCode = codeOnly(cueReact);
  const scene2dCode = codeOnly(scene2d);

  check(
    'scene-cue-react has exactly one ambient directions subscription',
    (cueCode.match(/useOfficeAmbientDirections\s*\(/g) ?? []).length === 1,
  );
  check(
    'scene-cue-react returns ambientActorIds from visibleAmbientDirections',
    /ambientActorIds/.test(cueReact) && /visibleAmbientDirections/.test(cueReact),
  );
  check(
    'scene-cue-react returns the same visible directions to OfficeScene3D chatter',
    /ambientDirections:\s*visibleAmbientDirections/.test(cueReact) &&
      /\bambientDirections\b/.test(scene3d) &&
      /\bambientDirections\b/.test(hook),
  );
  check(
    'only OfficeScene3D consumes useLocalChatter',
    /useLocalChatter/.test(scene3d) &&
      !/useLocalChatter/.test(scene2d) &&
      !/useLocalChatter/.test(cueReact),
  );
  check(
    'OfficeScene2D has no chatter changes',
    !/chatter|use-local-chatter|data-scene-chatter|off-scene-chatter/.test(scene2dCode),
  );
  check(
    'SceneAnnotation source unchanged by chatter (no chatter tokens)',
    !/chatter|local-chatter/.test(codeOnly(annotation)),
  );
  check(
    'machine cleanup uses clearTimeout',
    /\bclearTimeout\b/.test(machineCode) && !/\bsetInterval\b/.test(machineCode),
  );
  check(
    'scope change render fails closed before effect reset',
    /machineSnapshot\?\.scopeKey\s*!==\s*scopeKey\s*\|\|\s*suppressed/.test(hookCode),
  );
  check(
    'render projection has deterministic clock fallback',
    /machineSnapshot\.clockMs\s*>\s*0[\s\S]*?\?\s*machineSnapshot\.clockMs[\s\S]*?:\s*activePresentation\.startAtMs/.test(
      hookCode,
    ),
  );
  check('machine uses one-shot setTimeout scheduling', /\bsetTimeout\b/.test(machineCode));
  check(
    'hook only adapts Date.now and window timers into machine clock',
    /createLocalChatterMachine/.test(hookCode) &&
      /\bDate\.now\s*\(/.test(hookCode) &&
      /\bwindow\.setTimeout\s*\(/.test(hookCode) &&
      /\bwindow\.clearTimeout\s*\(/.test(hookCode),
  );
  check(
    'machine has no browser or wall-clock dependency',
    !/\bwindow\b/.test(machineCode) && !/\bDate\.now\s*\(/.test(machineCode),
  );
  check(
    'hook performs no render-phase ref writes',
    !/\b\w+Ref\.current\s*=\s*/.test(
      hookCode.replace(/useEffect\s*\([\s\S]*?\n\s*\},\s*\[[\s\S]*?\]\s*\);/g, ''),
    ),
  );
  check('hook does not call ambient subscription', !/useOfficeAmbientDirections/.test(hookCode));
  check(
    'chatter integration forbids network/persistence/random',
    !/\bfetch\s*\(/.test(`${hookCode}\n${machineCode}`) &&
      !/\blocalStorage\b/.test(`${hookCode}\n${machineCode}`) &&
      !/\bMath\.random\s*\(/.test(`${hookCode}\n${machineCode}`) &&
      !/@tauri-apps\//.test(`${hookCode}\n${machineCode}`),
  );
  check(
    'machine uses foundation selectLocalChatter + empty history',
    /selectLocalChatter/.test(machineCode) && /emptyLocalChatterHistory/.test(machineCode),
  );
  check(
    'machine passes CHATTER_MAX_VISIBLE_DEFAULT as maxVisible',
    /maxVisible:\s*CHATTER_MAX_VISIBLE_DEFAULT/.test(machineCode),
  );
  check(
    'attempt encodes inactive budget without dead bubble projection',
    /activeChatterCount:\s*0/.test(machineCode) &&
      !/const\s+visible\s*=\s*visibleBubblesFromPresentation/.test(machineCode),
  );
  check(
    'idle helper mirrors actorAcceptsAmbientCue conditions',
    /actor\.status === 'idle'/.test(hookCode) &&
      /!actor\.running/.test(hookCode) &&
      /!actor\.delivering/.test(hookCode) &&
      /actor\.performance === null/.test(hookCode) &&
      /actor\.staging === null/.test(hookCode) &&
      /export function actorAcceptsAmbientCue/.test(cueProj),
  );
  check(
    'EmployeeUnit renders data-scene-chatter with kind/motion classes',
    /data-scene-chatter/.test(scene3d) &&
      /off-scene-chatter is-\$\{chatter\.kind\} is-\$\{chatter\.motion\}/.test(scene3d),
  );
  check(
    'chatter annotation is independent SceneAnnotation with ambient priority',
    /priority="ambient"/.test(scene3d) && /exclude=\{unitRef\}/.test(scene3d),
  );
  check(
    'CSS has static + reduced-motion animation none',
    /\.off-scene-chatter\.is-static/.test(css) &&
      /prefers-reduced-motion: reduce/.test(css) &&
      /animation:\s*none/.test(css),
  );
  check(
    'chatter animation uses the shared motion easing token',
    /off-scene-chatter-in\s+var\(--off-motion-fast\)\s+var\(--off-motion-ease\)/.test(css),
  );
  check(
    'chatter bubble keeps a readable intrinsic width at the default 3D camera',
    /\.off-scene-chatter\s*\{[\s\S]*?width:\s*max-content/.test(css) &&
      /\.off-scene-chatter\s*\{[\s\S]*?min-width:\s*64px/.test(css) &&
      /\.off-scene-chatter\s*\{[\s\S]*?word-break:\s*normal/.test(css),
  );
  check(
    'OfficeScene3D disables chatter in PIP',
    /const\s+chatterEnabled\s*=\s*!pip\s*&&/.test(scene3d),
  );
  check(
    'foundation modules remain free of React/Date.now/Math.random',
    !/\bDate\.now\s*\(/.test(codeOnly(foundation)) &&
      !/\bMath\.random\s*\(/.test(codeOnly(foundation)) &&
      !/from\s+['"]react['"]/.test(codeOnly(`${foundation}\n${foundationCopy}`)),
  );
}

h.report();
