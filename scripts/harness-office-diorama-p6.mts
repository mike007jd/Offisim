import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  SYSTEM_ZONE_TEMPLATES,
  getBuiltinPrefabFootprint,
  getSystemZoneDefaultPrefabs,
} from '@offisim/shared-types';
import {
  countDioramaFloorProps,
  buildDioramaDressingPoints,
  dioramaDressingPropBudget,
  DIORAMA_DRESSING_PROPS_PER_ZONE,
  DIORAMA_FLOOR_PROP_MAX,
  DIORAMA_FLOOR_PROP_MIN,
} from '../apps/desktop/renderer/src/surfaces/office/scene/r3d/DioramaDressing.tsx';
import {
  FLOOR_BANDS,
  OFFICE_PLINTH,
  OFFICE_ROOM,
  SCENE_CONTENT_SCALE,
} from '../apps/desktop/renderer/src/surfaces/office/scene/r3d/scene-art-direction.ts';
import { createRoundedSlabGeometry } from '../apps/desktop/renderer/src/surfaces/office/scene/r3d/RoundedSlab.tsx';
import {
  OFFICE_CHARACTER_METRICS,
  WORKSTATION_FOOTPRINT_RADIUS,
  WORKSTATION_GEOMETRY_METRICS,
  WORKSTATION_VERTICAL_METRICS,
} from '../apps/desktop/renderer/src/surfaces/office/scene/workstation-geometry.ts';
import {
  type SeatAnchorPrefab,
  sceneObstacles,
} from '../apps/desktop/renderer/src/surfaces/office/scene/scene-layout.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFile(`${root}/${path}`, 'utf8');
let passed = 0;

function check(label: string, condition: unknown): asserts condition {
  assert.ok(condition, label);
  passed += 1;
  console.log(`✓ ${label}`);
}

const [
  roomSource,
  zoneSource,
  officeSource,
  studioSource,
  annotationSource,
  dressingSource,
  backdropSource,
  lightingSource,
  postFxSource,
  artBible,
] = await Promise.all([
  read('apps/desktop/renderer/src/surfaces/office/scene/r3d/RoomShell.tsx'),
  read('apps/desktop/renderer/src/surfaces/office/scene/r3d/ZoneDressing.tsx'),
  read('apps/desktop/renderer/src/surfaces/office/scene/OfficeScene3D.tsx'),
  read('apps/desktop/renderer/src/surfaces/studio/StudioScene3D.tsx'),
  read('apps/desktop/renderer/src/surfaces/office/scene/r3d/SceneAnnotation.tsx'),
  read('apps/desktop/renderer/src/surfaces/office/scene/r3d/DioramaDressing.tsx'),
  read('apps/desktop/renderer/src/surfaces/office/scene/r3d/DioramaBackdrop.tsx'),
  read('apps/desktop/renderer/src/surfaces/office/scene/r3d/SceneLighting.tsx'),
  read('apps/desktop/renderer/src/surfaces/office/scene/r3d/ScenePostFx.tsx'),
  read('Docs/design/office-art-bible.md'),
]);

