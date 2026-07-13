import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SceneCueFrame } from '../apps/desktop/renderer/src/assistant/runtime/scene-cue-projection.js';
import {
  OFFICE_COMPANION_ATLAS_FRAME,
  OFFICE_COMPANION_ROUTE_CLEARANCE,
  OFFICE_COMPANION_STATES,
  type OfficeCompanionPlanInput,
  buildOfficeCompanionCandidates,
  createOfficeCompanionPlan,
  officeCompanionOccupiedPoints,
  officeCompanionPlanKey,
  sampleOfficeCompanionPlan,
} from '../apps/desktop/renderer/src/surfaces/office/scene/office-companion/companion-projection.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}/${path}`);
const readText = (path: string) => read(path).toString('utf8');

function pngInfo(path: string) {
  const value = read(path);
  assert.deepEqual([...value.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${path} PNG`);
  return {
    width: value.readUInt32BE(16),
    height: value.readUInt32BE(20),
    colorType: value[25],
    sha256: createHash('sha256').update(value).digest('hex'),
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function actor(
  employeeId: string,
  status: 'idle' | 'working' | 'approval' | 'blocked' = 'idle',
  expression: 'neutral' | 'happy' = 'neutral',
) {
  return {
    employeeId,
    threadId: `thread-${employeeId}`,
    selected: false,
    hovered: false,
    dragging: false,
    status,
    delivering: false,
    running: status === 'working',
    performance: {
      locomotion: 'idle',
      posture: 'stand',
      workGesture: status === 'working' ? 'inspect-terminal' : 'none',
      socialGesture: 'none',
      expression,
      intensity: status === 'idle' ? 0 : 1,
    },
    staging: null,
    workload: {
      activeCount: status === 'working' ? 1 : 0,
      tier: 'small',
      countLabel: null,
      chips: [],
      overflow: false,
      topIssue: null,
      primary: 'count',
    },
    artifacts: [],
  };
}

function frame(overrides: Partial<SceneCueFrame> = {}): SceneCueFrame {
  return {
    actors: [actor('ava')],
    flows: [],
    delivery: { chips: [], recentCount: 0, overflowCount: 0, latest: null },
    resources: [],
    attention: null,
    ...overrides,
  } as SceneCueFrame;
}

const candidates = [
  { x: -4, z: -2 },
  { x: 0, z: 3 },
  { x: 5, z: -1 },
] as const;
const actorPositions = new Map([['ava', { x: -1, z: 0 }]]);
let routeCalls = 0;
const pathfinder = {
  findWaypoints(_from: readonly [number, number], to: readonly [number, number]) {
    routeCalls += 1;
    return [to];
  },
};
const baseInput: OfficeCompanionPlanInput = {
  enabled: true,
  companyId: 'company-a',
  projectId: 'project-a',
  nowMs: 1_720_000_011_000,
  mode: 'office',
  reducedMotion: false,
  geometryRevision: 'geometry-a',
  frame: frame(),
  candidates,
  occupiedPoints: [],
  actorPositions,
  deliveryPoint: { x: 3, z: 3 },
  pathfinder,
};

const first = createOfficeCompanionPlan(baseInput);
const second = createOfficeCompanionPlan({ ...baseInput });
assert.deepEqual(first, second, 'same explicit inputs produce the same route plan');
assert.equal(officeCompanionPlanKey(baseInput), first.key);
assert.doesNotThrow(() => JSON.parse(JSON.stringify(first)), 'plan is serializable');
assert.ok(routeCalls <= 2, 'A* is a plan-time operation, not a sample-time operation');
const callsBeforeSampling = routeCalls;
for (let index = 0; index < 1_000; index += 1) {
  sampleOfficeCompanionPlan(first, baseInput.nowMs + index);
}
assert.equal(routeCalls, callsBeforeSampling, 'sampling never reruns A*');

assert.notEqual(
  officeCompanionPlanKey(baseInput),
  officeCompanionPlanKey({ ...baseInput, candidates: [{ x: 99, z: 99 }] }),
  'candidate geometry invalidates the plan cache',
);
assert.notEqual(
  officeCompanionPlanKey(baseInput),
  officeCompanionPlanKey({
    ...baseInput,
    actorPositions: new Map([['ava', { x: 20, z: 20 }]]),
  }),
  'actor relocation invalidates the plan cache',
);
assert.notEqual(
  officeCompanionPlanKey(baseInput),
  officeCompanionPlanKey({ ...baseInput, occupiedPoints: [{ x: 2, z: 2 }] }),
  'dynamic collision geometry invalidates the plan cache',
);

const disabled = createOfficeCompanionPlan({ ...baseInput, enabled: false });
assert.deepEqual(sampleOfficeCompanionPlan(disabled, baseInput.nowMs), {
  visible: false,
  state: 'idle',
  x: 0,
  z: 0,
  facing: 1,
  moving: false,
  static: true,
  nextWakeAt: null,
});

const reducedA = createOfficeCompanionPlan({ ...baseInput, reducedMotion: true });
const reducedB = createOfficeCompanionPlan({
  ...baseInput,
  reducedMotion: true,
  nowMs: baseInput.nowMs + 80_000,
});
assert.equal(reducedA.key, reducedB.key, 'reduced motion has no time-varying route identity');
assert.deepEqual(
  sampleOfficeCompanionPlan(reducedA, baseInput.nowMs),
  sampleOfficeCompanionPlan(reducedB, baseInput.nowMs + 80_000),
  'reduced motion keeps one stable position and pose',
);
const focusA = createOfficeCompanionPlan({ ...baseInput, mode: 'focus' });
const focusB = createOfficeCompanionPlan({
  ...baseInput,
  mode: 'focus',
  nowMs: baseInput.nowMs + 40_000,
});
assert.deepEqual(
  sampleOfficeCompanionPlan(focusA, baseInput.nowMs),
  sampleOfficeCompanionPlan(focusB, baseInput.nowMs + 40_000),
  'focus mode is static',
);

const stateFor = (nextFrame: SceneCueFrame) =>
  sampleOfficeCompanionPlan(
    createOfficeCompanionPlan({ ...baseInput, frame: nextFrame, reducedMotion: true }),
    baseInput.nowMs,
  ).state;
assert.equal(stateFor(frame({ actors: [actor('ava', 'working')] })), 'work-watch');
assert.equal(stateFor(frame({ actors: [actor('ava', 'idle', 'happy')] })), 'celebrate');
assert.equal(
  stateFor(
    frame({ delivery: { chips: [], recentCount: 1, overflowCount: 0, latest: {} as never } }),
  ),
  'celebrate',
);
assert.equal(stateFor(frame({ actors: [actor('ava', 'approval')] })), 'inspect');
assert.equal(stateFor(frame({ actors: [actor('ava', 'blocked')] })), 'concerned');
assert.equal(
  stateFor(
    frame({
      actors: [actor('ava')],
      flows: [
        {
          employeeId: 'ava',
          kind: 'failure',
          target: 'tool',
          ink: 'risk',
          pulse: false,
          bundleCount: 1,
          at: 1,
          label: 'Tool failed',
        },
      ] as never,
    }),
  ),
  'concerned',
  'a flow-only failure must outrank quiet',
);
assert.equal(
  stateFor(
    frame({
      actors: [actor('ava', 'approval', 'happy')],
      delivery: { chips: [], recentCount: 1, overflowCount: 0, latest: {} as never },
      resources: [{ employeeId: 'ava' } as never],
    }),
  ),
  'concerned',
  'priority is failure > approval > delivery/success > work > quiet',
);

const frozenFrame = deepFreeze(frame({ actors: [actor('ava', 'working')] }));
const beforeFrozen = JSON.stringify(frozenFrame);
createOfficeCompanionPlan({ ...baseInput, frame: frozenFrame });
assert.equal(JSON.stringify(frozenFrame), beforeFrozen, 'projection cannot mutate runtime cues');

const zones = [
  { id: 'zone-b', label: 'B', archetype: 'rest', cx: 5, cz: 0, w: 6, d: 6 },
  { id: 'zone-a', label: 'A', archetype: 'workspace', cx: -5, cz: 0, w: 6, d: 6 },
];
const candidatePathfinder = {
  clearLineOfSight(x1: number, z1: number, x2: number, z2: number) {
    return Number.isFinite(x1 + z1 + x2 + z2);
  },
};
const occupied = [{ x: -5, z: 0 }];
const orderedCandidates = buildOfficeCompanionCandidates(zones, occupied, candidatePathfinder);
assert.deepEqual(
  orderedCandidates,
  buildOfficeCompanionCandidates(
    [...zones].reverse(),
    [...occupied].reverse(),
    candidatePathfinder,
  ),
  'geometry input order cannot change candidate output',
);
assert.ok(orderedCandidates.every((point) => Math.hypot(point.x + 5, point.z) >= 2.2));
const compactCandidates = buildOfficeCompanionCandidates(
  [{ id: 'compact', label: 'Compact', archetype: 'workspace', cx: 0, cz: 0, w: 3, d: 3 }],
  [{ x: 0, z: 0 }],
  candidatePathfinder,
);
assert.ok(
  compactCandidates.length > 0,
  'a legal 3×3 zone with a centered employee keeps safe candidates',
);
const occupiedFromFrame = officeCompanionOccupiedPoints(
  frame({
    actors: [{ ...actor('ava'), staging: { x: 3, z: 4 } } as never],
    delivery: { chips: [], recentCount: 1, overflowCount: 0, latest: {} as never },
  }),
  actorPositions,
  { x: 9, z: 9 },
);
assert.ok(occupiedFromFrame.some((point) => point.x === 3 && point.z === 4));
assert.ok(occupiedFromFrame.some((point) => point.x === 9 && point.z === 9));

const directPathfinder = {
  findWaypoints(_from: readonly [number, number], to: readonly [number, number]) {
    return [to];
  },
};
for (let tick = 0; tick < compactCandidates.length * 2; tick += 1) {
  const compactPlan = createOfficeCompanionPlan({
    ...baseInput,
    companyId: 'compact-company',
    projectId: 'compact-project',
    nowMs: tick * 8_000,
    candidates: compactCandidates,
    occupiedPoints: [{ x: 0, z: 0 }],
    actorPositions: new Map([['ava', { x: 0, z: 0 }]]),
    pathfinder: directPathfinder,
  });
  assert.ok(compactPlan.visible, 'a legal compact office keeps a reachable companion route');
}
const continuityInput = {
  ...baseInput,
  companyId: 'continuity-company',
  projectId: 'continuity-project',
  candidates: [
    { x: -6, z: -3 },
    { x: -2, z: 4 },
    { x: 3, z: 5 },
    { x: 7, z: -2 },
  ],
  occupiedPoints: [],
  actorPositions: new Map(),
  pathfinder: directPathfinder,
};
for (let tick = 10; tick < 40; tick += 1) {
  const boundary = (tick + 1) * 8_000;
  const current = createOfficeCompanionPlan({ ...continuityInput, nowMs: tick * 8_000 });
  const next = createOfficeCompanionPlan({ ...continuityInput, nowMs: boundary });
  const before = sampleOfficeCompanionPlan(current, boundary - 1);
  const after = sampleOfficeCompanionPlan(next, boundary);
  assert.ok(before.visible && after.visible);
  assert.ok(
    Math.hypot(before.x - after.x, before.z - after.z) < 0.01,
    `segment ${tick} must join without a visible teleport`,
  );
}

function segmentDistance(
  point: { x: number; z: number },
  from: { x: number; z: number },
  to: { x: number; z: number },
) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const squared = dx * dx + dz * dz;
  const progress =
    squared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.z - from.z) * dz) / squared));
  return Math.hypot(point.x - (from.x + dx * progress), point.z - (from.z + dz * progress));
}

const collisionCandidates = [
  { x: -5, z: 0 },
  { x: 0, z: 3 },
  { x: 5, z: 0 },
];
for (let tick = 0; tick < collisionCandidates.length; tick += 1) {
  const plan = createOfficeCompanionPlan({
    ...baseInput,
    companyId: 'collision-company',
    projectId: 'collision-project',
    nowMs: tick * 8_000,
    candidates: collisionCandidates,
    occupiedPoints: [{ x: 0, z: 0 }],
    actorPositions: new Map([['ava', { x: 0, z: 0 }]]),
    pathfinder: directPathfinder,
  });
  assert.ok(plan.visible, 'the available safe detour keeps the companion visible');
  for (let index = 1; index < plan.path.length; index += 1) {
    const from = plan.path[index - 1];
    const to = plan.path[index];
    assert.ok(from && to);
    assert.ok(
      segmentDistance({ x: 0, z: 0 }, from, to) >= OFFICE_COMPANION_ROUTE_CLEARANCE,
      'every planned segment clears employee occupancy',
    );
  }
}

const projectionSource = readText(
  'apps/desktop/renderer/src/surfaces/office/scene/office-companion/companion-projection.ts',
);
assert.doesNotMatch(
  projectionSource,
  /Date\.now|Math\.random|setInterval|setTimeout|invokeCommand|Repository/,
);
const scene2d = readText('apps/desktop/renderer/src/surfaces/office/scene/OfficeScene2D.tsx');
const scene3d = readText('apps/desktop/renderer/src/surfaces/office/scene/OfficeScene3D.tsx');
const companion3d = readText(
  'apps/desktop/renderer/src/surfaces/office/scene/office-companion/OfficeCompanion3D.tsx',
);
assert.match(scene2d, /createOfficeCompanionPlan/);
assert.match(scene3d, /<OfficeCompanion3D/);
assert.match(companion3d, /raycast=\{\(\) => null\}/);
assert.doesNotMatch(scene2d, /hitsRef\.current\.push\(\{[^}]*companion/s);
assert.equal((scene3d.match(/<OfficeCompanion3D/g) ?? []).length, 1);

const uiState = readText('apps/desktop/renderer/src/app/ui-state.ts');
const stageViewer = readText(
  'apps/desktop/renderer/src/surfaces/office/stage-viewer/StageViewer.tsx',
);
assert.match(uiState, /OFFICE_COMPANION_STORAGE_KEY/);
assert.match(uiState, /persistOfficeCompanionEnabled/);
assert.match(stageViewer, /aria-pressed=\{companionEnabled\}/);
assert.match(stageViewer, /Ambient only · no AI work/);

const manifest = JSON.parse(
  readText('apps/desktop/renderer/src/assets/companion/manifest.json'),
) as {
  source: string;
  sourceSize: [number, number];
  sha256: string;
  states: Record<string, { cell: [number, number]; file: string; sha256: string }>;
};
assert.deepEqual(Object.keys(manifest.states).sort(), [...OFFICE_COMPANION_STATES].sort());
assert.deepEqual(manifest.sourceSize, [1536, 1024]);
const atlasPath = `apps/desktop/renderer/src/assets/companion/${manifest.source}`;
const atlas = pngInfo(atlasPath);
assert.deepEqual([atlas.width, atlas.height, atlas.colorType], [1536, 1024, 6]);
assert.equal(atlas.sha256, manifest.sha256);
const stateHashes = new Set<string>();
for (const state of OFFICE_COMPANION_STATES) {
  const entry = manifest.states[state];
  assert.ok(entry, `manifest is missing ${state}`);
  assert.deepEqual(entry.cell, [
    OFFICE_COMPANION_ATLAS_FRAME[state].column,
    OFFICE_COMPANION_ATLAS_FRAME[state].row,
  ]);
  const info = pngInfo(`apps/desktop/renderer/src/assets/companion/${entry.file}`);
  assert.deepEqual([info.width, info.height, info.colorType], [384, 512, 6]);
  assert.equal(info.sha256, entry.sha256);
  stateHashes.add(info.sha256);
}
assert.equal(stateHashes.size, OFFICE_COMPANION_STATES.length, 'state crops are distinct');
const assetBytes = [manifest.source, ...Object.values(manifest.states).map((entry) => entry.file)]
  .map((file) => statSync(`${ROOT}/apps/desktop/renderer/src/assets/companion/${file}`).size)
  .reduce((sum, size) => sum + size, 0);
assert.ok(assetBytes < 1_500_000, `asset budget exceeded: ${assetBytes}`);
assert.match(
  readText('Docs/design/2026-07-13-codex-companion-state-sheet.md'),
  /failure\/resource > approval > delivery\/success > active work > quiet/,
);

const start = performance.now();
for (let index = 0; index < 10_000; index += 1) {
  sampleOfficeCompanionPlan(first, baseInput.nowMs + index);
}
const averageMs = (performance.now() - start) / 10_000;
assert.ok(averageMs < 1, `companion sampling average ${averageMs.toFixed(4)}ms exceeds 1ms`);

console.log(
  `office-companion: PASS (determinism, priority, route cache, 2D/3D, reduced motion, assets; ${averageMs.toFixed(4)}ms/sample)`,
);
