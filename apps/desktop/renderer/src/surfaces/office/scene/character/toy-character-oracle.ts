import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import characterManifest from '@/assets/characters/manifest.json';
import { UI_DATA_COLORS } from '@/data/color-palette.js';
import type { ResolvedAppearance } from '@/lib/avatar.js';
import { Color, Group, Mesh, type Object3D, Vector3 } from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import toyPerformanceMetrics from '../toy-performance-metrics.json';
import { attachGarments } from './garments.js';
import {
  BODY_TYPE_GIRTH,
  HEAD_SHAPE_SCALE,
  accessoryForPerformance,
  blinkScheduleForPhase,
  eyeStyleForExpression,
  isBlinking,
  rolePresentationFor,
} from './toy-character-contract.js';

function garmentMeshes(root: Object3D, geometries: Set<unknown>): Mesh[] {
  const meshes: Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof Mesh && geometries.has(object.geometry)) meshes.push(object);
  });
  return meshes;
}

function worldPoints(mesh: Mesh, ringEnd?: 'min' | 'max'): Vector3[] {
  const position = mesh.geometry.getAttribute('position');
  if (!position)
    throw new Error(`garment mesh '${mesh.name || mesh.parent?.name}' has no POSITION`);
  let ringY = 0;
  if (ringEnd) {
    const values = Array.from({ length: position.count }, (_, index) => position.getY(index));
    ringY = ringEnd === 'min' ? Math.min(...values) : Math.max(...values);
  }
  const points: Vector3[] = [];
  for (let index = 0; index < position.count; index += 1) {
    if (ringEnd && Math.abs(position.getY(index) - ringY) > 1e-5) continue;
    points.push(
      new Vector3(position.getX(index), position.getY(index), position.getZ(index)).applyMatrix4(
        mesh.matrixWorld,
      ),
    );
  }
  return points;
}

function span(points: Vector3[], axis: 'x' | 'y' | 'z'): number {
  assert.ok(points.length > 0, `cannot measure empty ${axis}-axis garment contour`);
  const values = points.map((point) => point[axis]);
  return Math.max(...values) - Math.min(...values);
}

