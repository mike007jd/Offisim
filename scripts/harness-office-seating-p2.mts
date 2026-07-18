/**
 * Office Toy Performance P2 oracle — identity-stable seats and observable moves.
 *
 * Locks the two production contracts that previously allowed the P-5 seat-shift
 * defect: a persisted employee→slot registry and a roster-size-independent seat
 * catalog. The source guards at the end keep both render modes on the shared
 * hook and keep drag/reassign movement connected to the real production path.
 */
import { readFile } from 'node:fs/promises';
import {
  EMPLOYEE_CAPACITY_MESSAGE,
  assertCompanyEmployeeCapacity,
} from '../apps/desktop/renderer/src/data/employee-capacity.js';
import type { Employee } from '../apps/desktop/renderer/src/data/types.js';
import {
  performanceForMovementPhase,
  planCharacterMove,
  shouldPromoteSitExit,
} from '../apps/desktop/renderer/src/surfaces/office/scene/character-movement.js';
import { clipForPerformance } from '../apps/desktop/renderer/src/surfaces/office/scene/character/clip-map.js';
import {
  type EmployeeScenePlacement,
  type ZoneDef,
  employeePlacements,
} from '../apps/desktop/renderer/src/surfaces/office/scene/scene-layout.js';
import {
  type SeatSlotRegistry,
  parseSeatSlotRegistry,
  reconcileSeatSlotRegistry,
  serializeSeatSlotRegistry,
} from '../apps/desktop/renderer/src/surfaces/office/scene/seat-slot-registry.js';

let checks = 0;
let failures = 0;

