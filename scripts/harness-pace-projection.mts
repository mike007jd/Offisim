import {
  NEUTRAL_PACE,
  activeDeclaredPaceMode,
  animationTempoForPace,
  composeBeats,
  composePaceSignal,
  observedCadenceMultiplier,
} from '../packages/dramaturgy/src/index.js';
import type { TimedAgentRunEvent } from '../packages/shared-types/src/index.js';
import { createHarness } from './lib/harness-runner.mjs';

const h = createHarness();
const { check } = h;

console.log('pace-projection gate');

const NOW = 30_000;
const dense = [24_000, 25_000, 26_000, 27_000, 28_000, 29_000, 30_000];
const medium = [15_000, 18_500, 22_000, 25_500, 29_000];

check('empty cadence is exactly neutral', observedCadenceMultiplier([], NOW) === 1);
check('fewer than three events is neutral', observedCadenceMultiplier([29_000, 30_000], NOW) === 1);
check('stale cadence is neutral', observedCadenceMultiplier([1_000, 2_000, 3_000], NOW) === 1);
check('dense cadence tightens to the floor', observedCadenceMultiplier(dense, NOW) === 0.68);
check('medium cadence tightens conservatively', observedCadenceMultiplier(medium, NOW) === 0.9);
check(
  'cadence is deterministic independent of input order',
  observedCadenceMultiplier([...dense].reverse(), NOW) === observedCadenceMultiplier(dense, NOW),
);
check(
  'actual fast remains active for its terminal performance',
  activeDeclaredPaceMode('fast', 29_000, NOW) === 'fast',
);
check(
  'actual standard never labels fast',
  activeDeclaredPaceMode('standard', 29_000, NOW) === 'normal',
);
check(
  'stale actual fast returns to normal',
  activeDeclaredPaceMode('fast', 10_000, NOW) === 'normal',
);
check(
  'missing actual speed remains normal',
  activeDeclaredPaceMode(undefined, 29_000, NOW) === 'normal',
);

const neutral = composePaceSignal({});
check(
  'neutral signal is byte-identical to constant',
  JSON.stringify(neutral) === JSON.stringify(NEUTRAL_PACE),
);
const observed = composePaceSignal({ observedCadence: 0.68 });
check('observed cadence never labels fast', observed.declaredMode === 'normal');
check('observed cadence shortens holds', observed.beatHoldMultiplier === 0.68);
check('observed cadence increases animation tempo', observed.animationTempoMultiplier > 1);
const fast = composePaceSignal({ declaredMode: 'fast', observedCadence: 0.68 });
check('only explicit declared mode labels fast', fast.declaredMode === 'fast');
check(
  'fast signal remains clamped',
  fast.beatHoldMultiplier >= 0.55 && fast.animationTempoMultiplier <= 1.48,
);
check('role tempo composes after pace', animationTempoForPace(0.8, observed) > 0.8);

const scope = {
  threadId: 'thread-pace',
  rootRunId: 'run-pace',
  runId: 'run-pace',
  employeeId: 'employee-pace',
} as const;
const events: TimedAgentRunEvent[] = [
  {
    ...scope,
    type: 'tool.started',
    payload: { toolCallId: 'tool-1', toolName: 'read_file', status: 'started' },
    timestamp: 1_000,
  },
  {
    ...scope,
    type: 'approval.requested',
    payload: { uiRequestId: 'approval-1', title: 'Approve' },
    timestamp: 2_000,
  },
  {
    ...scope,
    type: 'artifact.created',
    payload: { title: 'result.md', kind: 'document' },
    timestamp: 3_000,
  },
];
const normalBeats = composeBeats(events, { dramaturgyVersion: 'v1' });
const pacedBeats = composeBeats(events, {
  dramaturgyVersion: 'v1',
  pace: observed,
});
const lifetime = (kind: string, beats = normalBeats) => {
  const beat = beats.find((candidate) => candidate.kind === kind);
  return beat ? beat.lifecycle.endsAt - beat.lifecycle.startedAt : -1;
};
const ordinaryLifetime = lifetime('research');
const pacedOrdinaryLifetime = lifetime('research', pacedBeats);
const approvalLifetime = lifetime('approval');
const pacedApprovalLifetime = lifetime('approval', pacedBeats);
const artifactLifetime = lifetime('produce');
const pacedArtifactLifetime = lifetime('produce', pacedBeats);
check('ordinary beat hold is shorter under pace', pacedOrdinaryLifetime < ordinaryLifetime);
check('approval hold is never shortened', pacedApprovalLifetime === approvalLifetime);
check('artifact delivery hold is never shortened', pacedArtifactLifetime === artifactLifetime);

console.log(`pace-projection: ${h.checks - h.failures}/${h.checks} checks passed`);
h.report();