/** Executable P1 character oracle. Test-only: imported by the root harness. */
export async function runToyCharacterRuntimeOracle(bodyUrl: URL): Promise<void> {
  if (typeof globalThis.ProgressEvent === 'undefined') {
    Object.defineProperty(globalThis, 'ProgressEvent', { value: class ProgressEvent {} });
  }
  if (typeof globalThis.self === 'undefined') {
    Object.defineProperty(globalThis, 'self', { value: globalThis });
  }

  assert.deepEqual(BODY_TYPE_GIRTH, { slim: 0.84, normal: 1, stocky: 1.18 });
  assert.deepEqual(HEAD_SHAPE_SCALE, {
    round: [1, 1, 1],
    'soft-square': [1.1, 0.94, 0.98],
    capsule: [0.9, 1.12, 0.94],
  });
  assert.deepEqual(
    {
      neutral: eyeStyleForExpression('neutral'),
      thinking: eyeStyleForExpression('thinking'),
      happy: eyeStyleForExpression('happy'),
      worried: eyeStyleForExpression('worried'),
      focus: eyeStyleForExpression('focus'),
    },
    {
      neutral: 'neutral',
      thinking: 'neutral',
      happy: 'happy',
      worried: 'worried',
      focus: 'focus',
    },
  );

  for (const phase of [0, 0.125, 0.5, 0.875]) {
    const schedule = blinkScheduleForPhase(phase);
    assert.deepEqual(schedule, blinkScheduleForPhase(phase));
    assert.ok(schedule.gapA >= 2 && schedule.gapA <= 6);
    assert.ok(schedule.gapB >= 2 && schedule.gapB <= 6);
    assert.equal(schedule.duration, 0.12);
    const cycleStart = -schedule.offset;
    assert.equal(isBlinking(cycleStart, schedule, false), true);
    assert.equal(isBlinking(cycleStart + schedule.duration + 0.01, schedule, false), false);
    assert.equal(
      isBlinking(cycleStart + schedule.gapA + schedule.duration / 2, schedule, false),
      true,
    );
    assert.equal(isBlinking(cycleStart, schedule, true), false);
    assert.equal(
      isBlinking(cycleStart + schedule.gapA + schedule.duration / 2, schedule, true),
      false,
    );
  }

  assert.equal(accessoryForPerformance('laptop', 'clipboard', true), 'laptop');
  assert.equal(accessoryForPerformance('document', 'pointer', true), 'clipboard');
  assert.equal(accessoryForPerformance('tablet', 'clipboard', true), 'tablet');
  assert.equal(accessoryForPerformance('terminal', 'clipboard', true), 'terminal');
  assert.equal(accessoryForPerformance('pointer', 'clipboard', true), 'pointer');
  assert.equal(accessoryForPerformance(undefined, 'checklist', true), 'checklist');
  assert.equal(accessoryForPerformance(undefined, 'checklist', false), null);

  const bodyBytes = await readFile(bodyUrl);
  const bodyBuffer = bodyBytes.buffer.slice(
    bodyBytes.byteOffset,
    bodyBytes.byteOffset + bodyBytes.byteLength,
  );
  const bodyGltf = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(bodyBuffer as ArrayBuffer, '');
  const requiredPiece = {
    blazer: 'blazerLapelLeft',
    shirt: 'shirtPlacket',
    sweater: 'sweaterCrewneck',
    dress: 'dressSkirt',
  } as const;

  for (const outfit of Object.keys(requiredPiece) as Array<keyof typeof requiredPiece>) {
    const characterRoot = cloneSkeleton(bodyGltf.scene);
    const appearance: ResolvedAppearance = {
      skin: UI_DATA_COLORS.fairSkin,
      hair: UI_DATA_COLORS.darkBrown,
      clothing: UI_DATA_COLORS.blue,
      accent: UI_DATA_COLORS.amber3,
      hairStyle: 'short',
      bodyType: 'normal',
      headShape: 'round',
      gender: 'neutral',
      outfit,
    };
    const build = attachGarments(
      characterRoot,
      appearance,
      {
        clothing: new Color(appearance.clothing),
        accent: new Color(appearance.accent),
        bottom: new Color(appearance.accent).multiplyScalar(0.62),
      },
      rolePresentationFor('developer').color,
    );
    assert.ok(characterRoot.getObjectByName('garmentTorso'));
    assert.ok(characterRoot.getObjectByName('roleBadge'));
    assert.ok(characterRoot.getObjectByName(requiredPiece[outfit]));
    assert.ok(build.geometries.length > 0);
    assert.equal(new Set(build.materials).size, build.materials.length);
    for (const geometry of build.geometries) geometry.dispose();
    for (const material of build.materials) material.dispose();
  }

  const contourSamples = [];
  const sceneScale =
    toyPerformanceMetrics.character.height / characterManifest.bodies.toy.heightUnits;
  for (const [bodyType, girth] of Object.entries(BODY_TYPE_GIRTH)) {
    for (const [headShape, headScale] of Object.entries(HEAD_SHAPE_SCALE)) {
      const characterRoot = cloneSkeleton(bodyGltf.scene);
      const head = characterRoot.getObjectByName('Head');
      assert.ok(head, 'body_toy.glb is missing Head for garment contour sampling');
      head.scale.set(headScale[0], headScale[1], headScale[2]);
      const appearance: ResolvedAppearance = {
        skin: UI_DATA_COLORS.fairSkin,
        hair: UI_DATA_COLORS.darkBrown,
        clothing: UI_DATA_COLORS.blue,
        accent: UI_DATA_COLORS.amber3,
        hairStyle: 'short',
        bodyType: bodyType as ResolvedAppearance['bodyType'],
        headShape: headShape as ResolvedAppearance['headShape'],
        gender: 'neutral',
        outfit: 'sweater',
      };
      const build = attachGarments(
        characterRoot,
        appearance,
        {
          clothing: new Color(appearance.clothing),
          accent: new Color(appearance.accent),
          bottom: new Color(appearance.accent).multiplyScalar(0.62),
        },
        rolePresentationFor('developer').color,
      );
      const wrapper = new Group();
      wrapper.scale.set(sceneScale * girth, sceneScale, sceneScale * girth);
      wrapper.add(characterRoot);
      wrapper.updateMatrixWorld(true);
      const meshes = garmentMeshes(characterRoot, new Set(build.geometries));
      const torso = meshes.find((mesh) => mesh.name === 'garmentTorso');
      const upperSleeves = meshes.filter(
        (mesh) => mesh.parent?.name === 'upperarm_l' || mesh.parent?.name === 'upperarm_r',
      );
      const lowerSleeve = meshes.find((mesh) => mesh.parent?.name === 'lowerarm_l');
      assert.ok(torso, 'runtime sweater is missing garmentTorso');
      assert.equal(upperSleeves.length, 2, 'runtime sweater must have two upper sleeves');
      assert.ok(lowerSleeve, 'runtime sweater is missing the left lower sleeve');
      const shoulderPoints = [
        ...worldPoints(torso),
        ...upperSleeves.flatMap((mesh) => worldPoints(mesh, 'min')),
      ];
      const cuffPoints = worldPoints(lowerSleeve, 'max');
      const shoulderWidthScene = span(shoulderPoints, 'x');
      const sleeveCuffWidthScene = Math.max(span(cuffPoints, 'y'), span(cuffPoints, 'z'));
      const shoulderWidthToHeight = shoulderWidthScene / toyPerformanceMetrics.character.height;
      const sleeveCuffWidthToHeight = sleeveCuffWidthScene / toyPerformanceMetrics.character.height;
      const shoulderBand =
        toyPerformanceMetrics.silhouette.gates.garmentShoulderWidthToHeightByBodyType[
          bodyType as keyof typeof BODY_TYPE_GIRTH
        ];
      const cuffBand = toyPerformanceMetrics.silhouette.gates.garmentSleeveCuffWidthToHeight;
      const shoulderMin = shoulderBand[0] ?? Number.NaN;
      const shoulderMax = shoulderBand[1] ?? Number.NaN;
      const cuffMin = cuffBand[0] ?? Number.NaN;
      const cuffMax = cuffBand[1] ?? Number.NaN;
      assert.ok(
        shoulderWidthToHeight >= shoulderMin && shoulderWidthToHeight <= shoulderMax,
        `${bodyType}:${headShape} garment shoulder ${shoulderWidthToHeight.toFixed(6)} outside ${shoulderBand.join('..')}`,
      );
      assert.ok(
        sleeveCuffWidthToHeight >= cuffMin && sleeveCuffWidthToHeight <= cuffMax,
        `${bodyType}:${headShape} garment cuff ${sleeveCuffWidthToHeight.toFixed(6)} outside ${cuffBand.join('..')}`,
      );
      contourSamples.push({
        id: `${bodyType}:${headShape}`,
        measurementSource:
          'runtime attachGarments POSITION vertices after bone and girth transforms',
        shoulderWidthScene: Number(shoulderWidthScene.toFixed(6)),
        shoulderWidthToHeight: Number(shoulderWidthToHeight.toFixed(6)),
        sleeveCuffWidthScene: Number(sleeveCuffWidthScene.toFixed(6)),
        sleeveCuffWidthToHeight: Number(sleeveCuffWidthToHeight.toFixed(6)),
      });
      for (const geometry of build.geometries) geometry.dispose();
      for (const material of build.materials) material.dispose();
    }
  }
  console.log(`GARMENT_CONTOURS ${JSON.stringify(contourSamples)}`);
}
