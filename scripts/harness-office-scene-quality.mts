import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { CHARACTER_INDICATOR_GEOMETRY } from '../apps/desktop/renderer/src/surfaces/office/scene/office-visual-language.ts';
import { SCENE_KEY_LIGHT } from '../apps/desktop/renderer/src/surfaces/office/scene/r3d/SceneLighting.tsx';
import {
  FLOOR_BANDS,
  FLOOR_RENDER_ORDER,
  OFFICE_CAMERA_DEPTH,
  OFFICE_CAMERA_PRESET,
  OFFICE_PLINTH,
  OFFICE_ROOM,
  PREFAB_LOCAL_GROUND_Y,
  SCENE_CONTENT_SCALE,
  SCENE_LAYER_Y,
  ZONE_RUG_PROFILE,
} from '../apps/desktop/renderer/src/surfaces/office/scene/r3d/scene-art-direction.ts';
import { getDustNormalTexture } from '../apps/desktop/renderer/src/surfaces/office/scene/r3d/scene-textures.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFile(`${root}/${path}`, 'utf8');
let passed = 0;
const EXPECTED_CHECKS = 68;

function check(label: string, condition: unknown): asserts condition {
  assert.ok(condition, label);
  passed += 1;
  console.log(`✓ ${label}`);
}

function occurrences(source: string, token: string): number {
  return source.split(token).length - 1;
}

function numericConstant(source: string, name: string): number {
  return Number(source.match(new RegExp(`const ${name} = ([\\d.]+);`))?.[1] ?? Number.NaN);
}

/** Mirrors drei 10.7 RoundedBox's public geometry contract for a real bbox regression probe. */
function roundedBoxProbeSize(
  [width, height, depth]: [number, number, number],
  radius: number,
): THREE.Vector3 {
  const epsilon = 0.00001;
  const curveRadius = radius - epsilon;
  const shape = new THREE.Shape();
  shape.absarc(epsilon, epsilon, epsilon, -Math.PI / 2, -Math.PI, true);
  shape.absarc(epsilon, height - curveRadius * 2, epsilon, Math.PI, Math.PI / 2, true);
  shape.absarc(width - curveRadius * 2, height - curveRadius * 2, epsilon, Math.PI / 2, 0, true);
  shape.absarc(width - curveRadius * 2, epsilon, epsilon, 0, -Math.PI / 2, true);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: depth - radius * 2,
    bevelEnabled: true,
    bevelSegments: 8,
    steps: 1,
    bevelSize: radius - epsilon,
    bevelThickness: radius,
    curveSegments: 4,
  });
  geometry.center();
  geometry.computeBoundingBox();
  const size = geometry.boundingBox?.getSize(new THREE.Vector3()) ?? new THREE.Vector3();
  geometry.dispose();
  return size;
}

const paths = {
  office: 'apps/desktop/renderer/src/surfaces/office/scene/OfficeScene3D.tsx',
  studio: 'apps/desktop/renderer/src/surfaces/studio/StudioScene3D.tsx',
  room: 'apps/desktop/renderer/src/surfaces/office/scene/r3d/RoomShell.tsx',
  rug: 'apps/desktop/renderer/src/surfaces/office/scene/r3d/ZoneDressing.tsx',
  backdrop: 'apps/desktop/renderer/src/surfaces/office/scene/r3d/DioramaBackdrop.tsx',
  lighting: 'apps/desktop/renderer/src/surfaces/office/scene/r3d/SceneLighting.tsx',
  environment: 'apps/desktop/renderer/src/surfaces/office/scene/r3d/SceneEnvironment.tsx',
  indicators: 'apps/desktop/renderer/src/surfaces/office/scene/character/indicators.tsx',
  surfaceMaterials:
    'apps/desktop/renderer/src/surfaces/office/scene/r3d/scene-surface-materials.tsx',
  sceneTextures: 'apps/desktop/renderer/src/surfaces/office/scene/r3d/scene-textures.ts',
  rackTexture: 'apps/desktop/renderer/src/surfaces/office/scene/r3d/server-rack-lod-texture.ts',
  workstation: 'apps/desktop/renderer/src/surfaces/office/scene/r3d/prefabs/WorkstationMesh3D.tsx',
  meeting: 'apps/desktop/renderer/src/surfaces/office/scene/r3d/prefabs/MeetingTableMesh3D.tsx',
  bookshelf: 'apps/desktop/renderer/src/surfaces/office/scene/r3d/prefabs/BookshelfMesh3D.tsx',
  infrastructure:
    'apps/desktop/renderer/src/surfaces/office/scene/r3d/prefabs/InfrastructureMesh3D.tsx',
  serverRack: 'apps/desktop/renderer/src/surfaces/office/scene/r3d/prefabs/ServerRackMesh3D.tsx',
  decorative: 'apps/desktop/renderer/src/surfaces/office/scene/r3d/prefabs/DecorativeMesh3D.tsx',
  whiteboard: 'apps/desktop/renderer/src/surfaces/office/scene/r3d/prefabs/WhiteboardMesh3D.tsx',
  restArea: 'apps/desktop/renderer/src/surfaces/office/scene/r3d/prefabs/RestAreaMesh3D.tsx',
} as const;

