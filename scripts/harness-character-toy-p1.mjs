#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const CHARACTER_DIR = join(ROOT, 'apps/desktop/renderer/src/assets/characters');
const RUNTIME_DIR = join(ROOT, 'apps/desktop/renderer/src/surfaces/office/scene/character');
const CONTRACT_PATH = join(ROOT, 'apps/desktop/renderer/src/lib/toy-character-contract.json');
const EVIDENCE_DIR = join(ROOT, 'Docs/evidence/2026-07-office-toy/p1');
const EVIDENCE_PATH = join(EVIDENCE_DIR, 'oracle-results.json');
const BUDGET = 25 * 1024 * 1024;

let passed = 0;
const checks = [];
const failures = [];
function check(name, condition, detail = '') {
  checks.push({ name, pass: Boolean(condition), detail });
  if (condition) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failures.push({ name, detail });
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const json = (path) => readFile(path, 'utf8').then(JSON.parse);
const text = (path) => readFile(path, 'utf8');
const transformPoint = (matrix, point) => [
  matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
  matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
  matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
];

await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const contract = await json(CONTRACT_PATH);
const manifest = await json(join(CHARACTER_DIR, 'manifest.json'));
const characterDirEntries = await readdir(CHARACTER_DIR, { withFileTypes: true });
const reachableAccessories = new Set([
  ...Object.values(contract.performancePropAsset),
  ...Object.values(contract.roleFamilies).map((family) => family.accessory),
]);
const missingAttachSpecs = [...reachableAccessories].filter((kind) => !contract.propAttach[kind]);
const requiredPropNodes = [...reachableAccessories]
  .map((kind) => contract.propAttach[kind]?.node)
  .filter(Boolean)
  .sort();
const avatar = await text(join(ROOT, 'apps/desktop/renderer/src/lib/avatar.ts'));
const adapters = await text(join(ROOT, 'apps/desktop/renderer/src/data/adapters.ts'));
const personnelSurface = await text(
  join(ROOT, 'apps/desktop/renderer/src/surfaces/personnel/PersonnelSurface.tsx'),
);
const appearanceTab = await text(
  join(ROOT, 'apps/desktop/renderer/src/surfaces/personnel/AppearanceTab.tsx'),
);
const officeScene = await text(
  join(ROOT, 'apps/desktop/renderer/src/surfaces/office/scene/OfficeScene3D.tsx'),
);
const personnelData = await text(
  join(ROOT, 'apps/desktop/renderer/src/surfaces/personnel/personnel-data.ts'),
);
const character = await text(join(RUNTIME_DIR, 'GltfCharacter.tsx'));
const characterAssets = await text(join(RUNTIME_DIR, 'character-assets.ts'));
const garments = await text(join(RUNTIME_DIR, 'garments.ts'));
const licenses = await text(join(CHARACTER_DIR, 'LICENSES.md'));
const roleRegistry = await text(join(ROOT, 'packages/shared-types/src/roles.ts'));
const p0Harness = await text(
  join(ROOT, 'apps/desktop/renderer/scripts/harness-character-toy-p0.mjs'),
);
const toyMetrics = await json(
  join(ROOT, 'apps/desktop/renderer/src/surfaces/office/scene/toy-performance-metrics.json'),
);

check(
  'girth contract',
  JSON.stringify(contract.bodyTypeGirth) ===
    JSON.stringify({ slim: 0.84, normal: 1, stocky: 1.18 }),
);
check(
  'head-shape contract',
  JSON.stringify(contract.headShapeScale) ===
    JSON.stringify({
      round: [1, 1, 1],
      'soft-square': [1.1, 0.94, 0.98],
      capsule: [0.9, 1.12, 0.94],
    }),
);
check(
  'six neutral skin tones',
  contract.skinTones.length === 6 &&
    contract.skinTones.every((tone, index) => tone.id === `tone-0${index + 1}`),
);
check(
  'appearance endpoint removes accentVariant',
  !avatar.includes('accentVariant') &&
    !adapters.includes('accentVariant') &&
    !appearanceTab.includes('accentVariant') &&
    !personnelSurface.includes('accentVariant'),
);
check(
  'headShape is editable and persisted',
  avatar.includes("export type HeadShape = 'round' | 'soft-square' | 'capsule'") &&
    adapters.includes('out.headShape') &&
    appearanceTab.includes('HEAD_SHAPE_OPTIONS') &&
    appearanceTab.includes('draft.headShape'),
);
check(
  'tone UI labels are neutral',
  personnelData.includes('toyCharacterContract.skinTones.map') &&
    !/caucasian|asian|african|ethnic/i.test(personnelData),
);
check(
  'resolver and Personnel share every reachable hair and outfit color',
  avatar.includes('toyCharacterContract.hairColors.map') &&
    avatar.includes('toyCharacterContract.outfitColors.map') &&
    personnelData.includes('toyCharacterContract.hairColors.map') &&
    personnelData.includes('toyCharacterContract.outfitColors.map') &&
    contract.hairColors.length === 8 &&
    contract.outfitColors.length === 10,
);
check(
  'explicit template colors remain visibly selected as a custom swatch',
  appearanceTab.includes("label: 'Current custom'") &&
    appearanceTab.includes('swatches.some((swatch)'),
);
check(
  'appearance draft uses the office resolver for every effective color',
  ['skin', 'hair', 'clothing', 'accent'].every((field) =>
    personnelData.includes(`${field}Color: resolved.${field}`),
  ) && !personnelData.includes('employee.avatarA'),
);
check(
  'gender presentation affects only the 2D avatar lane',
  avatar.includes('TOP_CYCLE_BY_GENDER') &&
    avatar.includes('AVATAR_CLOTHING_BY_GENDER') &&
    avatar.includes('facialHairProbability') &&
    character.includes('gender: persona/2D-avatar metadata only'),
);
const resolver = avatar.slice(
  avatar.indexOf('export function resolveAppearance'),
  avatar.indexOf('function oneOf'),
);
check('role and skin sampling are independent', !/role/i.test(resolver));
const appearance3DKeySource = character.slice(
  character.indexOf('// `gender` is deliberately absent'),
  character.indexOf('const bodyGltf'),
);
check(
  '3D rig identity excludes gender and girth scales XZ only',
  !appearance3DKeySource.includes('appearance.gender') &&
    ['skin', 'hair', 'clothing', 'accent', 'hairStyle', 'bodyType', 'headShape', 'outfit'].every(
      (field) => appearance3DKeySource.includes(`appearance.${field}`),
    ) &&
    character.includes('scale={[rig.scale * rig.girth, rig.scale, rig.scale * rig.girth]}'),
);
const reachableHairAssets = [
  ...new Set(Object.values(contract.hairStyleToAsset).filter(Boolean)),
].sort();
const transformedHairAssets = Object.keys(contract.hairTransforms).sort();
const manifestedHairAssets = Object.keys(manifest.hair ?? {}).sort();
const shippedHairAssets = characterDirEntries
  .filter((entry) => entry.isFile() && /^hair_\d+\.glb$/.test(entry.name))
  .map((entry) => entry.name.replace(/\.glb$/, ''))
  .sort();
const runtimeHairAssets = [...characterAssets.matchAll(/^\s+(hair_\d+): hair\d+Url,/gm)]
  .map((match) => match[1])
  .sort();
check(
  'hair reachable, transform, manifest, shipped, and runtime URL sets are exact',
  reachableHairAssets.length === 6 &&
    [transformedHairAssets, manifestedHairAssets, shippedHairAssets, runtimeHairAssets].every(
      (assets) => JSON.stringify(assets) === JSON.stringify(reachableHairAssets),
    ),
);
const hairFitFailures = [];
const [headRadiusX, headRadiusY, headRadiusZ] = manifest.bodies.toy.headRadiiUnits;
for (const [asset, transform] of Object.entries(contract.hairTransforms)) {
  const hairDoc = await io.read(join(CHARACTER_DIR, `${asset}.glb`));
  const bounds = getBounds(hairDoc.getRoot().getDefaultScene());
  const transformedMin = bounds.min.map(
    (value, axis) => value * transform.scale[axis] + transform.position[axis],
  );
  const transformedMax = bounds.max.map(
    (value, axis) => value * transform.scale[axis] + transform.position[axis],
  );
  const width = transformedMax[0] - transformedMin[0];
  let exteriorVertices = 0;
  let vertexCount = 0;
  for (const node of hairDoc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const worldMatrix = node.getWorldMatrix();
    for (const primitive of mesh.listPrimitives()) {
      const positions = primitive.getAttribute('POSITION');
      if (!positions) continue;
      const point = [];
      for (let index = 0; index < positions.getCount(); index += 1) {
        positions.getElement(index, point);
        const transformed = transformPoint(worldMatrix, point).map(
          (value, axis) => value * transform.scale[axis] + transform.position[axis],
        );
        const ellipsoidQ =
          (transformed[0] / headRadiusX) ** 2 +
          (transformed[1] / headRadiusY) ** 2 +
          (transformed[2] / headRadiusZ) ** 2;
        if (ellipsoidQ > 1.03) exteriorVertices += 1;
        vertexCount += 1;
      }
    }
  }
  const exteriorRatio = vertexCount > 0 ? exteriorVertices / vertexCount : 0;
  if (
    !transformedMin.every(Number.isFinite) ||
    !transformedMax.every(Number.isFinite) ||
    width < headRadiusX * 2 * 0.82 ||
    transformedMax[1] < headRadiusY * 0.92 ||
    transformedMin[1] > headRadiusY * 0.8 ||
    transformedMin[2] > -headRadiusZ * 0.65 ||
    transformedMax[2] > contract.eye.planeZ - 0.02 ||
    exteriorRatio < 0.15
  ) {
    hairFitFailures.push(
      `${asset}:x${width.toFixed(3)} y${transformedMin[1].toFixed(3)}..${transformedMax[1].toFixed(3)} z${transformedMin[2].toFixed(3)}..${transformedMax[2].toFixed(3)} exterior=${exteriorRatio.toFixed(3)}`,
    );
  }
}
check(
  'six transformed hair silhouettes overlap the head while clearing eyes',
  hairFitFailures.length === 0,
  hairFitFailures.join(', '),
);
check(
  'four eye states and deterministic blink guard are wired',
  new Set(Object.values(contract.eye.expressionMap)).size === 4 &&
    contract.eye.blinkMinSeconds === 2 &&
    contract.eye.blinkMaxSeconds === 6 &&
    contract.eye.blinkDurationSeconds >= 0.1 &&
    contract.eye.blinkDurationSeconds <= 0.15 &&
    character.includes('isBlinking') &&
    character.includes('eyeStyleForExpression'),
);
const appearancePreviewSource = appearanceTab.slice(
  appearanceTab.indexOf('function AppearancePreviewPanel'),
  appearanceTab.indexOf('interface AppearanceTabProps'),
);
const dragGhostSource = officeScene.slice(
  officeScene.indexOf('function EmployeeDragGhost'),
  officeScene.indexOf('function SceneDropNoticeLabel'),
);
check(
  'reduced-motion reaches office actors, drag ghost, and Personnel preview',
  appearancePreviewSource.includes('usePrefersReducedMotion()') &&
    appearancePreviewSource.includes('reducedMotion={reducedMotion}') &&
    dragGhostSource.includes('reducedMotion: boolean') &&
    dragGhostSource.includes('reducedMotion={reducedMotion}') &&
    officeScene.includes('reducedMotion={reducedMotion}'),
);
check(
  'four garment silhouettes and role badge exist',
  ['blazer', 'shirt', 'sweater', 'dress'].every((outfit) => garments.includes(`'${outfit}'`)) &&
    garments.includes('roleBadge'),
);
check(
  'five performance props map to visible accessories',
  JSON.stringify(contract.performancePropAsset) ===
    JSON.stringify({
      laptop: 'laptop',
      document: 'clipboard',
      tablet: 'tablet',
      terminal: 'terminal',
      pointer: 'pointer',
    }),
);
check(
  'every reachable performance and role accessory has one attach spec',
  missingAttachSpecs.length === 0 &&
    JSON.stringify(Object.keys(contract.propAttach).sort()) ===
      JSON.stringify([...reachableAccessories].sort()),
  missingAttachSpecs.join(', '),
);
check(
  'canonical role registry is fully classified',
  JSON.stringify(Object.keys(contract.roleFamilyBySlug).sort()) ===
    JSON.stringify(
      [...roleRegistry.matchAll(/\{\s*slug:\s*'([^']+)'/g)].map((match) => match[1]).sort(),
    ) && Object.values(contract.roleFamilyBySlug).every((family) => contract.roleFamilies[family]),
);
check(
  'P0 diagnostic seam removed',
  !appearanceTab.includes('VITE_OFFICE_TOY_P0_DIAGNOSTIC') &&
    !appearanceTab.includes('diagnosticClip') &&
    !character.includes('diagnosticClip'),
);
check(
  'laptop attach has one source shared with the P0 contact oracle',
  toyMetrics.heldProps === undefined &&
    p0Harness.includes('characterContract.propAttach.laptop') &&
    !p0Harness.includes('metrics.heldProps'),
);

const bodyDoc = await io.read(join(CHARACTER_DIR, 'body_toy.glb'));
const bodyNodes = new Set(
  bodyDoc
    .getRoot()
    .listNodes()
    .map((node) => node.getName()),
);
const propsDoc = await io.read(join(CHARACTER_DIR, 'props.glb'));
const propNodes = new Set(
  propsDoc
    .getRoot()
    .listNodes()
    .map((node) => node.getName()),
);
const topLevelPropNodes = propsDoc
  .getRoot()
  .getDefaultScene()
  .listChildren()
  .map((node) => node.getName())
  .sort();
const invalidAttachSpecs = [...reachableAccessories].filter((kind) => {
  const spec = contract.propAttach[kind];
  return (
    !spec?.node ||
    !spec?.bone ||
    !topLevelPropNodes.includes(spec.node) ||
    !bodyNodes.has(spec.bone)
  );
});
check(
  'props.glb contains every P1 prop node',
  requiredPropNodes.every((name) => propNodes.has(name)) &&
    JSON.stringify(topLevelPropNodes) === JSON.stringify(requiredPropNodes) &&
    JSON.stringify(Object.keys(manifest.props).sort()) === JSON.stringify(requiredPropNodes),
  `missing ${requiredPropNodes.filter((name) => !propNodes.has(name)).join(', ')}`,
);
check(
  'every reachable prop attaches to a shipped top-level node and body bone',
  invalidAttachSpecs.length === 0,
  invalidAttachSpecs.join(', '),
);
const emptyProps = requiredPropNodes.filter((name) => {
  const node = propsDoc
    .getRoot()
    .listNodes()
    .find((candidate) => candidate.getName() === name);
  if (!node) return true;
  const bounds = getBounds(node);
  const extents = bounds.max.map((value, axis) => value - bounds.min[axis]);
  return (
    !bounds.min.every(Number.isFinite) ||
    !bounds.max.every(Number.isFinite) ||
    extents.some((extent) => extent <= 1e-4)
  );
});
check('every P1 prop node has renderable geometry', emptyProps.length === 0, emptyProps.join(', '));
check('baked P0 eye mesh removed', !bodyNodes.has('ToyEyeDots'));
check(
  'brows assets and manifest lane removed',
  !existsSync(join(CHARACTER_DIR, 'brows_01.glb')) &&
    !existsSync(join(CHARACTER_DIR, 'brows_02.glb')) &&
    manifest.brows === undefined &&
    !/eyebrow/i.test(licenses),
);
check(
  'hair manifest ships six assets',
  Object.keys(manifest.hair ?? {}).length === 6 &&
    Array.from({ length: 6 }, (_, index) => `hair_0${index + 1}.glb`).every((file) =>
      existsSync(join(CHARACTER_DIR, file)),
    ),
);
const files = Object.keys(manifest.files ?? {});
const actualAssetFiles = characterDirEntries
  .filter(
    (entry) => entry.isFile() && (entry.name.endsWith('.glb') || entry.name === 'LICENSES.md'),
  )
  .map((entry) => entry.name)
  .sort();
const actualSizes = Object.fromEntries(
  await Promise.all(
    actualAssetFiles.map(async (file) => [file, (await stat(join(CHARACTER_DIR, file))).size]),
  ),
);
const actualBytes = Object.values(actualSizes).reduce((sum, bytes) => sum + bytes, 0);
check(
  'manifest exactly covers shipped assets, byte sizes, and 25 MiB budget',
  JSON.stringify(files.sort()) === JSON.stringify(actualAssetFiles) &&
    actualAssetFiles.every((file) => manifest.files[file] === actualSizes[file]) &&
    actualBytes === manifest.totalBytes &&
    actualBytes <= BUDGET,
  `${actualBytes}/${BUDGET}`,
);
check(
  'licenses identify authored P1 geometry',
  licenses.includes('Offisim-authored procedural geometry') &&
    licenses.includes('clipboard') &&
    licenses.includes('headset'),
);

const runtimeOracle = spawnSync(
  'pnpm',
  [
    '--filter',
    '@offisim/platform',
    'exec',
    'tsx',
    '--tsconfig',
    join(ROOT, 'apps/desktop/renderer/tsconfig.json'),
    join(ROOT, 'scripts/harness-character-toy-p1-runtime.mts'),
  ],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
);
check(
  'executable runtime oracle covers exact scales, blink/reduced-motion, prop precedence, and garments',
  runtimeOracle.status === 0,
  [runtimeOracle.error?.message, runtimeOracle.stdout, runtimeOracle.stderr]
    .filter(Boolean)
    .join('\n'),
);
const rigFrameSource = character.slice(
  character.indexOf('useFrame((state, delta)'),
  character.indexOf('// Non-uniform XZ girth'),
);
const rigBuildSource = character.slice(
  character.indexOf('const rig = useMemo<CharacterRig>'),
  character.indexOf('// Opacity is animated'),
);
check(
  'production Gltf wiring consumes the executable scale, eye, prop, and garment contracts',
  rigBuildSource.includes('HEAD_SHAPE_SCALE[appearance.headShape]') &&
    rigBuildSource.includes('headBone.scale.set(headScale[0], headScale[1], headScale[2])') &&
    rigBuildSource.includes('attachGarments(') &&
    rigBuildSource.includes('materials.push(...garments.materials)') &&
    rigBuildSource.includes('proceduralGeometries.push(...garments.geometries)') &&
    rigFrameSource.includes('accessoryForPerformance(') &&
    rigFrameSource.includes('eyeStyleForExpression(perf.expression)') &&
    rigFrameSource.includes('isBlinking(state.clock.elapsedTime, blinkSchedule, reducedMotion)') &&
    rigFrameSource.includes("rig.eyeHandles[blink ? 'blink' : eyeStyle]"),
);

const assetHashes = Object.fromEntries(
  await Promise.all(
    actualAssetFiles.map(async (file) => [
      file,
      createHash('sha256')
        .update(await readFile(join(CHARACTER_DIR, file)))
        .digest('hex'),
    ]),
  ),
);
await mkdir(EVIDENCE_DIR, { recursive: true });
await writeFile(
  EVIDENCE_PATH,
  `${JSON.stringify(
    {
      version: 1,
      result: failures.length === 0 ? 'pass' : 'fail',
      contractVersion: contract.version,
      checks,
      assets: {
        files: actualSizes,
        sha256: assetHashes,
        totalBytes: actualBytes,
        budgetBytes: BUDGET,
      },
    },
    null,
    2,
  )}\n`,
);

console.log(
  `\nP1 character oracle: ${passed} passed, ${failures.length} failed; evidence=${EVIDENCE_PATH}`,
);
if (failures.length > 0) process.exit(1);
