import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  composeBeats,
  performanceForBeat,
  performanceForRoutine,
  projectOfficeStaging,
} from '@offisim/dramaturgy';
import type {
  CharacterPerformanceState,
  SceneBeat,
  TimedAgentRunEvent,
} from '@offisim/shared-types';
import { MeshoptDecoder } from 'meshoptimizer';
import { AnimationMixer, type Object3D, Vector3 } from 'three';
import { MeshoptDecoder as ThreeMeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ConversationRunsSnapshot } from '../apps/desktop/renderer/src/assistant/runtime/conversation-run-controller.js';
import { projectEmployeeWorkloads } from '../apps/desktop/renderer/src/assistant/runtime/conversation-run-projections.js';
import {
  performanceForMovementPhase,
  planCharacterMove,
  shouldPromoteSitExit,
} from '../apps/desktop/renderer/src/surfaces/office/scene/character-movement.js';
import {
  createCharacterPlaybackState,
  finishCharacterPlayback,
  isStandingMovementMount,
  reconcilePlaybackMount,
  requestCharacterPlayback,
} from '../apps/desktop/renderer/src/surfaces/office/scene/character/character-playback.js';
import {
  CLIP_NAMES,
  clipForPerformance,
  selectionForClip,
} from '../apps/desktop/renderer/src/surfaces/office/scene/character/clip-map.js';

/**
 * Phase-3 character-action oracle.
 *
 * Unlike the clip-map Cartesian gate, this opens the shipped GLB and proves the
 * binary, manifest, semantic selectors, and procedural provenance agree. It is
 * intentionally independent of CHARACTER_ASSETS_RAW_DIR so every validate run
 * checks the exact release-bound artifact committed in the worktree.
 */

const ROOT = new URL('../', import.meta.url);
const ASSET_DIR = new URL('apps/desktop/renderer/src/assets/characters/', ROOT);
const ORIGINAL_CLIPS = [
  'blocked.headshake',
  'carry',
  'celebrate.dance',
  'celebrate.yes',
  'consume',
  'idle',
  'idle.talk',
  'inspect.open',
  'interact',
  'phone',
  'pickup',
  'sit.enter',
  'sit.exit',
  'sit.idle',
  'sit.talk',
  'tpose',
  'wait.foldarms',
  'walk',
  'walk.formal',
] as const;
const PROCEDURAL_CLIPS = ['approval.wait', 'sit.type'] as const;
const EXPECTED_CLIPS = [...ORIGINAL_CLIPS, ...PROCEDURAL_CLIPS].sort();
const MAX_CLIP_COUNT = 24;
const ASSET_BUDGET_BYTES = 25 * 1024 * 1024;
const ROOT_DRIFT_LIMIT = 1e-5;
const QUATERNION_NORM_TOLERANCE = 2e-3;

interface ProceduralAnimationManifest {
  readonly baseClip: string;
  readonly mode: 'loop' | 'hold';
  readonly durationSeconds: number;
  readonly modifiedJoints: readonly string[];
}

interface CharacterManifest {
  readonly bodies: { readonly toy: { readonly heightUnits: number } };
  readonly clips: readonly string[];
  readonly clipSources: Readonly<Record<string, string>>;
  readonly proceduralAnimations?: Readonly<Record<string, ProceduralAnimationManifest>>;
  readonly files: Readonly<Record<string, number>>;
  readonly totalBytes: number;
}

interface ToyMetrics {
  readonly character: { readonly height: number };
  readonly workstation: {
    readonly deskDepth: { readonly standard: number };
    readonly standardDeskWidth: number;
    readonly seatTop: number;
    readonly chairForward: number;
    readonly seatForward: number;
    readonly deskTop: number;
    readonly seatedBodyLift: number;
    readonly seatedBodyForward: number;
    readonly contactTolerance: number;
    readonly deskEdgeInset: number;
  };
}