const entries = await Promise.all(
  Object.entries(paths).map(async ([key, path]) => [key, await read(path)] as const),
);
const source = Object.fromEntries(entries) as Record<keyof typeof paths, string>;
const rackUnitSource =
  source.serverRack.match(
    /export function ServerRackUnit3D[\s\S]*?export function ServerRackMesh3D/,
  )?.[0] ?? '';

console.log('\noffice scene quality gate\n');

// Camera precision is a shared product contract, not a renderer default.
check('camera near plane is explicitly tightened to 0.75', OFFICE_CAMERA_DEPTH.near === 0.75);
check('camera far plane is explicitly bounded at 180', OFFICE_CAMERA_DEPTH.far === 180);
check(
  'camera far/near ratio stays within the 300:1 precision budget',
  OFFICE_CAMERA_DEPTH.far / OFFICE_CAMERA_DEPTH.near <= 300,
);
check(
  'far plane covers the complete legal orbit with margin',
  OFFICE_CAMERA_DEPTH.far >= OFFICE_CAMERA_PRESET.maxDistance * 2.25,
);
const backdropRadius = Number(
  source.backdrop.match(/DIORAMA_BACKDROP_RADIUS\s*=\s*([\d.]+)/)?.[1] ?? Number.NaN,
);
check('far plane covers the camera-follow backdrop', OFFICE_CAMERA_DEPTH.far > backdropRadius);
const depthBins = 2 ** 24 - 1;
const farOrbitDepthQuantum =
  ((OFFICE_CAMERA_DEPTH.far - OFFICE_CAMERA_DEPTH.near) /
    (OFFICE_CAMERA_DEPTH.far * OFFICE_CAMERA_DEPTH.near)) *
  (OFFICE_CAMERA_PRESET.maxDistance ** 2 / depthBins);
check(
  '24-bit depth precision at max orbit stays below 0.0005 world units',
  farOrbitDepthQuantum < 0.0005,
);
for (const [surface, canvasSource] of [
  ['Office', source.office],
  ['Studio', source.studio],
] as const) {
  check(
    `${surface} explicitly passes the shared near plane`,
    canvasSource.includes('near: OFFICE_CAMERA_DEPTH.near'),
  );
  check(
    `${surface} explicitly passes the shared far plane`,
    canvasSource.includes('far: OFFICE_CAMERA_DEPTH.far'),
  );
  check(
    `${surface} full scene renders up to DPR 2`,
    canvasSource.includes('dpr={pip ? 1 : [1, 2]}') || canvasSource.includes('dpr={[1, 2]}'),
  );
  check(
    `${surface} does not enable logarithmic or reversed depth fallbacks`,
    !canvasSource.includes('logarithmicDepthBuffer') &&
      !canvasSource.includes('reversedDepthBuffer'),
  );
}

