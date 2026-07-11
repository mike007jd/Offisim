import { readFile } from 'node:fs/promises';
import type {
  CharacterStatus,
  SceneBeat,
  StagingPrefab,
  TimedAgentRunEvent,
} from '@offisim/shared-types';
import { SYSTEM_ZONE_TEMPLATES, composeBeats, worldAnchorsFor } from '@offisim/shared-types';
import { PerspectiveCamera, Vector3 } from 'three';
import type {
  ConversationRunSnapshot,
  ConversationRunsSnapshot,
} from '../apps/desktop/renderer/src/assistant/runtime/conversation-run-controller.js';
import { projectEmployeeWorkloads } from '../apps/desktop/renderer/src/assistant/runtime/conversation-run-projections.js';
import {
  RESOURCE_KIND_GLYPHS,
  type SceneCueInput,
  projectSceneCues,
} from '../apps/desktop/renderer/src/assistant/runtime/scene-cue-projection.js';
import { OFFICE_SCENE_2D_COLORS } from '../apps/desktop/renderer/src/data/color-palette.js';
import { performanceForMovementPhase } from '../apps/desktop/renderer/src/surfaces/office/scene/character-movement.js';
import { clipForPerformance } from '../apps/desktop/renderer/src/surfaces/office/scene/character/clip-map.js';
import {
  OFFICE_DELIVERY_STAGING_PREFAB,
  OFFICE_DELIVERY_WORLD,
  characterIndicatorPresentation,
  officeResourceMarkerColor,
} from '../apps/desktop/renderer/src/surfaces/office/scene/office-visual-language.js';
import { OFFICE_CAMERA_PRESET } from '../apps/desktop/renderer/src/surfaces/office/scene/r3d/scene-art-direction.js';
import {
  OFFICE_TOY_SIGNAL_COLORS,
  OFFICE_TOY_STATE_COLORS,
} from '../apps/desktop/renderer/src/surfaces/office/scene/r3d/scene-colors.js';

/**
 * Office Toy Performance P4 oracle — operational visual language.
 *
 * This is deliberately narrower than the general scene-cue harness. It locks
 * the P4 acceptance contract through the real producer chain:
 *
 * TimedAgentRunEvent → composeBeats → projectEmployeeWorkloads → projectSceneCues
 *
 * The dynamic half proves the four business statuses, orthogonal selection,
 * delivery choreography, exact diorama inks and the six resource glyphs. The
 * source half prevents the deleted CharacterAction lane, a second selection
 * ring and pill-shaped CSS from drifting back into the P4-owned surfaces.
 */

const ROOT = new URL('../', import.meta.url);
const PROJECT_ID = 'project-p4';
const THREAD_ID = 'thread-p4';
const COMPOSER_CONFIG = { dramaturgyVersion: 'v1' } as const;

let checks = 0;
let failures = 0;