check(
  'RoomShell is a thick bevel-edged display plinth',
  roomSource.includes('RoundedSlab') && OFFICE_PLINTH.baseHeight === 0.52,
);
check(
  'production room has no interior glass partition implementation',
  !roomSource.includes('GlassRun'),
);
check(
  'production room has no back wall panel implementation',
  !roomSource.includes('BackWallPanels'),
);
check(
  'production room has no side wall or window implementation',
  !roomSource.includes('SideWallWindows'),
);
check('production room has no wall-height plane', !roomSource.includes('wallHeight'));
check('plinth keeps a real floor click surface', roomSource.includes('onFloorClick?.()'));
check(
  'plinth keeps major and minor floor-grid hierarchy',
  roomSource.includes("createTileLineColor(sc, 'minor')") &&
    roomSource.includes("createTileLineColor(sc, 'major')"),
);
const baseTop = OFFICE_PLINTH.baseCenterY + OFFICE_PLINTH.baseHeight / 2;
const lipBottom = OFFICE_PLINTH.lipCenterY - OFFICE_PLINTH.lipHeight / 2;
const lipTop = OFFICE_PLINTH.lipCenterY + OFFICE_PLINTH.lipHeight / 2;
check(
  'plinth base meets lip without coplanar top faces',
  Math.abs(baseTop - lipBottom) < 1e-9 && lipTop > baseTop,
);
check('floor plane sits strictly above the plinth lip', OFFICE_PLINTH.floorY > lipTop);
check(
  'every floor band sits strictly above the click plane',
  FLOOR_BANDS.every((band) => band.layerOffset > OFFICE_PLINTH.floorY),
);
check(
  'floor bands use distinct vertical layers',
  new Set(FLOOR_BANDS.map((band) => band.layerOffset)).size === FLOOR_BANDS.length,
);
check('zone identity uses thin rounded rugs', zoneSource.includes('height={0.04}'));
check('zone rug production path contains no glass divider', !zoneSource.includes('showGlass'));
check(
  'Office does not mount ceiling-dependent zone lights',
  !officeSource.includes('<ZoneCeilingLight'),
);
check(
  'Office mounts one prefab-budgeted diorama dressing layer with the real prefab count',
  /<DioramaDressing\s+zones=\{zoneDefs\}\s+prefabCount=\{scenePrefabs\?\.length \?\? 0\}\s*\/>/.test(
    officeSource,
  ),
);
check(
  'Office labels use one camera-safe annotation primitive',
  officeSource.includes('<SceneAnnotation') &&
    zoneSource.includes('<SceneAnnotation') &&
    !officeSource.includes('<Html') &&
    !zoneSource.includes('<Html'),
);
check(
  'scene annotations have bounded readable scale profiles',
  annotationSource.includes("critical: { fullOpacityDistance: 48") &&
    annotationSource.includes('minScale: 0.8') &&
    annotationSource.includes('minScale: 0.9'),
);
check(
  'scene annotations depth-test real geometry and ignore transparent pointer hitboxes',
  annotationSource.includes('intersectObjects(scene.children, true)') &&
    annotationSource.includes('entry.opacity >= 0.24') &&
    annotationSource.includes('objectHierarchyIsVisible') &&
    annotationSource.includes("'isMesh' in object") &&
    !annotationSource.includes('occlude={false}'),
);
check(
  'annotation occlusion uses one bounded per-frame scheduler',
  annotationSource.includes('export function SceneAnnotationScheduler') &&
    annotationSource.includes('OCCLUSION_BUDGET_PER_FRAME = 4') &&
    annotationSource.match(/useFrame\(/g)?.length === 1 &&
    officeSource.includes('<SceneAnnotationScheduler />') &&
    studioSource.includes('<SceneAnnotationScheduler />') &&
    !annotationSource.includes('samplers.clear()') &&
    !annotationSource.includes('ANNOTATION_REGISTRIES.delete'),
);
check(
  'annotation rays stop at the label instead of sorting geometry behind it',
  annotationSource.includes('raycaster.far = Math.max(0, anchorDistance - OCCLUSION_EPSILON)'),
);
check(
  'occluded interactive annotations are hidden and inert before first sample',
  annotationSource.includes('hasOcclusionSampleRef.current') &&
    annotationSource.includes('useState(false)') &&
    annotationSource.includes('hidden={!visible}') &&
    annotationSource.includes('inert={!visible}') &&
    annotationSource.includes('aria-hidden={!visible}'),
);
check(
  'annotation semantic priority owns separate z-index bands',
  annotationSource.includes('ambient: [4, 2]') &&
    annotationSource.includes('actor: [8, 5]') &&
    annotationSource.includes('critical: [12, 9]') &&
    annotationSource.includes('key={priority}'),
);
check(
  'backdrop is a closed gradient sphere',
  backdropSource.includes('<sphereGeometry') && backdropSource.includes('smoothstep'),
);
check(
  'backdrop renders inward for arbitrary orbit angles',
  backdropSource.includes('side={BackSide}'),
);
check(
  'backdrop writes no depth over scene geometry',
  backdropSource.includes('depthWrite={false}'),
);
check(
  'backdrop follows the camera through unbounded legal pan',
  backdropSource.includes('position.copy(camera.position)') &&
    backdropSource.includes('ref={backdropRef}'),
);
check(
  'dressing contract adds exactly four low props per zone',
  DIORAMA_DRESSING_PROPS_PER_ZONE === 4,
);
check(
  'repeated diorama dressing is instanced',
  (dressingSource.match(/<instancedMesh/g) ?? []).length === 4,
);
check('dressing has no semantic interaction anchors', !dressingSource.includes('affordance'));

const plinthGeometry = createRoundedSlabGeometry(43.35, 43.35, 0.52, 0.46, 0.12);
const rugGeometry = createRoundedSlabGeometry(10, 8, 0.04, 0.28, 0.012);
const plinthSize = plinthGeometry.boundingBox?.getSize(new (await import('three')).Vector3());
const rugSize = rugGeometry.boundingBox?.getSize(new (await import('three')).Vector3());
check(
  'plinth bevel preserves requested X/Y/Z envelope',
  Boolean(
    plinthSize &&
      Math.abs(plinthSize.x - 43.35) < 0.001 &&
      Math.abs(plinthSize.y - 0.52) < 0.001 &&
      Math.abs(plinthSize.z - 43.35) < 0.001,
  ),
);
check(
  'thin rug bevel preserves requested X/Y/Z envelope',
  Boolean(
    rugSize &&
      Math.abs(rugSize.x - 10) < 0.001 &&
      Math.abs(rugSize.y - 0.04) < 0.001 &&
      Math.abs(rugSize.z - 8) < 0.001,
  ),
);
plinthGeometry.dispose();
rugGeometry.dispose();

const layouts = SYSTEM_ZONE_TEMPLATES.map((zone) => ({
  zone,
  prefabs: getSystemZoneDefaultPrefabs(zone, { occupiedSeats: zone.deskSlots }),
}));
const prefabCount = layouts.reduce((sum, entry) => sum + entry.prefabs.length, 0);
const canonicalZoneDefs = SYSTEM_ZONE_TEMPLATES.map((zone) => ({
  id: zone.slug,
  label: zone.label,
  archetype: zone.archetype,
  cx: zone.cx,
  cz: zone.cz,
  w: zone.w,
  d: zone.d,
}));
const canonicalDressing = buildDioramaDressingPoints(canonicalZoneDefs, prefabCount);
const floorPropCount = countDioramaFloorProps(canonicalZoneDefs, prefabCount);
check('system office keeps seven canonical zones', SYSTEM_ZONE_TEMPLATES.length === 7);
check(
  'open diorama floor prop count reaches 50-100',
  floorPropCount >= DIORAMA_FLOOR_PROP_MIN && floorPropCount <= DIORAMA_FLOOR_PROP_MAX,
);
check('floor prop contract resolves to 61 current props', floorPropCount === 61);
check(
  'floor prop count consumes the rendered dressing list',
  floorPropCount === prefabCount + canonicalDressing.length,
);
check(
  'dressing slot count is generated from the shared slot template',
  canonicalDressing.length === SYSTEM_ZONE_TEMPLATES.length * DIORAMA_DRESSING_PROPS_PER_ZONE,
);
check(
  'custom layouts cannot exceed the total floor-prop maximum',
  dioramaDressingPropBudget(40, 75) === 25,
);
check('prefab-heavy layouts suppress decorative dressing', dioramaDressingPropBudget(7, 100) === 0);

const characterHeight = OFFICE_CHARACTER_METRICS.height;
check(
  'chair seat derives to toy hip-scale range',
  WORKSTATION_VERTICAL_METRICS.seatTop / characterHeight > 0.24 &&
    WORKSTATION_VERTICAL_METRICS.seatTop / characterHeight < 0.28,
);
check(
  'desk top derives to toy elbow-scale range',
  WORKSTATION_VERTICAL_METRICS.deskTop / characterHeight > 0.45 &&
    WORKSTATION_VERTICAL_METRICS.deskTop / characterHeight < 0.5,
);
check(
  'display width remains toy-scale',
  WORKSTATION_GEOMETRY_METRICS.laptopWidth / characterHeight > 0.22 &&
    WORKSTATION_GEOMETRY_METRICS.laptopWidth / characterHeight < 0.28,
);
check(
  'compact desk is narrower than standard desk',
  WORKSTATION_GEOMETRY_METRICS.compactDeskWidth < WORKSTATION_GEOMETRY_METRICS.standardDeskWidth,
);
check(
  'dual and standard footprints share canonical desk envelope',
  Math.abs(WORKSTATION_FOOTPRINT_RADIUS.dual - WORKSTATION_FOOTPRINT_RADIUS.standard) < 1e-9,
);
check(
  'compact footprint is smaller than standard footprint',
  WORKSTATION_FOOTPRINT_RADIUS.compact < WORKSTATION_FOOTPRINT_RADIUS.standard,
);

function anchorPrefab(
  zoneId: string,
  prefab: { prefabId: string; offsetX: number; offsetZ: number; rotation?: number },
): SeatAnchorPrefab {
  return {
    instance: {
      zone_id: zoneId,
      prefab_id: prefab.prefabId,
      position_x: prefab.offsetX,
      position_y: prefab.offsetZ,
      rotation: prefab.rotation ?? 0,
    },
    definition: { prefabId: prefab.prefabId },
  };
}

const sofaFootprint = getBuiltinPrefabFootprint('sofa-set');
const sofaObstacle = sceneObstacles([
  anchorPrefab('zone-rest', { prefabId: 'sofa-set', offsetX: 0, offsetZ: 0 }),
])[0];
const expectedSofaRadius = Math.hypot(
  sofaFootprint.halfW + sofaFootprint.padding,
  sofaFootprint.halfD + sofaFootprint.padding,
);
check(
  'non-workstation navigation envelope derives from shared prefab spatial metadata',
  Boolean(sofaObstacle && Math.abs(sofaObstacle.radius - expectedSofaRadius) < 1e-9),
);

for (const { zone, prefabs } of layouts.filter((entry) => entry.zone.archetype === 'workspace')) {
  const workstationPrefabs = prefabs.filter((prefab) => prefab.prefabId.startsWith('workstation-'));
  const obstacles = sceneObstacles(
    workstationPrefabs.map((prefab) => anchorPrefab(zone.slug, prefab)),
  );
  for (let left = 0; left < obstacles.length; left += 1) {
    for (let right = left + 1; right < obstacles.length; right += 1) {
      const a = obstacles[left];
      const b = obstacles[right];
      if (!a || !b) continue;
      const distance = Math.hypot(a.x - b.x, a.z - b.z);
      check(
        `${zone.slug} scaled workstation envelopes do not overlap`,
        distance > a.radius + b.radius,
      );
    }
  }
}

check(
  'content scale remains inside guarded diorama band',
  SCENE_CONTENT_SCALE >= 1 && SCENE_CONTENT_SCALE <= 1.2,
);
check(
  'platform contains every canonical zone bound',
  SYSTEM_ZONE_TEMPLATES.every(
    (zone) =>
      Math.abs(zone.cx) + zone.w / 2 <= OFFICE_ROOM.width / 2 &&
      Math.abs(zone.cz) + zone.d / 2 <= OFFICE_ROOM.depth / 2,
  ),
);
check(
  'lighting fog begins outside the main furnishing span',
  lightingSource.includes('args={[sc.sceneBackground, 46, 118]}'),
);
check(
  'post processing uses half-resolution ambient occlusion',
  /<N8AO[\s\S]*?\shalfRes\s*[\/>]/.test(postFxSource) && !postFxSource.includes('halfRes={false}'),
);
check('post processing preserves SMAA', postFxSource.includes('<SMAA />'));
check(
  'Canvas keeps the approved full-view DPR budget and pins PiP to DPR 1',
  /dpr=\{pip \? 1 : \[1, 1\.75\]\}/.test(officeSource),
);
check(
  'PiP disables shadows and post processing without unmounting the scene',
  officeSource.includes("shadows={pip ? false : 'soft'}") &&
    officeSource.includes('{pip ? null : <ScenePostFx />}'),
);
check(
  'Canvas keeps one explicit continuous animation frame prop',
  (officeSource.match(/frameloop="always"/g) ?? []).length === 1 &&
    /<Canvas[\s\S]*?frameloop="always"[\s\S]*?>/.test(officeSource),
);
check(
  'art bible records final P6 plinth contract',
  artBible.includes('P6 final environment contract'),
);
check('art bible records the 50-100 floor prop budget', artBible.includes('50–100'));
check('art bible records instancing policy', artBible.includes('InstancedMesh'));

console.log(
  `office diorama P6 harness: ${passed}/${passed} passed (${floorPropCount} floor props)`,
);