// Floor decoration is one deterministic non-depth-writing overlay stack.
check(
  'floor decoration no longer owns millimetre layer offsets',
  FLOOR_BANDS.every((band) => !('layerOffset' in band)),
);
check(
  'floor overlays share the real click-plane height',
  SCENE_LAYER_Y.floorOverlay === OFFICE_PLINTH.floorY,
);
const floorOrders = Object.values(FLOOR_RENDER_ORDER);
check('floor render-order tiers are unique', new Set(floorOrders).size === floorOrders.length);
check(
  'floor render-order tiers are strictly front-to-back',
  floorOrders.every(
    (value, index) => index === 0 || value > (floorOrders[index - 1] ?? Number.NEGATIVE_INFINITY),
  ),
);
check(
  'floor bands disable depth tests instead of competing with the floor',
  source.room.includes('<meshStandardMaterial') &&
    occurrences(source.room, 'depthTest={false}') >= 3,
);
check(
  'floor bands and both grids never write depth',
  occurrences(source.room, 'depthWrite={false}') >= 3,
);
check(
  'floor overlay ordering is sourced from one shared contract',
  occurrences(source.room, 'FLOOR_RENDER_ORDER.') >= 4,
);

// Rug layers meet exactly and never occupy the same volume.
const baseBottom = ZONE_RUG_PROFILE.baseCenterY - ZONE_RUG_PROFILE.baseHeight / 2;
const baseTop = ZONE_RUG_PROFILE.baseCenterY + ZONE_RUG_PROFILE.baseHeight / 2;
const insetBottom = ZONE_RUG_PROFILE.insetCenterY - ZONE_RUG_PROFILE.insetHeight / 2;
const insetTop = ZONE_RUG_PROFILE.insetCenterY + ZONE_RUG_PROFILE.insetHeight / 2;
check(
  'rug base starts on the shared floor surface',
  Math.abs(baseBottom - OFFICE_PLINTH.floorY) < 1e-9,
);
check('rug base top exactly meets inset bottom', Math.abs(baseTop - insetBottom) < 1e-9);
check(
  'rug profile top matches the rendered inset top',
  Math.abs(insetTop - ZONE_RUG_PROFILE.topY) < 1e-9,
);
check(
  'ZoneRug consumes only the shared vertical profile',
  occurrences(source.rug, 'ZONE_RUG_PROFILE.') >= 5,
);
check('RestArea no longer duplicates the zone rug', !source.restArea.includes('<planeGeometry'));
check(
  'scaled prefab ground contact resolves exactly to the rug top',
  Math.abs(PREFAB_LOCAL_GROUND_Y * SCENE_CONTENT_SCALE - ZONE_RUG_PROFILE.topY) < 1e-9,
);
check(
  'cable tray bottom consumes the prefab-local ground contract',
  source.infrastructure.includes('PREFAB_LOCAL_GROUND_Y + CABLE_TRAY_HEIGHT / 2'),
);
check(
  'server cable-channel bottom consumes the prefab-local ground contract',
  source.serverRack.includes('PREFAB_LOCAL_GROUND_Y + RACK_CABLE_CHANNEL_HEIGHT / 2'),
);

// Intentional coplanar details must opt into an unweakenable decal contract.
check(
  'SceneDecalMaterial exists as an opt-in primitive',
  source.surfaceMaterials.includes('export function SceneDecalMaterial'),
);
check(
  'decal contract disables depth writes',
  source.surfaceMaterials.includes('depthWrite: false'),
);
check(
  'decal contract enables polygon offset',
  source.surfaceMaterials.includes('polygonOffset: true'),
);
check(
  'caller overrides are applied before the fixed decal contract',
  /\.\.\.overrides,[\s\S]*\.\.\.DECAL_DEPTH_CONTRACT/.test(source.surfaceMaterials),
);
check(
  'emissive decals disable depth writes',
  /EmissiveDecalMaterial[\s\S]*depthWrite=\{false\}/.test(source.surfaceMaterials),
);
check(
  'emissive decals retain raw HDR output',
  /EmissiveDecalMaterial[\s\S]*toneMapped=\{false\}/.test(source.surfaceMaterials),
);
check(
  'physical glass always renders transparently without writing depth',
  /SceneGlassMaterial[\s\S]*\.\.\.overrides,[\s\S]*transparent: true,[\s\S]*depthWrite: false/.test(
    source.surfaceMaterials,
  ),
);