function check(name: string, condition: boolean, detail = ''): void {
  checks += 1;
  if (condition) {
    console.log(`  PASS ${name}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

const FALLBACK_ZONE: ZoneDef = {
  id: 'zone-a',
  label: 'A',
  archetype: 'workspace',
  cx: -6,
  cz: 0,
  w: 10,
  d: 8,
};
const ZONES: ZoneDef[] = [
  FALLBACK_ZONE,
  { id: 'zone-b', label: 'B', archetype: 'workspace', cx: 6, cz: 0, w: 10, d: 8 },
];

function employee(id: string, workstationId = 'zone-a'): Employee {
  return {
    id,
    name: id,
    role: 'Developer',
    kind: 'internal',
    online: true,
    avatarA: '#111111',
    avatarB: '#222222',
    discipline: 'Engineering',
    modelLabel: 'Runtime default',
    skillCount: 0,
    workstationId,
  };
}

function slots(registry: SeatSlotRegistry): Record<string, string> {
  return Object.fromEntries(
    Object.entries(registry.assignments).map(([id, seat]) => [id, `${seat.zoneId}:${seat.slot}`]),
  );
}

function placements(
  roster: Employee[],
  registry: SeatSlotRegistry,
): Map<string, EmployeeScenePlacement> {
  return employeePlacements(roster, ZONES, FALLBACK_ZONE, undefined, registry);
}

function point(map: Map<string, EmployeeScenePlacement>, id: string): string {
  const value = map.get(id);
  return value ? `${value.x.toFixed(5)},${value.z.toFixed(5)},${value.zoneId}` : 'missing';
}

function samePoints(
  before: Map<string, EmployeeScenePlacement>,
  after: Map<string, EmployeeScenePlacement>,
  ids: string[],
): boolean {
  return ids.every((id) => point(before, id) === point(after, id));
}

console.log('office-seating-p2 gate');

console.log('\n[registry] deterministic first allocation + persistence');
const initialRoster = [employee('emp-d'), employee('emp-b'), employee('emp-c')];
const initial = reconcileSeatSlotRegistry(initialRoster, ZONES, FALLBACK_ZONE, {
  version: 1,
  assignments: {},
});
check(
  'first allocation is employee-id stable, independent of roster order',
  JSON.stringify(slots(initial)) ===
    JSON.stringify({ 'emp-b': 'zone-a:0', 'emp-c': 'zone-a:1', 'emp-d': 'zone-a:2' }),
  JSON.stringify(slots(initial)),
);
const encoded = serializeSeatSlotRegistry(initial);
const decoded = parseSeatSlotRegistry(encoded);
check('registry roundtrip is byte-stable', serializeSeatSlotRegistry(decoded) === encoded, encoded);
check(
  'persistence stores semantic zone+slot only, never world x/z coordinates',
  Object.values(JSON.parse(encoded).assignments as Record<string, Record<string, unknown>>).every(
    (seat) => Object.keys(seat).sort().join(',') === 'slot,zoneId',
  ),
  encoded,
);
check(
  'malformed or wrong-version storage resets directly (no prelaunch migration)',
  Object.keys(parseSeatSlotRegistry('{oops').assignments).length === 0 &&
    Object.keys(parseSeatSlotRegistry('{"version":0,"assignments":{}}').assignments).length === 0,
);

console.log('\n[stability] reorder / add / delete / cross-zone move');
const initialPositions = placements(initialRoster, initial);
const reorderedRoster = [employee('emp-c'), employee('emp-d'), employee('emp-b')];
const reordered = reconcileSeatSlotRegistry(reorderedRoster, ZONES, FALLBACK_ZONE, decoded);
check(
  'roster reorder preserves every slot',
  JSON.stringify(slots(reordered)) === JSON.stringify(slots(initial)),
  JSON.stringify(slots(reordered)),
);
check(
  'roster reorder preserves every coordinate',
  samePoints(initialPositions, placements(reorderedRoster, reordered), ['emp-b', 'emp-c', 'emp-d']),
);

const addedRoster = [employee('emp-a'), ...reorderedRoster];
const added = reconcileSeatSlotRegistry(addedRoster, ZONES, FALLBACK_ZONE, reordered);
check('smaller-id hire takes the next free slot', slots(added)['emp-a'] === 'zone-a:3');
check(
  'smaller-id hire does not move incumbents',
  samePoints(initialPositions, placements(addedRoster, added), ['emp-b', 'emp-c', 'emp-d']),
);

const deletedRoster = addedRoster.filter((item) => item.id !== 'emp-c');
const deleted = reconcileSeatSlotRegistry(deletedRoster, ZONES, FALLBACK_ZONE, added);
check(
  'deletion removes only the deleted assignment',
  !deleted.assignments['emp-c'] &&
    slots(deleted)['emp-b'] === 'zone-a:0' &&
    slots(deleted)['emp-d'] === 'zone-a:2',
  JSON.stringify(slots(deleted)),
);
check(
  'deletion does not compact or move remaining coordinates',
  samePoints(placements(addedRoster, added), placements(deletedRoster, deleted), [
    'emp-a',
    'emp-b',
    'emp-d',
  ]),
);

const refilledRoster = [...deletedRoster, employee('emp-e')];
const refilled = reconcileSeatSlotRegistry(refilledRoster, ZONES, FALLBACK_ZONE, deleted);
check('new hire reuses the lowest vacant slot', slots(refilled)['emp-e'] === 'zone-a:1');
check(
  'vacant-slot reuse does not move incumbents',
  samePoints(placements(deletedRoster, deleted), placements(refilledRoster, refilled), [
    'emp-a',
    'emp-b',
    'emp-d',
  ]),
);

const movedRoster = refilledRoster.map((item) =>
  item.id === 'emp-b' ? employee(item.id, 'zone-b') : item,
);
const moved = reconcileSeatSlotRegistry(movedRoster, ZONES, FALLBACK_ZONE, refilled);
check(
  'explicit zone move changes only the moved employee assignment',
  slots(moved)['emp-b'] === 'zone-b:0',
);
check(
  'another employee changing zone leaves all unaffected seats still',
  samePoints(placements(refilledRoster, refilled), placements(movedRoster, moved), [
    'emp-a',
    'emp-d',
    'emp-e',
  ]),
);
const reloaded = reconcileSeatSlotRegistry(
  [...movedRoster].reverse(),
  ZONES,
  FALLBACK_ZONE,
  parseSeatSlotRegistry(serializeSeatSlotRegistry(moved)),
);
check(
  'same memberships reload to the same cross-session slots',
  JSON.stringify(slots(reloaded)) === JSON.stringify(slots(moved)),
  JSON.stringify(slots(reloaded)),
);
const fullZoneRoster = Array.from({ length: 16 }, (_, index) =>
  employee(`emp-${index.toString().padStart(2, '0')}`),
);
const fullZone = reconcileSeatSlotRegistry(fullZoneRoster, ZONES, FALLBACK_ZONE, {
  version: 1,
  assignments: {},
});
check(
  'the supported 16-employee office receives 16 unique slots',
  new Set(Object.values(fullZone.assignments).map((seat) => `${seat.zoneId}:${seat.slot}`)).size ===
    16,
);
let capacityError = '';
assertCompanyEmployeeCapacity(15);
try {
  assertCompanyEmployeeCapacity(16);
} catch (error) {
  capacityError = error instanceof Error ? error.message : String(error);
}
check(
  'the authoritative create boundary rejects a 17th employee explicitly',
  capacityError === EMPLOYEE_CAPACITY_MESSAGE,
  capacityError,
);
let registryOverflowRejected = false;
try {
  reconcileSeatSlotRegistry(
    [...fullZoneRoster, employee('emp-16')],
    ZONES,
    FALLBACK_ZONE,
    fullZone,
  );
} catch {
  registryOverflowRejected = true;
}
check('registry overflow rejects instead of sharing slot 15', registryOverflowRejected);

console.log('\n[movement state machine] executable choreography');
const start = [0, 0] as const;
const target = [4, 0] as const;
const routed = [[1.5, 1], target] as const;
const standardMove = planCharacterMove({
  start,
  target,
  origin: 'settled',
  currentPhase: 'idle',
  reducedMotion: false,
  pathfinderAvailable: true,
  routedWaypoints: routed,
});
check(
  'settled target change starts atomic sit.exit before translation',
  standardMove.phase === 'sit-exit' && standardMove.waypoints === routed,
);
check(
  'target replan cannot skip an in-flight sit.exit',
  planCharacterMove({
    start,
    target,
    origin: 'settled',
    currentPhase: 'sit-exit',
    reducedMotion: false,
    pathfinderAvailable: true,
    routedWaypoints: routed,
  }).phase === 'sit-exit',
);
check(
  'standing-anchor return promotes directly to walk, seated departure waits for mixer finish',
  shouldPromoteSitExit('sit-exit', 'stand', false) &&
    !shouldPromoteSitExit('sit-exit', 'sit', false) &&
    !shouldPromoteSitExit('sit-exit', 'stand', true),
);
check(
  'drop fallback and new-hire entry both start from explicit standing sources',
  (['drop-return', 'entry'] as const).every(
    (origin) =>
      planCharacterMove({
        start,
        target,
        origin,
        currentPhase: 'idle',
        reducedMotion: false,
        pathfinderAvailable: true,
        routedWaypoints: routed,
      }).phase === 'walk',
  ),
);
check(
  'reduced motion snaps at any phase',
  ['idle', 'sit-exit', 'walk'].every((currentPhase) => {
    const plan = planCharacterMove({
      start,
      target,
      origin: 'settled',
      currentPhase: currentPhase as 'idle' | 'sit-exit' | 'walk',
      reducedMotion: true,
      pathfinderAvailable: true,
      routedWaypoints: routed,
    });
    return plan.phase === 'idle' && plan.snapToTarget;
  }),
);
check(
  'straight fallback exists only when the pathfinder is absent',
  planCharacterMove({
    start,
    target,
    origin: 'settled',
    currentPhase: 'idle',
    reducedMotion: false,
    pathfinderAvailable: false,
    routedWaypoints: null,
  }).waypoints.length === 1 &&
    planCharacterMove({
      start,
      target,
      origin: 'settled',
      currentPhase: 'idle',
      reducedMotion: false,
      pathfinderAvailable: true,
      routedWaypoints: null,
    }).blocked,
);
const typingWithLaptop = {
  locomotion: 'idle',
  posture: 'sit',
  workGesture: 'type',
  socialGesture: 'none',
  expression: 'focus',
  prop: 'laptop',
  intensity: 1,
} as const;
check(
  'sit.exit selection is invariant while walk keeps carry semantics',
  clipForPerformance(performanceForMovementPhase(typingWithLaptop, 'sit-exit')).clip === 'idle' &&
    clipForPerformance(performanceForMovementPhase(typingWithLaptop, 'walk')).clip === 'carry',
);

console.log('\n[production wiring] shared source + visible move choreography');
const [sharedHook, scene2d, scene3d, character, playback, queries, employeeRepo] =
  await Promise.all([
    readFile(
      new URL(
        '../apps/desktop/renderer/src/surfaces/office/scene/use-scene-staging-inputs.ts',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(
      new URL(
        '../apps/desktop/renderer/src/surfaces/office/scene/OfficeScene2D.tsx',
        import.meta.url,
      ),
      'utf8',
    ),
    Promise.all([
      readFile(
        new URL(
          '../apps/desktop/renderer/src/surfaces/office/scene/OfficeScene3D.tsx',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(
        new URL(
          '../apps/desktop/renderer/src/surfaces/office/scene/use-employee-drag.ts',
          import.meta.url,
        ),
        'utf8',
      ),
    ]).then((sources) => sources.join('\n')),
    readFile(
      new URL(
        '../apps/desktop/renderer/src/surfaces/office/scene/character/GltfCharacter.tsx',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(
      new URL(
        '../apps/desktop/renderer/src/surfaces/office/scene/character/character-playback.ts',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(new URL('../apps/desktop/renderer/src/data/queries.ts', import.meta.url), 'utf8'),
    readFile(
      new URL('../apps/desktop/renderer/src/lib/tauri-repos/employees.ts', import.meta.url),
      'utf8',
    ),
  ]);
check(
  'shared hook reconciles and persists seat slots before employeePlacements',
  sharedHook.includes('reconcileSeatSlotRegistry') &&
    sharedHook.includes('writeSeatSlotRegistry') &&
    /employeePlacements\([\s\S]*seatSlotRegistry/.test(sharedHook),
);
check(
  'pending/company-switch queries suppress roster and zones until both sources are ready',
  sharedHook.includes('const ready = employees.isSuccess && layout.isSuccess') &&
    sharedHook.includes('ready ? (employees.data ?? []) : []') &&
    sharedHook.includes('ready ? zoneDefsFromLayout(layoutData) : []'),
);
check(
  '2D and 3D both consume the same useSceneStagingInputs positions',
  scene2d.includes('useSceneStagingInputs()') &&
    scene3d.includes('useSceneStagingInputs()') &&
    !scene2d.includes('employeePlacements(') &&
    !scene3d.includes('employeePlacements('),
);
check(
  'seat moves retain A* routing and explicit sit-exit/walk/sit-enter phases',
  scene3d.includes('planCharacterMove') &&
    character.includes('shouldPromoteSitExit') &&
    character.includes('requestCharacterPlayback') &&
    character.includes('finishCharacterPlayback') &&
    playback.includes('POSTURE_TRANSITION_CLIPS.sitExit') &&
    playback.includes('POSTURE_TRANSITION_CLIPS.sitEnter'),
);
check(
  'non-reassign drops walk from the ghost; a real zone change starts at the original seat',
  scene3d.includes('returnFromDrop') &&
    scene3d.includes('!changesZone') &&
    scene3d.includes('if (changesZone && result.zoneId)'),
);
check(
  'zone reassign commits shared cache only after repository success',
  queries.includes('onSuccess: ({ employeeId, zoneId, persisted })') &&
    queries.includes("setQueryData<Employee[]>(['employees', companyId]") &&
    !queries.includes('previousEmployees'),
);
check(
  'the renderer repository enforces the same 16-employee capacity',
  employeeRepo.includes('assertCompanyEmployeeCapacity') && employeeRepo.includes('count(*)'),
);

console.log(`\noffice-seating-p2: ${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`office-seating-p2 gate FAILED with ${failures} failure(s)`);
  process.exit(1);
}
console.log('office-seating-p2 gate PASSED');