function check(name: string, condition: unknown, detail = ''): void {
  checks += 1;
  if (condition) {
    console.log(`  PASS ${name}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

interface EventScope {
  readonly runId: string;
  readonly employeeId: string;
  readonly rootRunId?: string;
}

function timedEvent(
  type: TimedAgentRunEvent['type'],
  payload: TimedAgentRunEvent['payload'],
  timestamp: number,
  scope: EventScope,
): TimedAgentRunEvent {
  return {
    threadId: THREAD_ID,
    rootRunId: scope.rootRunId ?? scope.runId,
    runId: scope.runId,
    employeeId: scope.employeeId,
    type,
    payload,
    timestamp,
  } as TimedAgentRunEvent;
}

function started(timestamp: number, scope: EventScope): TimedAgentRunEvent {
  return timedEvent(
    'run.started',
    { objective: `P4 ${scope.runId}`, access: 'write' },
    timestamp,
    scope,
  );
}

function toolStarted(timestamp: number, scope: EventScope): TimedAgentRunEvent {
  return timedEvent(
    'tool.started',
    { toolCallId: `${scope.runId}:tool`, toolName: 'write_file', status: 'started' },
    timestamp,
    scope,
  );
}

function approvalRequested(timestamp: number, scope: EventScope): TimedAgentRunEvent {
  return timedEvent(
    'approval.requested',
    { uiRequestId: `${scope.runId}:approval`, title: 'Approve P4 action?' },
    timestamp,
    scope,
  );
}

function permissionFailed(timestamp: number, scope: EventScope): TimedAgentRunEvent {
  return timedEvent(
    'run.failed',
    { status: 'failed', failureKind: 'permission' },
    timestamp,
    scope,
  );
}

function artifactCreated(timestamp: number, scope: EventScope): TimedAgentRunEvent {
  return timedEvent(
    'artifact.created',
    { title: 'P4 delivery', kind: 'doc', path: '/tmp/p4-delivery.md' },
    timestamp,
    scope,
  );
}

function runSnapshot(
  attemptId: string,
  employeeId: string,
  phase: ConversationRunSnapshot['phase'],
): ConversationRunSnapshot {
  return {
    threadId: THREAD_ID,
    companyId: 'company-p4',
    projectId: PROJECT_ID,
    attemptId,
    phase,
    employeeId,
    source: 'office',
    liveMessages: [],
    activity: [],
    activityTotal: 0,
    delegations: [],
    approval: null,
    error: null,
  };
}

function snapshot(runs: readonly ConversationRunSnapshot[]): ConversationRunsSnapshot {
  return {
    runs: [...runs],
    activeRuns: runs.filter((run) => run.phase === 'running' || run.phase === 'awaiting-approval'),
    pendingApprovals: [],
  };
}

function beatForFrom(beats: readonly SceneBeat[]): (runId: string) => SceneBeat | null {
  const byRun = new Map<string, SceneBeat>();
  for (const beat of beats) byRun.set(beat.runId, beat);
  return (runId) => byRun.get(runId) ?? null;
}

const OFFICE_PREFABS: readonly StagingPrefab[] = [
  { instanceId: 'desk-p4', prefabId: 'workstation-standard', x: -4, z: 0, rotation: 0 },
  OFFICE_DELIVERY_STAGING_PREFAB,
];

interface PipelineInput {
  readonly events: readonly TimedAgentRunEvent[];
  readonly runs: readonly ConversationRunSnapshot[];
  readonly roster: readonly string[];
  readonly now: number;
  readonly selectedEmployeeId?: string | null;
}

function projectPipeline(input: PipelineInput) {
  const beats = composeBeats(input.events, COMPOSER_CONFIG);
  const workloads = projectEmployeeWorkloads(snapshot(input.runs), PROJECT_ID, beatForFrom(beats));
  const sceneInput: SceneCueInput = {
    roster: input.roster,
    workloads,
    beats,
    now: input.now,
    prefabs: OFFICE_PREFABS,
    mode: 'office',
    reducedMotion: false,
    threadByEmployee: new Map(input.roster.map((employeeId) => [employeeId, THREAD_ID])),
    ...(input.selectedEmployeeId
      ? { inputState: { selectedEmployeeId: input.selectedEmployeeId } }
      : {}),
  };
  return { beats, workloads, sceneInput, frame: projectSceneCues(sceneInput) };
}

const EMPLOYEE = {
  idle: 'employee-idle',
  working: 'employee-working',
  approval: 'employee-approval',
  blocked: 'employee-blocked',
  delivery: 'employee-delivery',
} as const;

const runWorkingA: EventScope = { runId: 'run-working-a', employeeId: EMPLOYEE.working };
const runWorkingB: EventScope = { runId: 'run-working-b', employeeId: EMPLOYEE.working };
const runApproval: EventScope = { runId: 'run-approval', employeeId: EMPLOYEE.approval };
const runBlocked: EventScope = { runId: 'run-blocked', employeeId: EMPLOYEE.blocked };

const scanEvents: readonly TimedAgentRunEvent[] = [
  started(100, runWorkingA),
  started(110, runWorkingB),
  started(120, runApproval),
  started(130, runBlocked),
  toolStarted(140, runWorkingA),
  toolStarted(150, runWorkingB),
  approvalRequested(160, runApproval),
  permissionFailed(170, runBlocked),
];
const scanRuns: readonly ConversationRunSnapshot[] = [
  runSnapshot(runWorkingA.runId, EMPLOYEE.working, 'running'),
  runSnapshot(runWorkingB.runId, EMPLOYEE.working, 'running'),
  runSnapshot(runApproval.runId, EMPLOYEE.approval, 'awaiting-approval'),
  runSnapshot(runBlocked.runId, EMPLOYEE.blocked, 'failed'),
];
const scanRoster = [EMPLOYEE.idle, EMPLOYEE.working, EMPLOYEE.approval, EMPLOYEE.blocked];

console.log('office-visual-language-p4 gate');
console.log('\n[scan] four statuses in one real scene frame');

const scan = projectPipeline({
  events: scanEvents,
  runs: scanRuns,
  roster: scanRoster,
  now: 300,
});
const scanActors = new Map(scan.frame.actors.map((actor) => [actor.employeeId, actor]));
const statuses = Object.fromEntries(
  scanRoster.map((employeeId) => [employeeId, scanActors.get(employeeId)?.status]),
) as Record<string, CharacterStatus | undefined>;

check(
  'idle / working / approval / blocked are simultaneously explicit',
  statuses[EMPLOYEE.idle] === 'idle' &&
    statuses[EMPLOYEE.working] === 'working' &&
    statuses[EMPLOYEE.approval] === 'approval' &&
    statuses[EMPLOYEE.blocked] === 'blocked',
  json(statuses),
);
check(
  'five-second scan needs no selection fallback',
  scan.frame.actors.every((actor) => actor.selected === false),
  json(scan.frame.actors.map((actor) => [actor.employeeId, actor.selected])),
);

const workingActor = scanActors.get(EMPLOYEE.working);
const approvalActor = scanActors.get(EMPLOYEE.approval);
const blockedActor = scanActors.get(EMPLOYEE.blocked);
check(
  'two working runs collapse to one actor with the preserved ×2 workload cue',
  workingActor?.workload.activeCount === 2 && workingActor.workload.countLabel === '×2',
  json(workingActor?.workload),
);
check(
  'approval stays an amber warning issue, never a blocked resource',
  approvalActor?.workload.topIssue?.kind === 'approval' &&
    approvalActor.workload.topIssue.severity === 'warning' &&
    scan.frame.resources.some(
      (cue) =>
        cue.employeeId === EMPLOYEE.approval &&
        cue.kind === 'approval' &&
        cue.resourceKind === null &&
        cue.severity === 'warning',
    ),
  `${json(approvalActor?.workload.topIssue)} / ${json(scan.frame.resources)}`,
);
check(
  'permission failure is the blocked actor and keeps the typed P marker',
  blockedActor?.workload.primary === 'issue' &&
    scan.frame.resources.some(
      (cue) =>
        cue.employeeId === EMPLOYEE.blocked &&
        cue.resourceKind === 'permission' &&
        cue.severity === 'blocked',
    ) &&
    RESOURCE_KIND_GLYPHS.permission === 'P',
  json(scan.frame.resources),
);
check(
  'approval diegesis is approval.wait + clipboard/document',
  approvalActor?.performance?.workGesture === 'approval-wait' &&
    approvalActor.performance.prop === 'document' &&
    approvalActor.performance.expression === 'thinking' &&
    clipForPerformance(approvalActor.performance).clip === 'approval.wait',
  json(approvalActor?.performance),
);
check(
  'blocked diegesis is worried eyes + blocked.headshake',
  blockedActor?.performance?.expression === 'worried' &&
    blockedActor.performance.intensity === 2 &&
    clipForPerformance(blockedActor.performance).clip === 'blocked.headshake',
  json(blockedActor?.performance),
);

console.log('\n[precedence] blocked > approval > working > idle on one actor');
const precedenceEmployee = 'employee-precedence';
const precedenceWorking: EventScope = {
  runId: 'run-precedence-working',
  employeeId: precedenceEmployee,
};
const precedenceApproval: EventScope = {
  runId: 'run-precedence-approval',
  employeeId: precedenceEmployee,
};
const precedenceBlocked: EventScope = {
  runId: 'run-precedence-blocked',
  employeeId: precedenceEmployee,
};
const precedenceEvents = [
  started(100, precedenceWorking),
  started(110, precedenceApproval),
  started(120, precedenceBlocked),
  toolStarted(140, precedenceWorking),
  approvalRequested(150, precedenceApproval),
  permissionFailed(160, precedenceBlocked),
] as const;
const precedenceRuns = [
  runSnapshot(precedenceWorking.runId, precedenceEmployee, 'running'),
  runSnapshot(precedenceApproval.runId, precedenceEmployee, 'awaiting-approval'),
  runSnapshot(precedenceBlocked.runId, precedenceEmployee, 'failed'),
] as const;
const precedenceActor = (
  events: readonly TimedAgentRunEvent[],
  runs: readonly ConversationRunSnapshot[],
): (typeof scan.frame.actors)[number] | undefined =>
  projectPipeline({ events, runs, roster: [precedenceEmployee], now: 300 }).frame.actors[0];
const blockedPrecedenceActor = precedenceActor(precedenceEvents, precedenceRuns);
const approvalPrecedenceActor = precedenceActor(
  precedenceEvents.slice(0, 5),
  precedenceRuns.slice(0, 2),
);
const workingPrecedenceActor = precedenceActor(
  precedenceEvents.slice(0, 1),
  precedenceRuns.slice(0, 1),
);
check(
  'a live blocked issue outranks approval and ordinary work',
  blockedPrecedenceActor?.status === 'blocked',
);
check(
  'approval outranks an ordinary working sibling once blocked is absent',
  approvalPrecedenceActor?.status === 'approval',
);
check(
  'ordinary work wins once no issue or approval is present',
  workingPrecedenceActor?.status === 'working',
);
check(
  'blocked precedence also owns worried/headshake diegesis and cancels relocation',
  blockedPrecedenceActor?.performance?.expression === 'worried' &&
    clipForPerformance(blockedPrecedenceActor.performance).clip === 'blocked.headshake' &&
    blockedPrecedenceActor.staging === null,
  json(blockedPrecedenceActor),
);
check(
  'approval precedence also owns clipboard/approval.wait diegesis and cancels relocation',
  approvalPrecedenceActor?.performance?.workGesture === 'approval-wait' &&
    approvalPrecedenceActor.performance.prop === 'document' &&
    clipForPerformance(approvalPrecedenceActor.performance).clip === 'approval.wait' &&
    approvalPrecedenceActor.staging === null,
  json(approvalPrecedenceActor),
);

console.log('\n[selection] interaction layer is orthogonal to business status');
const selectedFrame = projectSceneCues({
  ...scan.sceneInput,
  inputState: { selectedEmployeeId: EMPLOYEE.approval },
});
const selectedApproval = selectedFrame.actors.find(
  (actor) => actor.employeeId === EMPLOYEE.approval,
);
const semanticActor = (actor: (typeof scan.frame.actors)[number] | undefined) =>
  actor
    ? {
        status: actor.status,
        delivering: actor.delivering,
        running: actor.running,
        performance: actor.performance,
        staging: actor.staging,
        workload: actor.workload,
        artifacts: actor.artifacts,
      }
    : null;
check(
  'selection toggles selected but preserves approval semantics byte-for-byte',
  selectedApproval?.selected === true &&
    json(semanticActor(selectedApproval)) === json(semanticActor(approvalActor)),
  json(semanticActor(selectedApproval)),
);
check(
  'exactly one actor owns selection',
  selectedFrame.actors.filter((actor) => actor.selected).length === 1,
  json(selectedFrame.actors.map((actor) => [actor.employeeId, actor.selected])),
);

console.log('\n[indicators] one toy-diorama vocabulary, exact state inks');
const expectedColors = {
  working: '#5C9A96',
  approval: '#D09A45',
  blocked: '#C65F5A',
  selected: '#7FA9D8',
} as const;
const colors2D = {
  working: OFFICE_SCENE_2D_COLORS.stateWorking,
  approval: OFFICE_SCENE_2D_COLORS.stateApproval,
  blocked: OFFICE_SCENE_2D_COLORS.stateBlocked,
  selected: OFFICE_SCENE_2D_COLORS.stateSelected,
};
check(
  '3D state inks equal the four exact office-art-bible colors',
  json(OFFICE_TOY_STATE_COLORS) === json(expectedColors),
  json(OFFICE_TOY_STATE_COLORS),
);
check(
  '2D mirror is byte-equal to the 3D state-ink source',
  json(colors2D) === json(OFFICE_TOY_STATE_COLORS),
  `${json(colors2D)} vs ${json(OFFICE_TOY_STATE_COLORS)}`,
);
check(
  'approval amber and blocked red cannot collapse to one signal',
  OFFICE_TOY_STATE_COLORS.approval !== OFFICE_TOY_STATE_COLORS.blocked &&
    new Set(Object.values(OFFICE_TOY_STATE_COLORS)).size === 4,
);

const idleIndicator = characterIndicatorPresentation('idle', false, false);
const workingIndicator = characterIndicatorPresentation('working', false, false);
const reducedWorkingIndicator = characterIndicatorPresentation('working', false, true);
const approvalIndicator = characterIndicatorPresentation('approval', false, false);
const blockedIndicator = characterIndicatorPresentation('blocked', false, false);
const typedBlockedIndicator = characterIndicatorPresentation('blocked', false, false, false, true);
const selectedApprovalIndicator = characterIndicatorPresentation('approval', true, false);
check(
  'idle owns only the low-contrast base disc',
  json(idleIndicator.layers) === json(['base-disc']) &&
    idleIndicator.dots === 0 &&
    idleIndicator.stateColor === null,
  json(idleIndicator),
);
check(
  'working owns the muted halo and exactly three restrained dots',
  json(workingIndicator.layers) === json(['base-disc', 'working-disc', 'working-dots']) &&
    workingIndicator.dots === 3 &&
    workingIndicator.dotsAnimated === true &&
    workingIndicator.stateColor === expectedColors.working,
  json(workingIndicator),
);
check(
  'reduced motion freezes dots without deleting the working tell',
  json(reducedWorkingIndicator.layers) === json(workingIndicator.layers) &&
    reducedWorkingIndicator.dots === 3 &&
    reducedWorkingIndicator.dotsAnimated === false,
  json(reducedWorkingIndicator),
);
check(
  'approval owns only its amber ring + head marker',
  json(approvalIndicator.layers) === json(['base-disc', 'approval-ring', 'approval-marker']) &&
    approvalIndicator.stateColor === expectedColors.approval,
  json(approvalIndicator),
);
check(
  'blocked owns only its muted-red segments + head marker',
  json(blockedIndicator.layers) === json(['base-disc', 'blocked-segments', 'blocked-marker']) &&
    blockedIndicator.stateColor === expectedColors.blocked,
  json(blockedIndicator),
);
check(
  'a typed resource marker replaces the generic blocked head square',
  typedBlockedIndicator.layers.includes('blocked-segments') &&
    !typedBlockedIndicator.layers.includes('blocked-marker'),
  json(typedBlockedIndicator),
);
check(
  'non-blocking resource warning stays slate while blocked/exhausted stay muted red',
  officeResourceMarkerColor('warning') === OFFICE_TOY_SIGNAL_COLORS.neutral &&
    officeResourceMarkerColor('blocked') === OFFICE_TOY_STATE_COLORS.blocked &&
    officeResourceMarkerColor('exhausted') === OFFICE_TOY_STATE_COLORS.blocked,
);
check(
  'selected adds one cool outer ring without replacing approval',
  selectedApprovalIndicator.status === 'approval' &&
    selectedApprovalIndicator.layers.filter((layer) => layer === 'selected-ring').length === 1 &&
    selectedApprovalIndicator.layers.includes('approval-ring') &&
    selectedApprovalIndicator.stateColor === expectedColors.approval &&
    selectedApprovalIndicator.selectedColor === expectedColors.selected,
  json(selectedApprovalIndicator),
);
check(
  'every indicator presentation contains unique primitive ids',
  [
    idleIndicator,
    workingIndicator,
    approvalIndicator,
    blockedIndicator,
    selectedApprovalIndicator,
  ].every((item) => new Set(item.layers).size === item.layers.length),
);

const expectedGlyphs = {
  token: 'T',
  budget: 'B',
  permission: 'P',
  context: 'C',
  runtime: 'R',
  tool: 'X',
} as const;
check(
  'resource vocabulary is exactly the six distinct T/B/P/C/R/X glyphs',
  json(RESOURCE_KIND_GLYPHS) === json(expectedGlyphs) &&
    new Set(Object.values(RESOURCE_KIND_GLYPHS)).size === 6,
  json(RESOURCE_KIND_GLYPHS),
);

console.log('\n[delivery] artifact choreography reaches the real shelf and carry clip');
const runDelivery: EventScope = { runId: 'run-delivery', employeeId: EMPLOYEE.delivery };
const delivery = projectPipeline({
  events: [started(100, runDelivery), artifactCreated(200, runDelivery)],
  runs: [runSnapshot(runDelivery.runId, EMPLOYEE.delivery, 'running')],
  roster: [EMPLOYEE.delivery],
  now: 300,
});
const deliveryBeat = delivery.beats.find((beat) => beat.artifact != null);
const deliveryActor = delivery.frame.actors.find((actor) => actor.employeeId === EMPLOYEE.delivery);
check(
  'artifact.created becomes a live movement beat targeting delivery-shelf',
  deliveryBeat?.movement === true &&
    deliveryBeat.affordance === 'delivery-shelf' &&
    deliveryBeat.lifecycle.endsAt - deliveryBeat.lifecycle.startedAt >= 24_000,
  json(deliveryBeat),
);
check(
  'ActorCue marks delivery orthogonally while business status remains working',
  deliveryActor?.status === 'working' && deliveryActor.delivering === true,
  json(deliveryActor),
);
check(
  'delivery uses handoff + document and resolves walking playback to carry',
  deliveryActor?.performance?.workGesture === 'handoff' &&
    deliveryActor.performance.prop === 'document' &&
    clipForPerformance(performanceForMovementPhase(deliveryActor.performance, 'walk')).clip ===
      'carry',
  json(deliveryActor?.performance),
);
check(
  'delivery reserves the shared physical shelf anchor',
  deliveryActor?.staging?.affordance === 'delivery-shelf' &&
    deliveryActor.staging.anchorId === '__office-delivery-shelf#0' &&
    deliveryActor.staging.posture === 'standing',
  json(deliveryActor?.staging),
);
check(
  'the same frame carries shelf inventory and a delivery-target flow lane',
  delivery.frame.delivery.recentCount === 1 &&
    delivery.frame.delivery.latest?.title === 'P4 delivery' &&
    delivery.frame.flows.some(
      (flow) => flow.employeeId === EMPLOYEE.delivery && flow.target === 'delivery',
    ),
  `${json(delivery.frame.delivery)} / ${json(delivery.frame.flows)}`,
);

const deliveryAnchors = worldAnchorsFor([OFFICE_DELIVERY_STAGING_PREFAB]).filter(
  (anchor) => anchor.kind === 'delivery-shelf',
);
const overlapsSeededZone = SYSTEM_ZONE_TEMPLATES.some(
  (zone) =>
    Math.abs(OFFICE_DELIVERY_WORLD.x - zone.cx) < 1.1 + zone.w / 2 &&
    Math.abs(OFFICE_DELIVERY_WORLD.z - zone.cz) < 0.34 + zone.d / 2,
);
const camera = new PerspectiveCamera(OFFICE_CAMERA_PRESET.fov, 758 / 571, 0.1, 1_000);
camera.position.set(...OFFICE_CAMERA_PRESET.position);
camera.lookAt(...OFFICE_CAMERA_PRESET.target);
camera.updateMatrixWorld();
const shelfViewPoints = [
  [OFFICE_DELIVERY_WORLD.x - 1.1, 0, OFFICE_DELIVERY_WORLD.z - 0.34],
  [OFFICE_DELIVERY_WORLD.x + 1.1, 0.88, OFFICE_DELIVERY_WORLD.z + 0.34],
  ...deliveryAnchors.flatMap((anchor) => [
    [anchor.x, 0, anchor.z],
    [anchor.x, 2, anchor.z],
  ]),
] as const;
const shelfNdc = shelfViewPoints.map(([x, y, z]) => new Vector3(x, y, z).project(camera));
check(
  'physical shelf occupies the open aisle and every shelf/actor point is visible in the opening camera',
  !overlapsSeededZone &&
    deliveryAnchors.length === 4 &&
    shelfNdc.every(
      (point) =>
        Math.abs(point.x) <= 0.92 && Math.abs(point.y) <= 0.92 && point.z >= -1 && point.z <= 1,
    ),
  `${json(OFFICE_DELIVERY_WORLD)} / overlaps=${overlapsSeededZone} / ${json(
    shelfNdc.map((point) => [point.x, point.y, point.z]),
  )}`,
);

const delegatedEmployee = 'employee-delegated-delivery';
const delegatedRootId = 'run-delegated-root';
const delegatedChildId = 'run-delegated-child';
const delegatedScope: EventScope = {
  runId: delegatedChildId,
  rootRunId: delegatedRootId,
  employeeId: delegatedEmployee,
};
const delegatedArtifactEvent = {
  ...artifactCreated(220, delegatedScope),
  employeeId: null,
} satisfies TimedAgentRunEvent;
const delegatedRootSnapshot: ConversationRunSnapshot = {
  ...runSnapshot(delegatedRootId, 'unused-root-employee', 'running'),
  employeeId: null,
  delegations: [
    {
      runId: delegatedChildId,
      parentRunId: delegatedRootId,
      employeeId: delegatedEmployee,
      objective: 'delegated P4 delivery',
      state: 'running',
    },
  ],
};
const delegatedDelivery = projectPipeline({
  events: [delegatedArtifactEvent],
  runs: [delegatedRootSnapshot],
  roster: [delegatedEmployee],
  now: 300,
});
const delegatedActor = delegatedDelivery.frame.actors.find(
  (actor) => actor.employeeId === delegatedEmployee,
);
check(
  'employee-less delegated artifact keeps its resolved owner through staging and flow',
  delegatedActor?.delivering === true &&
    delegatedActor.staging?.affordance === 'delivery-shelf' &&
    delegatedDelivery.frame.flows.some(
      (flow) => flow.employeeId === delegatedEmployee && flow.target === 'delivery',
    ),
  `${json(delegatedActor)} / ${json(delegatedDelivery.frame.flows)}`,
);

const concurrentScopes = Array.from({ length: 5 }, (_, index) => ({
  runId: `run-concurrent-delivery-${index}`,
  employeeId: `employee-concurrent-delivery-${index}`,
}));
const concurrentDelivery = projectPipeline({
  events: concurrentScopes.flatMap((scope, index) => [
    started(100 + index, scope),
    artifactCreated(200 + index, scope),
  ]),
  runs: concurrentScopes.map((scope) => runSnapshot(scope.runId, scope.employeeId, 'running')),
  roster: concurrentScopes.map((scope) => scope.employeeId),
  now: 300,
});
const concurrentActors = concurrentScopes.map((scope) =>
  concurrentDelivery.frame.actors.find((actor) => actor.employeeId === scope.employeeId),
);
const carryingActors = concurrentActors.filter((actor) => actor?.delivering);
check(
  'parallel artifacts use unique real shelf anchors and never claim carry without coordinates',
  carryingActors.length > 1 &&
    carryingActors.length <= deliveryAnchors.length &&
    new Set(carryingActors.map((actor) => actor?.staging?.anchorId)).size ===
      carryingActors.length &&
    concurrentActors.every(
      (actor) =>
        actor?.delivering ===
        Boolean(
          actor?.staging?.affordance === 'delivery-shelf' &&
            actor.staging.anchorId &&
            actor.staging.x != null &&
            actor.staging.z != null,
        ),
    ),
  json(concurrentActors),
);

console.log('\n[source guards] removed lanes stay removed; P4 blocks stay toy-like');
const sourceEntries = await Promise.all(
  Object.entries({
    indicators: 'apps/desktop/renderer/src/surfaces/office/scene/character/indicators.tsx',
    character: 'apps/desktop/renderer/src/surfaces/office/scene/character/GltfCharacter.tsx',
    scene2D: 'apps/desktop/renderer/src/surfaces/office/scene/OfficeScene2D.tsx',
    scene3D: 'apps/desktop/renderer/src/surfaces/office/scene/OfficeScene3D.tsx',
    stagingInputs: 'apps/desktop/renderer/src/surfaces/office/scene/use-scene-staging-inputs.ts',
    officeCss: 'apps/desktop/renderer/src/surfaces/office/office.css',
  }).map(async ([key, path]) => [key, await readFile(new URL(path, ROOT), 'utf8')] as const),
);
const source = Object.fromEntries(sourceEntries) as Record<string, string>;
const legacyCharacterSource = `${source.indicators}\n${source.character}`;
check(
  'CharacterAction and legacyPerformance are absent from the character renderer',
  !/\bCharacterAction\b|\blegacyPerformance\b/.test(legacyCharacterSource),
);
check(
  'the old action prop / ActionHalo lane is absent',
  !/\baction\?:|\bactionState\b|\bActionHalo\b/.test(legacyCharacterSource) &&
    !/\baction=\{/.test(source.scene3D),
);
check(
  'the production indicator consumes the pure P4 presentation contract',
  source.indicators.includes('characterIndicatorPresentation'),
);
check(
  'OfficeScene3D no longer draws the old active selection ring outside the indicator owner',
  !/\{active\s*&&\s*!dragging\s*\?\s*\(\s*<mesh[\s\S]{0,520}<ringGeometry/.test(source.scene3D),
);
check(
  'both scene modes consume ActorCue.status from the shared frame',
  source.scene2D.includes('cue?.status') && source.scene3D.includes('cue?.status'),
);
check(
  'neither scene re-derives blocked state from workload.primary',
  !/workload\??\.primary\s*===\s*['"]issue['"]|wl\??\.primary\s*===\s*['"]issue['"]/.test(
    `${source.scene2D}\n${source.scene3D}`,
  ),
);
check(
  'both scene modes still consume the shared six-glyph source',
  source.scene2D.includes('RESOURCE_KIND_GLYPHS') &&
    source.scene3D.includes('RESOURCE_KIND_GLYPHS'),
);
check(
  'approval and kindless failures never fall back to a fake ! resource glyph',
  !/RESOURCE_KIND_GLYPHS[^\n]{0,120}['"]!['"]|\?\?\s*['"]!['"]/.test(
    `${source.scene2D}\n${source.scene3D}`,
  ),
);
check(
  'typed blocked strain replaces the generic marker and warning ink uses the shared semantic helper',
  source.character.includes('hasTypedResourceMarker') &&
    source.indicators.includes('hasTypedResourceMarker') &&
    source.scene2D.includes('officeResourceMarkerColor') &&
    source.scene3D.includes('officeResourceMarkerColor'),
);
check(
  'blocked attribution is explicit while the duplicate failure lane wording is suppressed',
  source.scene3D.includes('`${labelText} · BLOCKED`') &&
    source.scene3D.includes("showLabel: cue.kind !== 'failure'") &&
    source.officeCss.includes('.off-scene-tag.is-status-blocked'),
);
check(
  'pulse=false and reduced-motion flows keep a static packet in both scene modes',
  source.scene2D.includes('reducedMotion || !cue.pulse ? 0.35') &&
    source.scene3D.includes('pulse && !reducedMotion') &&
    !source.scene3D.includes('if (!pulse) return null'),
);
check(
  'status rendering no longer reads the superseded green/amber/selection/danger palette lane',
  !/LIGHT_SCENE_3D\.(?:ledGreen|ledAmber|selectionRing|ghostBlocked)/.test(
    `${source.indicators}\n${source.character}\n${source.scene3D}`,
  ),
);
check(
  'the live shared staging input injects the physical delivery anchor',
  source.stagingInputs.includes('OFFICE_DELIVERY_STAGING_PREFAB') ||
    (source.scene2D.includes('OFFICE_DELIVERY_STAGING_PREFAB') &&
      source.scene3D.includes('OFFICE_DELIVERY_STAGING_PREFAB')),
);

const p4SelectorFragments = [
  '.off-scene-tag',
  '.off-scene-count-badge',
  '.off-scene-resource-marker',
  '.off-scene-workload-',
  '.off-scene-delivery',
  '.off-scene-flow-',
] as const;
const cssRules = [...source.officeCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
  selector: (match[1] ?? '').trim(),
  body: match[2] ?? '',
}));
const missingCssFamilies: string[] = [];
const pillRules: string[] = [];
for (const fragment of p4SelectorFragments) {
  const family = cssRules.filter((rule) => rule.selector.includes(fragment));
  if (family.length === 0) missingCssFamilies.push(fragment);
  for (const rule of family) {
    if (rule.body.includes('--off-r-pill')) pillRules.push(rule.selector);
  }
}
check(
  'all P4 workload / marker / chip / shelf / flow CSS families exist',
  missingCssFamilies.length === 0,
  json(missingCssFamilies),
);
check(
  'P4-owned CSS blocks use toy bevels, never the generic pill radius',
  pillRules.length === 0,
  json([...new Set(pillRules)]),
);

console.log(`\noffice-visual-language-p4: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exitCode = 1;