const decalConsumers = [
  source.workstation,
  source.meeting,
  source.infrastructure,
  source.serverRack,
  source.decorative,
  source.whiteboard,
];
check(
  'all high-risk prefab families consume the shared decal contract',
  decalConsumers.every((value) => value.includes('DecalMaterial')),
);
check(
  'physical glass consumers use the shared transparent render-order tier',
  occurrences(source.workstation, 'renderOrder={SCENE_TRANSPARENT_RENDER_ORDER.glass}') ===
    occurrences(source.workstation, '<SceneGlassMaterial') &&
    occurrences(source.decorative, 'renderOrder={SCENE_TRANSPARENT_RENDER_ORDER.glass}') ===
      occurrences(source.decorative, '<SceneGlassMaterial'),
);
check(
  'physical glass never casts an opaque shadow silhouette',
  occurrences(source.workstation, 'castShadow={false}') ===
    occurrences(source.workstation, '<SceneGlassMaterial') &&
    occurrences(source.decorative, 'castShadow={false}') ===
      occurrences(source.decorative, '<SceneGlassMaterial'),
);
check(
  'workstation screens and notes use several explicit decals',
  occurrences(source.workstation, 'DecalMaterial') >= 6,
);
check(
  'server rack fronts, LEDs, vents and baked LOD use explicit depth treatment',
  occurrences(source.serverRack, 'DecalMaterial') >= 10 &&
    source.serverRack.includes('depthWrite={false}'),
);
check(
  'server racks use explicit hysteresis for both cluster and canonical-unit LODs',
  source.serverRack.includes('enterReducedDistance = 20') &&
    source.serverRack.includes('returnDetailDistance = 16') &&
    rackUnitSource.includes('enterReducedDistance: 48') &&
    rackUnitSource.includes('returnDetailDistance: 40'),
);
check(
  'canonical rack reduced LOD preserves PBR decals and never stretches the cluster atlas',
  rackUnitSource.includes('unit-reduced-vent') &&
    rackUnitSource.includes('unit-reduced-led') &&
    !rackUnitSource.includes('buildServerRackBakedTexture'),
);
check(
  'cable trays use real rounded geometry instead of transparent planes',
  source.infrastructure.includes('<RoundedBox') &&
    !/CableTrayMesh3D[\s\S]*?<planeGeometry/.test(
      source.infrastructure.match(
        /function CableTrayMesh3D[\s\S]*?function PatchPanelMesh3D/,
      )?.[0] ?? '',
    ),
);
check(
  'core work surfaces use real rounded thin bodies',
  source.workstation.includes('args={[width, WORK_SURFACE_MAT_THICKNESS, depth]}') &&
    source.workstation.includes('position={[0, WORK_SURFACE_MAT_THICKNESS / 2, 0]}') &&
    source.meeting.includes(
      'args={[isStanding ? 1.45 : tableWidth * 0.72, TABLE_MAT_THICKNESS, tableDepth * 0.56]}',
    ) &&
    source.meeting.includes('position={[0, tableSurfaceY + TABLE_MAT_THICKNESS / 2, 0]}') &&
    source.bookshelf.includes('args={[1.74, READING_MAT_THICKNESS, 0.68]}') &&
    source.bookshelf.includes(
      'position={[0, READING_TABLE_SURFACE_Y + READING_MAT_THICKNESS / 2, 0]}',
    ),
);
const tabletopThickness = numericConstant(source.meeting, 'TABLETOP_THICKNESS');
const tabletopRadius = numericConstant(source.meeting, 'TABLETOP_RADIUS');
check(
  'meeting tabletop radius fits inside half of its thinnest axis',
  tabletopRadius <= tabletopThickness / 2,
);
const tabletopProbeSize = roundedBoxProbeSize([6, tabletopThickness, 2.2], tabletopRadius);
check(
  'meeting tabletop RoundedBox bbox matches its authored dimensions',
  Math.abs(tabletopProbeSize.x - 6) < 0.001 &&
    Math.abs(tabletopProbeSize.y - tabletopThickness) < 0.001 &&
    Math.abs(tabletopProbeSize.z - 2.2) < 0.001,
);
const seatCushionThickness = numericConstant(source.restArea, 'SEAT_CUSHION_THICKNESS');
const seatCushionRadius = numericConstant(source.restArea, 'SEAT_CUSHION_RADIUS');
check(
  'rest-area cushion radius fits inside half of its thinnest axis',
  seatCushionRadius <= seatCushionThickness / 2,
);
const seatCushionProbes = [
  { authored: new THREE.Vector3(0.78, seatCushionThickness, 0.58) },
  { authored: new THREE.Vector3(0.58, seatCushionThickness, 0.82) },
].map(({ authored }) => ({
  authored,
  actual: roundedBoxProbeSize(authored.toArray(), seatCushionRadius),
}));
check(
  'rest-area cushion RoundedBox bboxes match their authored dimensions',
  seatCushionProbes.every(
    ({ authored, actual }) =>
      Math.abs(actual.x - authored.x) < 0.001 &&
      Math.abs(actual.y - authored.y) < 0.001 &&
      Math.abs(actual.z - authored.z) < 0.001,
  ),
);
const chairBackrestDepth = numericConstant(source.workstation, 'CHAIR_BACKREST_DEPTH');
const chairBackrestRadius = numericConstant(source.workstation, 'CHAIR_BACKREST_RADIUS');
check(
  'chair-backrest radius fits inside half of every authored axis',
  chairBackrestRadius <= Math.min(0.38, 0.18, chairBackrestDepth) / 2,
);
const chairBackrestProbes = [
  { authored: new THREE.Vector3(0.42, 0.2, chairBackrestDepth) },
  { authored: new THREE.Vector3(0.38, 0.18, chairBackrestDepth) },
].map(({ authored }) => ({
  authored,
  actual: roundedBoxProbeSize(authored.toArray(), chairBackrestRadius),
}));
check(
  'chair-backrest RoundedBox bboxes match their authored dimensions',
  chairBackrestProbes.every(
    ({ authored, actual }) =>
      Math.abs(actual.x - authored.x) < 0.001 &&
      Math.abs(actual.y - authored.y) < 0.001 &&
      Math.abs(actual.z - authored.z) < 0.001,
  ),
);
const whiteboardDepth = numericConstant(source.whiteboard, 'WHITEBOARD_DEPTH');
const whiteboardRadius = numericConstant(source.whiteboard, 'WHITEBOARD_RADIUS');
check(
  'whiteboard radius fits inside half of every authored axis',
  whiteboardRadius <= Math.min(2.38, 1.42, whiteboardDepth) / 2,
);
const whiteboardProbeSize = roundedBoxProbeSize([2.38, 1.42, whiteboardDepth], whiteboardRadius);
check(
  'whiteboard RoundedBox bbox matches its authored dimensions',
  Math.abs(whiteboardProbeSize.x - 2.38) < 0.001 &&
    Math.abs(whiteboardProbeSize.y - 1.42) < 0.001 &&
    Math.abs(whiteboardProbeSize.z - whiteboardDepth) < 0.001,
);
const headMarkerDepth = numericConstant(source.indicators, 'HEAD_MARKER_DEPTH');
const headMarkerRadius = numericConstant(source.indicators, 'HEAD_MARKER_RADIUS');
check(
  'character head-marker radius fits inside half of every authored axis',
  headMarkerRadius <=
    Math.min(
      CHARACTER_INDICATOR_GEOMETRY.headMarkerSize,
      CHARACTER_INDICATOR_GEOMETRY.headMarkerSize,
      headMarkerDepth,
    ) /
      2,
);
const headMarkerProbeSize = roundedBoxProbeSize(
  [
    CHARACTER_INDICATOR_GEOMETRY.headMarkerSize,
    CHARACTER_INDICATOR_GEOMETRY.headMarkerSize,
    headMarkerDepth,
  ],
  headMarkerRadius,
);
check(
  'character head-marker RoundedBox bbox matches its authored dimensions',
  Math.abs(headMarkerProbeSize.x - CHARACTER_INDICATOR_GEOMETRY.headMarkerSize) < 0.001 &&
    Math.abs(headMarkerProbeSize.y - CHARACTER_INDICATOR_GEOMETRY.headMarkerSize) < 0.001 &&
    Math.abs(headMarkerProbeSize.z - headMarkerDepth) < 0.001,
);
check(
  'coffee-table glass and props derive exact stacked contact surfaces',
  source.decorative.includes('COFFEE_TABLE_BASE_TOP + COFFEE_TABLE_STACK.glassThickness / 2') &&
    occurrences(source.decorative, 'COFFEE_TABLE_SURFACE +') >= 4,
);