let failures = 0;
function check(condition: unknown, message: string): asserts condition {
  if (condition) return;
  failures += 1;
  console.error(`FAIL: ${message}`);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function approvalBeat(): SceneBeat {
  return {
    id: 'p3-approval',
    kind: 'approval',
    priority: 100,
    threadId: 'thread-p3',
    rootRunId: 'run-p3',
    runId: 'run-p3',
    employeeId: 'employee-p3',
    workKind: null,
    activityKind: null,
    affordance: null,
    movement: false,
    parallel: false,
    interrupt: true,
    variant: 0,
    visual: {
      phase: 'wait',
      intensity: 2,
      emotion: 'worried',
      affordance: null,
      badges: ['approval'],
    },
    flow: null,
    artifact: null,
    resource: null,
    at: 1,
    lifecycle: { startedAt: 1, endsAt: 600_001 },
  };
}

function timedEvent(
  type: TimedAgentRunEvent['type'],
  payload: TimedAgentRunEvent['payload'],
  timestamp = 1,
): TimedAgentRunEvent {
  return {
    threadId: 'thread-p3',
    rootRunId: 'run-p3',
    runId: 'run-p3',
    employeeId: 'employee-p3',
    type,
    payload,
    timestamp,
  } as TimedAgentRunEvent;
}

async function loadThreeGltf(name: string) {
  const bytes = await readFile(fileURLToPath(new URL(name, ASSET_DIR)));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new GLTFLoader().setMeshoptDecoder(ThreeMeshoptDecoder).parseAsync(buffer, '');
}

function requireObject(root: Object3D, name: string): Object3D {
  const object = root.getObjectByName(name);
  if (!object) throw new Error(`missing required glTF node '${name}'`);
  return object;
}

function setActorTransform(
  scene: Object3D,
  metrics: ToyMetrics,
  assetManifest: CharacterManifest,
  seated: boolean,
): void {
  const workstation = metrics.workstation;
  const actorZ = workstation.deskDepth.standard / 2 + workstation.seatForward;
  scene.scale.setScalar(metrics.character.height / assetManifest.bodies.toy.heightUnits);
  scene.rotation.set(0, seated ? Math.PI : 0, 0);
  scene.position.set(
    0,
    seated ? workstation.seatedBodyLift : 0,
    seated ? actorZ - workstation.seatedBodyForward : 0,
  );
}

const LANDMARKS = ['ToyButtContact', 'ToyPalmL', 'ToyPalmR', 'ToySoleL', 'ToySoleR'] as const;
type LandmarkName = (typeof LANDMARKS)[number];
type LandmarkSample = Record<LandmarkName, readonly [number, number, number]>;

function playLandmarks(
  mixer: AnimationMixer,
  clips: ReadonlyMap<string, import('three').AnimationClip>,
  body: Object3D,
  clipName: string,
  normalizedTime: number,
): LandmarkSample {
  const clip = clips.get(clipName);
  if (!clip) throw new Error(`missing canonical clip '${clipName}'`);
  mixer.stopAllAction();
  mixer.setTime(0);
  mixer.clipAction(clip).reset().play();
  mixer.setTime(clip.duration * Math.min(normalizedTime, 0.999999));
  body.updateMatrixWorld(true);
  return Object.fromEntries(
    LANDMARKS.map((name) => [
      name,
      requireObject(body, name).getWorldPosition(new Vector3()).toArray(),
    ]),
  ) as LandmarkSample;
}

function distance(left: readonly number[], right: readonly number[]): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function minimalRun(
  phase: 'running' | 'awaiting-approval' | 'failed',
  attemptId: string,
): ConversationRunsSnapshot['runs'][number] {
  return {
    threadId: `thread-${attemptId}`,
    companyId: 'company-p3',
    projectId: 'project-p3',
    attemptId,
    phase,
    employeeId: 'employee-p3',
    source: 'office',
    liveMessages: [],
    activity: [],
    activityTotal: 0,
    delegations: [],
    approval: null,
    error: null,
  };
}

(globalThis as unknown as { ProgressEvent?: unknown }).ProgressEvent ??= class ProgressEvent {};
(globalThis as unknown as { self?: unknown }).self ??= globalThis;
await Promise.all([MeshoptDecoder.ready, ThreeMeshoptDecoder.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const document = await io.read(fileURLToPath(new URL('animations.glb', ASSET_DIR)));
const manifest = (await import('../apps/desktop/renderer/src/assets/characters/manifest.json', {
  with: { type: 'json' },
}).then((module) => module.default)) as CharacterManifest;
const metrics = (await import(
  '../apps/desktop/renderer/src/surfaces/office/scene/toy-performance-metrics.json',
  { with: { type: 'json' } }
).then((module) => module.default)) as ToyMetrics;
const shippedAssetFiles = (await readdir(ASSET_DIR, { withFileTypes: true }))
  .filter(
    (entry) => entry.isFile() && (entry.name.endsWith('.glb') || entry.name === 'LICENSES.md'),
  )
  .map((entry) => entry.name)
  .sort();
const shippedAssetSizes = Object.fromEntries(
  await Promise.all(
    shippedAssetFiles.map(async (name) => [name, (await stat(new URL(name, ASSET_DIR))).size]),
  ),
);
const shippedAssetBytes = Object.values(shippedAssetSizes).reduce((sum, bytes) => sum + bytes, 0);
check(
  arraysEqual(Object.keys(manifest.files).sort(), shippedAssetFiles) &&
    shippedAssetFiles.every((name) => manifest.files[name] === shippedAssetSizes[name]) &&
    manifest.totalBytes === shippedAssetBytes &&
    shippedAssetBytes <= ASSET_BUDGET_BYTES,
  `manifest asset byte ledger drift: ${shippedAssetBytes}/${ASSET_BUDGET_BYTES}`,
);
const [bodyAsset, animationAsset] = await Promise.all([
  loadThreeGltf('body_toy.glb'),
  loadThreeGltf('animations.glb'),
]);

const animations = document.getRoot().listAnimations();
const glbClips = animations.map((animation) => animation.getName());
const manifestClips = [...manifest.clips];
const declaredClips = [...CLIP_NAMES];

check(glbClips.length === sortedUnique(glbClips).length, 'animations.glb contains duplicate names');
check(
  manifestClips.length === sortedUnique(manifestClips).length,
  'manifest.json contains duplicate clip names',
);
check(
  declaredClips.length === sortedUnique(declaredClips).length,
  'CLIP_NAMES contains duplicates',
);
check(
  arraysEqual(sortedUnique(glbClips), EXPECTED_CLIPS),
  `GLB clip set must be the original 19 plus approval.wait/sit.type; got ${sortedUnique(glbClips).join(', ')}`,
);
check(
  arraysEqual(sortedUnique(manifestClips), EXPECTED_CLIPS),
  `manifest clip set mismatch; got ${sortedUnique(manifestClips).join(', ')}`,
);
check(
  arraysEqual(sortedUnique(declaredClips), EXPECTED_CLIPS),
  `CLIP_NAMES mismatch; got ${sortedUnique(declaredClips).join(', ')}`,
);
check(
  glbClips.length <= MAX_CLIP_COUNT,
  `clip budget exceeded: ${glbClips.length}/${MAX_CLIP_COUNT}`,
);
for (const original of ORIGINAL_CLIPS) {
  check(glbClips.includes(original), `P0 clip '${original}' was removed`);
}

const skeletonNodes = new Set(
  document
    .getRoot()
    .listNodes()
    .map((node) => node.getName()),
);
for (const animation of animations) {
  const name = animation.getName();
  let rootTranslationTracks = 0;
  let rootOrigin: number[] | null = null;
  let maxRootDrift = 0;
  const targetPaths = new Set<string>();
  for (const channel of animation.listChannels()) {
    const node = channel.getTargetNode();
    const sampler = channel.getSampler();
    const input = sampler.getInput();
    const output = sampler.getOutput();
    check(node, `${name}: channel has no target node`);
    check(input && input.getCount() > 0, `${name}:${node?.getName()} has empty time input`);
    check(output && output.getCount() > 0, `${name}:${node?.getName()} has empty value output`);
    if (!node || !input || !output) continue;
    check(
      skeletonNodes.has(node.getName()),
      `${name}: target '${node.getName()}' is not in the rig`,
    );
    const targetPath = `${node.getName()}:${channel.getTargetPath()}`;
    check(!targetPaths.has(targetPath), `${name}: duplicate channel '${targetPath}'`);
    targetPaths.add(targetPath);

    const times = input.getArray();
    const values = output.getArray();
    check(times != null, `${name}:${targetPath} time array missing`);
    check(values != null, `${name}:${targetPath} value array missing`);
    if (!times || !values) continue;
    for (let index = 0; index < times.length; index += 1) {
      check(Number.isFinite(times[index]), `${name}:${targetPath} has non-finite time`);
      if (index > 0) {
        check(
          times[index] > times[index - 1],
          `${name}:${targetPath} times are not strictly increasing`,
        );
      }
    }
    for (const value of values) {
      check(Number.isFinite(value), `${name}:${targetPath} has non-finite values`);
    }

    if (channel.getTargetPath() === 'rotation') {
      check(output.getType() === 'VEC4', `${name}:${targetPath} rotation is not VEC4`);
      for (let index = 0; index < values.length; index += 4) {
        const norm = Math.hypot(
          values[index] ?? 0,
          values[index + 1] ?? 0,
          values[index + 2] ?? 0,
          values[index + 3] ?? 0,
        );
        check(
          Math.abs(norm - 1) <= QUATERNION_NORM_TOLERANCE,
          `${name}:${targetPath} quaternion norm ${norm} is invalid`,
        );
      }
    }

    if (node.getName() === 'root' && channel.getTargetPath() === 'translation') {
      rootTranslationTracks += 1;
      check(output.getType() === 'VEC3', `${name}: root translation is not VEC3`);
      for (let index = 0; index < values.length; index += 3) {
        const value = [values[index] ?? 0, values[index + 1] ?? 0, values[index + 2] ?? 0];
        rootOrigin ??= value;
        maxRootDrift = Math.max(
          maxRootDrift,
          Math.abs(value[0] - rootOrigin[0]),
          Math.abs(value[1] - rootOrigin[1]),
          Math.abs(value[2] - rootOrigin[2]),
        );
      }
    }
  }
  check(
    rootTranslationTracks === 1,
    `${name}: expected one root translation track, saw ${rootTranslationTracks}`,
  );
  check(
    maxRootDrift <= ROOT_DRIFT_LIMIT,
    `${name}: root drift ${maxRootDrift} exceeds ${ROOT_DRIFT_LIMIT}`,
  );
}

for (const clip of PROCEDURAL_CLIPS) {
  const source = manifest.clipSources[clip];
  const metadata = manifest.proceduralAnimations?.[clip];
  check(source?.startsWith('offisim-procedural:'), `${clip}: procedural provenance missing`);
  check(metadata, `${clip}: procedural metadata missing from manifest`);
  if (!metadata) continue;
  check(metadata.modifiedJoints.length >= 2, `${clip}: fewer than two authored joints`);
  check(
    metadata.durationSeconds >= 0.75 && metadata.durationSeconds <= 3,
    `${clip}: duration ${metadata.durationSeconds}s is outside 0.75–3.0s`,
  );
}

const seatedTyping: CharacterPerformanceState = {
  locomotion: 'idle',
  posture: 'sit',
  workGesture: 'type',
  socialGesture: 'none',
  expression: 'focus',
  prop: 'laptop',
  intensity: 1,
};
check(
  clipForPerformance(seatedTyping).clip === ('sit.type' as string),
  `seated typing still maps to '${clipForPerformance(seatedTyping).clip}'`,
);

const approval = performanceForBeat(approvalBeat());
check(
  approval.workGesture === ('approval-wait' as string),
  'approval beat lacks approval-wait gesture',
);
check(approval.posture === 'stand', 'approval beat must stand');
check(approval.prop === 'document', 'approval beat must carry the clipboard/document prop');
check(
  clipForPerformance(approval).clip === ('approval.wait' as string),
  `approval beat maps to '${clipForPerformance(approval).clip}'`,
);

// Real producer chains: wire event → beat → shared office projection → selector.
const COMPOSER_CONFIG = { dramaturgyVersion: 'v1' } as const;
const writeBeat = composeBeats(
  [
    timedEvent('tool.started', {
      toolCallId: 'tool-write',
      toolName: 'write_file',
      status: 'started',
    }),
  ],
  COMPOSER_CONFIG,
).find((beat) => beat.kind === 'produce' || beat.kind === 'activity');
check(writeBeat, 'write_file did not compose a work beat');
const writeProjection = projectOfficeStaging(writeBeat ? [writeBeat] : [], []);
check(writeProjection.length === 1, 'write beat did not reach office staging');
check(
  writeProjection[0]?.performance.workGesture === 'type' &&
    clipForPerformance(writeProjection[0].performance).clip === 'sit.type',
  'write_file producer chain did not reach sit.type',
);

const realApprovalBeat = composeBeats(
  [
    timedEvent('approval.requested', {
      uiRequestId: 'approval-p3',
      title: 'Approve?',
    }),
  ],
  COMPOSER_CONFIG,
).find((beat) => beat.kind === 'approval');
check(realApprovalBeat, 'approval.requested did not compose an approval beat');
check(realApprovalBeat?.resource == null, 'approval is still misclassified as a blocked resource');
const realApprovalPerformance = realApprovalBeat
  ? projectOfficeStaging([realApprovalBeat], [])[0]?.performance
  : undefined;
check(
  realApprovalPerformance?.workGesture === 'approval-wait' &&
    realApprovalPerformance.prop === 'document' &&
    clipForPerformance(realApprovalPerformance).clip === 'approval.wait',
  'approval producer chain did not reach approval.wait + clipboard',
);

const approvalRun = minimalRun('awaiting-approval', 'run-approval');
const approvalSnapshot: ConversationRunsSnapshot = {
  runs: [approvalRun],
  activeRuns: [approvalRun],
  pendingApprovals: [],
};
const approvalWorkload = projectEmployeeWorkloads(
  approvalSnapshot,
  'project-p3',
  () => realApprovalBeat ?? null,
).get('employee-p3');
const approvalIssue = approvalWorkload?.workloadSummary.priorityIssues[0];
check(
  approvalIssue?.kind === 'approval' && approvalIssue.severity === 'warning',
  `approval marker is not amber/warning: ${JSON.stringify(approvalIssue)}`,
);

const workingRun = minimalRun('running', 'run-working');
const concurrentSnapshot: ConversationRunsSnapshot = {
  runs: [approvalRun, workingRun],
  activeRuns: [approvalRun, workingRun],
  pendingApprovals: [],
};
const concurrent = projectEmployeeWorkloads(concurrentSnapshot, 'project-p3', (runId) =>
  runId === 'run-approval' ? (realApprovalBeat ?? null) : (writeBeat ?? null),
).get('employee-p3');
check(
  concurrent?.dominant?.runId === 'run-working' &&
    concurrent.workloadSummary.priorityIssues.some((issue) => issue.kind === 'approval'),
  'working sibling no longer outranks approval-only actor while retaining amber marker',
);

const permissionFailure = composeBeats(
  [timedEvent('run.failed', { status: 'failed', failureKind: 'permission' })],
  COMPOSER_CONFIG,
).find((beat) => beat.kind === 'failure');
check(
  permissionFailure?.resource?.kind === 'permission' &&
    permissionFailure.resource.severity === 'blocked',
  'real permission failure lost its blocked resource contract',
);
check(
  permissionFailure != null &&
    clipForPerformance(performanceForBeat(permissionFailure)).clip === 'blocked.headshake',
  'permission failure no longer reaches blocked.headshake',
);

check(
  clipForPerformance(performanceForRoutine('phone')).clip === 'phone' &&
    clipForPerformance(performanceForRoutine('consume')).clip === 'consume' &&
    clipForPerformance(performanceForRoutine('inspect')).clip === 'inspect.open',
  'P5 routine seam does not reach phone/consume/inspect.open semantically',
);
const beatKinds: SceneBeat['kind'][] = [
  'receive-task',
  'plan',
  'delegate',
  'research',
  'produce',
  'compute',
  'review',
  'approval',
  'failure',
  'cancelled',
  'join',
  'complete',
  'activity',
];
const activityKinds: SceneBeat['activityKind'][] = [
  null,
  'read',
  'search',
  'write',
  'edit',
  'shell',
  'build',
  'test',
  'inspect',
  'wait',
];
for (const kind of beatKinds) {
  for (const activityKind of activityKinds) {
    const perf = performanceForBeat({ ...approvalBeat(), kind, activityKind });
    check(
      perf.workGesture !== 'phone' && perf.workGesture !== 'consume',
      `${kind}/${activityKind ?? 'none'} accidentally consumes a P5-reserved routine`,
    );
  }
}

// Live playback FSM: atomic posture transitions, stale-finish immunity, bounded
// one-shots, and reduced-motion semantic pose selection.
const typingTarget = { posture: 'sit' as const, selection: selectionForClip('sit.type') };
const approvalTarget = {
  posture: 'stand' as const,
  selection: selectionForClip('approval.wait'),
};
let machine = createCharacterPlaybackState('sit');
let step = requestCharacterPlayback(machine, typingTarget, { reducedMotion: false });
check(step.command?.selection.clip === 'sit.type', 'initial seated work did not start sit.type');
machine = step.state;
step = requestCharacterPlayback(machine, approvalTarget, { reducedMotion: false });
check(step.command?.selection.clip === 'sit.exit', 'sit→approval did not start sit.exit');
machine = step.state;
const stale = finishCharacterPlayback(machine, 'celebrate.yes');
check(
  stale.command == null && stale.state.transition?.clip === 'sit.exit',
  'stale one-shot consumed the active sit.exit transition',
);
step = finishCharacterPlayback(machine, 'sit.exit');
check(
  step.completedTransition === 'sit.exit' &&
    step.state.actualPosture === 'stand' &&
    step.command === null,
  'sit.exit completion started an obsolete destination clip',
);
machine = step.state;
step = requestCharacterPlayback(machine, approvalTarget, { reducedMotion: false });
check(
  step.command?.selection.clip === 'approval.wait',
  'post-exit frame did not start the single latest approval destination',
);
machine = step.state;
step = requestCharacterPlayback(machine, typingTarget, { reducedMotion: false });
check(step.command?.selection.clip === 'sit.enter', 'approval→working did not start sit.enter');
machine = step.state;
step = finishCharacterPlayback(machine, 'sit.enter');
check(
  step.state.actualPosture === 'sit' && step.command === null,
  'sit.enter completion started an obsolete destination clip',
);
step = requestCharacterPlayback(step.state, typingTarget, { reducedMotion: false });
check(step.command?.selection.clip === 'sit.type', 'post-enter frame did not start sit.type');

machine = createCharacterPlaybackState('sit');
machine = requestCharacterPlayback(machine, typingTarget, { reducedMotion: false }).state;
machine = requestCharacterPlayback(machine, approvalTarget, { reducedMotion: false }).state;
step = requestCharacterPlayback(machine, typingTarget, { reducedMotion: false });
check(step.command == null && step.state.desired?.posture === 'sit', 'rapid reversal cut sit.exit');
step = finishCharacterPlayback(step.state, 'sit.exit');
check(
  step.command === null && step.state.actualPosture === 'stand',
  'rapid reversal started a destination inside the finish handler',
);
step = requestCharacterPlayback(step.state, typingTarget, { reducedMotion: false });
check(
  step.command?.selection.clip === 'sit.enter',
  'rapid reversal did not finish exit before starting enter',
);

const typingWithLaptop: CharacterPerformanceState = {
  locomotion: 'idle',
  posture: 'sit',
  workGesture: 'type',
  socialGesture: 'none',
  expression: 'focus',
  prop: 'laptop',
  intensity: 1,
};
for (const origin of ['entry', 'drop-return'] as const) {
  const plan = planCharacterMove({
    start: [0, 0],
    target: [4, 0],
    origin,
    currentPhase: 'idle',
    reducedMotion: false,
    pathfinderAvailable: false,
    routedWaypoints: null,
  });
  const unreconciledMount = createCharacterPlaybackState('sit');
  const mounted = reconcilePlaybackMount(unreconciledMount, plan.phase);
  const movingPerformance = performanceForMovementPhase(typingWithLaptop, plan.phase);
  const mountedStep = requestCharacterPlayback(
    mounted,
    { posture: movingPerformance.posture, selection: clipForPerformance(movingPerformance) },
    { reducedMotion: false },
  );
  check(
    plan.phase === 'walk' &&
      isStandingMovementMount(unreconciledMount, plan.phase) &&
      mounted !== unreconciledMount &&
      mountedStep.state.actualPosture === 'stand' &&
      mountedStep.state.transition === null &&
      mountedStep.command?.selection.clip === 'carry',
    `${origin} mount sat down before starting its walk`,
  );
}

const settledMountSource = createCharacterPlaybackState('sit');
const settledMount = reconcilePlaybackMount(settledMountSource, 'idle');
const settledStep = requestCharacterPlayback(settledMount, typingTarget, { reducedMotion: false });
check(
  settledMount === settledMountSource &&
    settledStep.state.actualPosture === 'sit' &&
    settledStep.state.transition === null &&
    settledStep.command?.selection.clip === 'sit.type',
  'ordinary seated mount was incorrectly rebased to standing',
);
const standingWalkRemount = createCharacterPlaybackState('stand');
check(
  isStandingMovementMount(standingWalkRemount, 'walk') &&
    reconcilePlaybackMount(standingWalkRemount, 'walk') === standingWalkRemount,
  'already-standing walk remount lost its first-frame floor-offset snap signal',
);

const seatedActive = requestCharacterPlayback(createCharacterPlaybackState('sit'), typingTarget, {
  reducedMotion: false,
}).state;
const atomicDeparture = reconcilePlaybackMount(seatedActive, 'sit-exit');
const departurePerformance = performanceForMovementPhase(typingWithLaptop, 'sit-exit');
const departureStep = requestCharacterPlayback(
  atomicDeparture,
  { posture: departurePerformance.posture, selection: clipForPerformance(departurePerformance) },
  { reducedMotion: false },
);
check(
  departureStep.state.actualPosture === 'sit' &&
    departureStep.state.transition?.clip === 'sit.exit' &&
    departureStep.command?.selection.clip === 'sit.exit',
  'mount reconciliation swallowed an atomic seated departure',
);
check(
  shouldPromoteSitExit('sit-exit', createCharacterPlaybackState('stand').actualPosture, false),
  'already-standing settled actor did not promote directly to walk',
);

machine = createCharacterPlaybackState('stand');
const dance = { posture: 'stand' as const, selection: selectionForClip('celebrate.dance') };
machine = requestCharacterPlayback(machine, dance, { reducedMotion: false }).state;
step = finishCharacterPlayback(machine, 'celebrate.dance');
check(step.command?.selection.clip === 'idle', 'celebration does not return to work/rest');
machine = step.state;
step = requestCharacterPlayback(machine, dance, { reducedMotion: false });
check(step.command == null, 'completed celebration retriggers while semantics are unchanged');
for (const clipName of ['celebrate.dance', 'celebrate.yes'] as const) {
  check(
    (animationAsset.animations.find((clip) => clip.name === clipName)?.duration ??
      Number.POSITIVE_INFINITY) <= 2.5,
    `${clipName} exceeds the 2.5s celebration bound`,
  );
}

machine = createCharacterPlaybackState('sit');
machine = requestCharacterPlayback(machine, approvalTarget, { reducedMotion: false }).state;
step = requestCharacterPlayback(machine, approvalTarget, {
  reducedMotion: true,
  forceRestart: true,
});
check(
  step.command?.selection.clip === 'approval.wait' &&
    step.command.instant &&
    step.command.selection.reducedPoseTime > 0 &&
    step.state.actualPosture === 'stand' &&
    step.state.transition == null,
  'reduced motion did not clear transition and snap to a visible approval pose',
);

// Release-bound geometry sampling: desk contact + seated lower-body stability,
// visible typing motion, loop seam, and a restrained chest-level approval hold.
const body = bodyAsset.scene;
const threeClips = new Map(animationAsset.animations.map((clip) => [clip.name, clip]));
const mixer = new AnimationMixer(body);
const typingClip = threeClips.get('sit.type');
check(typingClip, 'Three.js could not load sit.type from the release GLB');
setActorTransform(body, metrics, manifest, true);
const deskHalfWidth = metrics.workstation.standardDeskWidth / 2 - metrics.workstation.deskEdgeInset;
const deskHalfDepth =
  metrics.workstation.deskDepth.standard / 2 - metrics.workstation.deskEdgeInset;
const typingFrames = Math.ceil((typingClip?.duration ?? 0) * 60);
const contactCount = { ToyPalmL: 0, ToyPalmR: 0 };
const firstTyping = playLandmarks(mixer, threeClips, body, 'sit.type', 0);
const maxPalmTravel = { ToyPalmL: 0, ToyPalmR: 0 };
let maxButtDelta = 0;
for (let frame = 0; frame <= typingFrames; frame += 1) {
  const sample = playLandmarks(
    mixer,
    threeClips,
    body,
    'sit.type',
    typingFrames > 0 ? frame / typingFrames : 0,
  );
  maxButtDelta = Math.max(
    maxButtDelta,
    Math.abs(sample.ToyButtContact[1] - metrics.workstation.seatTop),
  );
  for (const palm of ['ToyPalmL', 'ToyPalmR'] as const) {
    const [x, y, z] = sample[palm];
    const inContact =
      Math.abs(y - metrics.workstation.deskTop) <= metrics.workstation.contactTolerance &&
      Math.abs(x) <= deskHalfWidth &&
      Math.abs(z) <= deskHalfDepth;
    if (inContact) contactCount[palm] += 1;
    maxPalmTravel[palm] = Math.max(maxPalmTravel[palm], distance(sample[palm], firstTyping[palm]));
  }
}
const sampledFrameCount = typingFrames + 1;
check(maxButtDelta <= 0.05, `sit.type butt drifts off chair by ${maxButtDelta}`);
check(
  contactCount.ToyPalmL / sampledFrameCount >= 0.8 &&
    contactCount.ToyPalmR / sampledFrameCount >= 0.8,
  `sit.type desk contact insufficient: ${JSON.stringify(contactCount)}/${sampledFrameCount}`,
);
check(
  maxPalmTravel.ToyPalmL >= 0.003 && maxPalmTravel.ToyPalmR >= 0.006,
  `sit.type hand motion too small: ${JSON.stringify(maxPalmTravel)}`,
);
const finalTyping = playLandmarks(mixer, threeClips, body, 'sit.type', 1);
check(
  distance(firstTyping.ToyPalmL, finalTyping.ToyPalmL) <= 0.002 &&
    distance(firstTyping.ToyPalmR, finalTyping.ToyPalmR) <= 0.002,
  'sit.type has a visible loop seam',
);
let typeVsIdle = 0;
let typeVsTalk = 0;
const comparisonTimes = [0.125, 0.375, 0.625, 0.875];
for (const time of comparisonTimes) {
  const typing = playLandmarks(mixer, threeClips, body, 'sit.type', time);
  const idle = playLandmarks(mixer, threeClips, body, 'sit.idle', time);
  const talk = playLandmarks(mixer, threeClips, body, 'sit.talk', time);
  typeVsIdle += distance(typing.ToyPalmL, idle.ToyPalmL) + distance(typing.ToyPalmR, idle.ToyPalmR);
  typeVsTalk += distance(typing.ToyPalmL, talk.ToyPalmL) + distance(typing.ToyPalmR, talk.ToyPalmR);
}
check(typeVsIdle / comparisonTimes.length >= 0.2, 'sit.type is not distinct from sit.idle');
check(typeVsTalk / comparisonTimes.length >= 0.025, 'sit.type is not distinct from sit.talk');

setActorTransform(body, metrics, manifest, false);
const approvalFinal = playLandmarks(mixer, threeClips, body, 'approval.wait', 1);
const idleFinal = playLandmarks(mixer, threeClips, body, 'idle', 1);
const approvalDifference =
  distance(approvalFinal.ToyPalmL, idleFinal.ToyPalmL) +
  distance(approvalFinal.ToyPalmR, idleFinal.ToyPalmR);
check(approvalDifference >= 0.25, 'approval.wait final hold is not visibly distinct from idle');
check(
  approvalFinal.ToyPalmL[1] >= 0.7 &&
    approvalFinal.ToyPalmL[1] <= 1.15 &&
    approvalFinal.ToyPalmR[1] >= 0.7 &&
    approvalFinal.ToyPalmR[1] <= 1.15,
  'approval.wait hands do not hold the clipboard in a restrained chest band',
);

const lowerBodyTracks = [
  'root.position',
  'root.quaternion',
  'pelvis.position',
  'pelvis.quaternion',
  'thigh_l.quaternion',
  'calf_l.quaternion',
  'foot_l.quaternion',
  'thigh_r.quaternion',
  'calf_r.quaternion',
  'foot_r.quaternion',
];
function sampleTrack(
  clip: import('three').AnimationClip,
  name: string,
  normalizedTime: number,
): Float32Array | null {
  const track = clip.tracks.find((candidate) => candidate.name === name);
  if (!track) return null;
  const output = new Float32Array(track.getValueSize());
  track.createInterpolant(output).evaluate(clip.duration * Math.min(normalizedTime, 0.999999));
  return output;
}
function trackDistance(left: Float32Array, right: Float32Array, quaternion: boolean): number {
  if (quaternion) {
    const dot = Math.abs(
      left[0] * right[0] + left[1] * right[1] + left[2] * right[2] + left[3] * right[3],
    );
    return 2 * Math.acos(Math.min(1, Math.max(-1, dot)));
  }
  return Math.hypot(...left.map((value, index) => value - right[index]));
}
for (const [derivedName, baseName] of [
  ['sit.type', 'sit.idle'],
  ['approval.wait', 'idle'],
] as const) {
  const derived = threeClips.get(derivedName);
  const base = threeClips.get(baseName);
  check(derived && base, `${derivedName}: lower-body comparison source is missing`);
  if (!derived || !base) continue;
  for (const trackName of lowerBodyTracks) {
    for (const normalizedTime of [0, 0.25, 0.5, 0.75, 1]) {
      const derivedValue = sampleTrack(derived, trackName, normalizedTime);
      const baseValue = sampleTrack(base, trackName, normalizedTime);
      check(
        derivedValue && baseValue,
        `${derivedName}/${baseName}: missing lower-body track '${trackName}'`,
      );
      if (!derivedValue || !baseValue) continue;
      check(
        trackDistance(derivedValue, baseValue, trackName.endsWith('.quaternion')) <= 2e-3,
        `${derivedName}: lower-body track '${trackName}' diverged from ${baseName}`,
      );
    }
  }
}

for (const clipName of CLIP_NAMES) {
  const clip = threeClips.get(clipName);
  const reducedPoseTime = selectionForClip(clipName).reducedPoseTime;
  check(clip, `${clipName}: missing from Three.js release loader`);
  check(
    clip != null && reducedPoseTime <= clip.duration + 1e-6,
    `${clipName}: reduced pose ${reducedPoseTime}s exceeds duration ${clip?.duration}`,
  );
}

if (failures > 0) {
  console.error(`\nharness-character-actions-p3: ${failures} failure(s)`);
  process.exit(1);
}

console.log(
  `PASS harness-character-actions-p3 — ${animations.length} real GLB clips, procedural provenance, root/track integrity, semantic anchors`,
);
