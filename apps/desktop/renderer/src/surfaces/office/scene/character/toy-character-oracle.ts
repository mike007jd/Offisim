import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Color } from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { ResolvedAppearance } from '@/lib/avatar.js';
import { attachGarments } from './garments.js';
import {
  BODY_TYPE_GIRTH,
  HEAD_SHAPE_SCALE,
  accessoryForPerformance,
  blinkScheduleForPhase,
  eyeStyleForExpression,
  isBlinking,
} from './toy-character-contract.js';

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
      skin: '#e5b48a',
      hair: '#4a312c',
      clothing: '#2f6bff',
      accent: '#c98410',
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
      '#5c7fa3',
    );
    assert.ok(characterRoot.getObjectByName('garmentTorso'));
    assert.ok(characterRoot.getObjectByName('roleBadge'));
    assert.ok(characterRoot.getObjectByName(requiredPiece[outfit]));
    assert.ok(build.geometries.length > 0);
    assert.equal(new Set(build.materials).size, build.materials.length);
    for (const geometry of build.geometries) geometry.dispose();
    for (const material of build.materials) material.dispose();
  }
}