// Texture minification is explicit so distant normal/detail maps cannot fall back to nearest sampling.
const normalTexture = getDustNormalTexture();
check(
  'procedural normal texture is non-colour data',
  normalTexture.colorSpace === THREE.NoColorSpace,
);
check(
  'procedural normal texture uses linear magnification',
  normalTexture.magFilter === THREE.LinearFilter,
);
check(
  'procedural normal texture uses trilinear mipmapped minification',
  normalTexture.minFilter === THREE.LinearMipmapLinearFilter,
);
check('procedural normal texture generates mipmaps', normalTexture.generateMipmaps);
check('procedural normal texture requests bounded anisotropy', normalTexture.anisotropy === 8);
normalTexture.dispose();
check(
  'server baked texture is explicitly sRGB',
  source.rackTexture.includes('THREE.SRGBColorSpace'),
);
check(
  'server baked texture uses trilinear mipmapped minification',
  source.rackTexture.includes('THREE.LinearMipmapLinearFilter'),
);
check(
  'server baked texture requests bounded anisotropy',
  source.rackTexture.includes('texture.anisotropy = 8'),
);
check(
  'server baked LOD is a transparent detail atlas over the physical rack panel',
  source.rackTexture.includes('ctx.clearRect(0, 0, 128, 256)') &&
    !source.rackTexture.includes('ctx.fillStyle = sc.serverBody') &&
    source.serverRack.includes('alphaTest={0.05}') &&
    source.serverRack.includes('toneMapped={false}'),
);
check(
  'static environment reflection quality is 512px',
  source.environment.includes('resolution={512}'),
);

const shadowCamera = new THREE.OrthographicCamera(
  SCENE_KEY_LIGHT.shadow.left,
  SCENE_KEY_LIGHT.shadow.right,
  SCENE_KEY_LIGHT.shadow.top,
  SCENE_KEY_LIGHT.shadow.bottom,
  SCENE_KEY_LIGHT.shadow.near,
  SCENE_KEY_LIGHT.shadow.far,
);
shadowCamera.position.set(...SCENE_KEY_LIGHT.position);
shadowCamera.lookAt(0, 0, 0);
shadowCamera.updateMatrixWorld(true);
const plinthHalfWidth = (OFFICE_ROOM.width + 1.35) / 2;
const shadowEnvelope: THREE.Vector3[] = [];
for (const x of [-plinthHalfWidth, plinthHalfWidth]) {
  for (const y of [OFFICE_PLINTH.baseCenterY - OFFICE_PLINTH.baseHeight / 2, 4.5]) {
    for (const z of [-plinthHalfWidth, plinthHalfWidth]) {
      shadowEnvelope.push(new THREE.Vector3(x, y, z).applyMatrix4(shadowCamera.matrixWorldInverse));
    }
  }
}
check(
  'key-light shadow camera contains the complete plinth and prefab-height envelope',
  shadowEnvelope.every(
    (point) =>
      point.x >= SCENE_KEY_LIGHT.shadow.left &&
      point.x <= SCENE_KEY_LIGHT.shadow.right &&
      point.y >= SCENE_KEY_LIGHT.shadow.bottom &&
      point.y <= SCENE_KEY_LIGHT.shadow.top &&
      -point.z >= SCENE_KEY_LIGHT.shadow.near &&
      -point.z <= SCENE_KEY_LIGHT.shadow.far,
  ),
);
check(
  'shadow tuning keeps 2K resolution and bounded bias',
  SCENE_KEY_LIGHT.shadow.mapSize[0] === 2048 &&
    SCENE_KEY_LIGHT.shadow.mapSize[1] === 2048 &&
    SCENE_KEY_LIGHT.shadow.normalBias === 0.018 &&
    SCENE_KEY_LIGHT.shadow.far === 56,
);

assert.equal(passed, EXPECTED_CHECKS, 'office scene quality check count changed');
console.log(`\n${passed}/${EXPECTED_CHECKS} checks passed`);
console.log('office scene quality gate OK');
