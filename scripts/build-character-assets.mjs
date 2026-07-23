#!/usr/bin/env node
/**
 * Character asset pipeline (production-work-dramaturgy I6).
 *
 * Reads the raw CC0 packs (Quaternius Universal Base Characters + Universal
 * Animation Library 1/2, Kenney Furniture Kit) from
 * RAW_DIR and emits the shipped runtime set into
 * `apps/desktop/renderer/src/assets/characters/`:
 *
 *   body_toy.glb                      procedural toy capsule body on the exact
 *                                     65-joint UBC rig, with machine-sampleable
 *                                     head/contact landmark nodes.
 *   hair_01..12.glb                  Offisim-authored chunky toy hairstyles in
 *                                     the Head-bone-local coordinate contract,
 *                                     gray tint-ready basecolor (no textures).
 *   animations.glb                    one shared clip library on the 65-bone rig
 *                                     (mannequin stripped), clips renamed to the
 *                                     neutral scheme below.
 *   props.glb                         Kenney laptop plus Offisim-authored toy
 *                                     work accessories used by every Prop enum
 *                                     and role-default lane.
 *   manifest.json                     file sizes, clip list, body metrics, and
 *                                     skin-tint reference colors (consumed by
 *                                     the clip-map harness + GltfCharacter).
 *   LICENSES.md                       CC0 notices + source URLs + license texts.
 *
 * Clip rename map (source → neutral semantic name):
 *   UAL1  A_TPose→tpose            Idle_Loop→idle             Idle_Talking_Loop→idle.talk
 *         Interact→interact        PickUp_Table→pickup        Sitting_Enter→sit.enter
 *         Sitting_Exit→sit.exit    Sitting_Idle_Loop→sit.idle Sitting_Talking_Loop→sit.talk
 *         Walk_Loop→walk           Walk_Formal_Loop→walk.formal  Dance_Loop→celebrate.dance
 *   UAL2  Chest_Open→inspect.open  Consume→consume            Idle_FoldArms_Loop→wait.foldarms
 *         Idle_No_Loop→blocked.headshake  Idle_TalkingPhone_Loop→phone
 *         Walk_Carry_Loop→carry    Yes→celebrate.yes
 *   derived (procedural, baked from the retained clips):
 *         sit.type / approval.wait / look.around / sit.fidget / stretch
 *         (look.around, sit.fidget, stretch are also re-derivable from the
 *         committed GLB alone via scripts/derive-character-action-clips.mjs)
 *
 * The raw packs are a dev-machine artifact (downloaded + unpacked pack
 * contents) and are NOT checked in. CHARACTER_ASSETS_RAW_DIR is REQUIRED —
 * there is no default raw directory; if unset or missing, the script exits 1
 * with the pack list, source URLs, and the expected layout (requireRawDir).
 *
 * The COMMITTED files under `apps/desktop/renderer/src/assets/characters/`
 * remain the source of truth — this script exists only to REGENERATE them
 * from a raw workspace, and the build is deterministic for a given raw set.
 *
 * Hard gate: total emitted size (glb + LICENSES.md) must stay under 25 MB or the
 * script exits 1.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { Document, Logger, NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  mergeDocuments,
  meshopt,
  prune,
  resample,
  unpartition,
} from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { HAIR_ASSET_IDS, buildToyHairAssets } from './lib/toy-hair-assets.mjs';

/**
 * REQUIRED raw-pack workspace. No default: a checked-in script must never
 * point at a session temp dir. Exits 1 with download + layout guidance when
 * the env var is unset or the directory is missing.
 */
function requireRawDir() {
  const dir = process.env.CHARACTER_ASSETS_RAW_DIR;
  if (dir && existsSync(dir) && statSync(dir).isDirectory()) return dir;
  const reason = dir
    ? existsSync(dir)
      ? `CHARACTER_ASSETS_RAW_DIR is not a directory: ${dir}`
      : `CHARACTER_ASSETS_RAW_DIR does not exist: ${dir}`
    : 'CHARACTER_ASSETS_RAW_DIR is not set';
  console.error(
    [
      `FAIL: ${reason}`,
      '',
      'This script only REGENERATES the committed character assets under',
      'apps/desktop/renderer/src/assets/characters/ (those stay the source of',
      'truth). To run it, download + unpack the CC0 source packs into a raw',
      'workspace and point CHARACTER_ASSETS_RAW_DIR at it:',
      '',
      '  Universal Base Characters [Standard]   https://quaternius.itch.io/universal-base-characters',
      '  Universal Animation Library [Standard] https://quaternius.itch.io/universal-animation-library',
      '  Universal Animation Library 2 [Std]    https://quaternius.itch.io/universal-animation-library-2',
      '  Kenney Furniture Kit                   https://kenney.nl/assets/furniture-kit',
      '',
      'Expected layout under $CHARACTER_ASSETS_RAW_DIR:',
      '  unpacked/ubc/Universal Base Characters[Standard]/            (bodies, hairstyles, License_Standard.txt)',
      '  unpacked/ual/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb  (+ License.txt)',
      '  unpacked/ual2/Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb (+ License.txt)',
      '  unpacked/kenney-furniture/Models/GLTF format/                (+ License.txt)',
    ].join('\n'),
  );
  process.exit(1);
}

const RAW_DIR = requireRawDir();
const OUT_DIR = join(process.cwd(), 'apps/desktop/renderer/src/assets/characters');
const TOY_METRICS = JSON.parse(
  readFileSync(
    join(
      process.cwd(),
      'apps/desktop/renderer/src/surfaces/office/scene/toy-performance-metrics.json',
    ),
    'utf8',
  ),
);
const TOY_CHARACTER_CONTRACT = JSON.parse(
  readFileSync(
    join(process.cwd(), 'apps/desktop/renderer/src/lib/toy-character-contract.json'),
    'utf8',
  ),
);
const TOY_GEOMETRY = TOY_METRICS.silhouette.geometryUnits;
const TOY_GARMENTS = TOY_METRICS.silhouette.garmentProportions;
const TOY_PROPORTION_CORRECTIONS = TOY_METRICS.silhouette.proportionCorrections;
const SIZE_BUDGET_BYTES = 25 * 1024 * 1024;
const ROOT_MOTION_MAX_DELTA = 1e-5;
const MAX_ANIMATION_CLIPS = 24;
const TOY_HEAD_RATIO = TOY_METRICS.character.targetHeadCount;
const TOY_HEAD_RATIO_RANGE = [
  TOY_METRICS.character.minimumHeadCount,
  TOY_METRICS.character.maximumHeadCount,
];
const TOY_SHOE_BOTTOM_Y = -0.005;
const TOY_ARM_LENGTH_SCALE = 0.72;
const TOY_SHOULDER_DROP_UNITS = 0.2;
const TOY_CONSTANT_TRACK_EPSILON = 1e-6;
const TOY_CARRY_GROUND_LIFT_UNITS = 0.025;

const UBC_DIR = join(RAW_DIR, 'unpacked/ubc/Universal Base Characters[Standard]');
const BODY_DIR = join(UBC_DIR, 'Base Characters/Godot - UE');
const UAL1_GLB = join(
  RAW_DIR,
  'unpacked/ual/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb',
);
const UAL2_GLB = join(
  RAW_DIR,
  'unpacked/ual2/Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb',
);
const KENNEY_DIR = join(RAW_DIR, 'unpacked/kenney-furniture/Models/GLTF format');

/** Neutral clip names taken from each animation library file. */
const UAL1_CLIP_RENAMES = {
  A_TPose: 'tpose',
  Idle_Loop: 'idle',
  Idle_Talking_Loop: 'idle.talk',
  Interact: 'interact',
  PickUp_Table: 'pickup',
  Sitting_Enter: 'sit.enter',
  Sitting_Exit: 'sit.exit',
  Sitting_Idle_Loop: 'sit.idle',
  Sitting_Talking_Loop: 'sit.talk',
  Walk_Loop: 'walk',
  Walk_Formal_Loop: 'walk.formal',
  Dance_Loop: 'celebrate.dance',
};
const UAL2_CLIP_RENAMES = {
  Chest_Open: 'inspect.open',
  Consume: 'consume',
  Idle_FoldArms_Loop: 'wait.foldarms',
  Idle_No_Loop: 'blocked.headshake',
  Idle_TalkingPhone_Loop: 'phone',
  Walk_Carry_Loop: 'carry',
  Yes: 'celebrate.yes',
};

/**
 * Authored at build time from the retained CC0 skeleton clips. They are baked
 * as ordinary full glTF animations — the runtime needs no additive-animation
 * feature or source-pack access. The same five clips are also re-derivable
 * from the committed animations.glb alone via
 * `scripts/derive-character-action-clips.mjs` (look.around/sit.fidget/stretch;
 * identical 24-name clip set + provenance).
 */
const PROCEDURAL_ANIMATION_SPECS = {
  'sit.type': {
    baseClip: 'sit.idle',
    poseReferenceClip: 'sit.talk',
    poseReferenceTime: 0.5,
    durationSeconds: 1.6,
    mode: 'loop',
    modifiedJoints: [
      'clavicle_l',
      'upperarm_l',
      'lowerarm_l',
      'hand_l',
      'clavicle_r',
      'upperarm_r',
      'lowerarm_r',
      'hand_r',
      'index_01_r',
      'middle_01_r',
    ],
    poseWeightFor: (joint) => typingPoseWeight(joint),
    eulerDeltaFor: (joint, normalizedTime) => typingEulerDelta(joint, normalizedTime),
  },
  'approval.wait': {
    baseClip: 'idle',
    poseReferenceClip: 'wait.foldarms',
    poseReferenceTime: 0.5,
    durationSeconds: 1.6,
    mode: 'hold',
    modifiedJoints: [
      'clavicle_l',
      'upperarm_l',
      'lowerarm_l',
      'hand_l',
      'clavicle_r',
      'upperarm_r',
      'lowerarm_r',
      'hand_r',
    ],
    poseWeightFor: (_joint, normalizedTime) => smoothstep(normalizedTime / 0.55),
    eulerDeltaFor: () => [0, 0, 0],
  },
  'look.around': {
    baseClip: 'idle',
    poseReferenceClip: 'idle',
    poseReferenceTime: 0.25,
    durationSeconds: 2.4,
    mode: 'loop',
    modifiedJoints: ['neck_01', 'Head', 'spine_03'],
    poseWeightFor: () => 0,
    eulerDeltaFor: (joint, normalizedTime) => lookAroundEulerDelta(joint, normalizedTime),
  },
  'sit.fidget': {
    baseClip: 'sit.idle',
    poseReferenceClip: 'sit.type',
    poseReferenceTime: 0.5,
    durationSeconds: 2.4,
    mode: 'loop',
    modifiedJoints: [
      'clavicle_l',
      'upperarm_l',
      'lowerarm_l',
      'hand_l',
      'clavicle_r',
      'upperarm_r',
      'lowerarm_r',
      'hand_r',
      'spine_01',
      'Head',
    ],
    poseWeightFor: (joint) => fidgetPoseWeight(joint),
    eulerDeltaFor: (joint, normalizedTime) => fidgetEulerDelta(joint, normalizedTime),
  },
  // poseReferenceClip/poseReferenceTime are picked deterministically at build
  // time (most arms-up frame across the celebration clips); see buildAnimations.
  stretch: {
    baseClip: 'idle',
    poseReferenceClip: null,
    poseReferenceTime: null,
    durationSeconds: 2.2,
    mode: 'hold',
    modifiedJoints: [
      'clavicle_l',
      'upperarm_l',
      'lowerarm_l',
      'hand_l',
      'clavicle_r',
      'upperarm_r',
      'lowerarm_r',
      'hand_r',
      'spine_02',
      'spine_03',
      'neck_01',
      'Head',
    ],
    poseWeightFor: (joint, normalizedTime) => stretchPoseWeight(joint, normalizedTime),
    eulerDeltaFor: (joint, normalizedTime) => stretchEulerDelta(joint, normalizedTime),
  },
};

const SOURCE_BODY_GLTF = 'Superhero_Male_FullBody.gltf';

const KENNEY_PROPS = {
  prop_laptop: 'laptop.glb',
};
const SHOE_BASE_COLOR = [0.16, 0.17, 0.2, 1];
const TOY_SKIN_LIGHT = [0.651, 0.471, 0.345, 1];
const TOY_SKIN_DARK = [0.612, 0.431, 0.306, 1];

const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subtract3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale3 = (v, scalar) => [v[0] * scalar, v[1] * scalar, v[2] * scalar];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length3 = (v) => Math.hypot(v[0], v[1], v[2]);
const normalize3 = (v) => {
  const length = length3(v);
  if (length <= Number.EPSILON) fail('cannot normalize a zero-length vector');
  return scale3(v, 1 / length);
};

/** Low-poly skinned geometry accumulator. Vertices are rigid-weighted to one UBC joint. */
function createToyGeometry() {
  return { positions: [], normals: [], joints: [], weights: [], indices: [] };
}

function pushToyVertex(geometry, position, normal, jointIndex) {
  const index = geometry.positions.length / 3;
  geometry.positions.push(...position);
  geometry.normals.push(...normalize3(normal));
  geometry.joints.push(jointIndex, 0, 0, 0);
  geometry.weights.push(1, 0, 0, 0);
  return index;
}

/** Adds an axis-aligned ellipsoid in model/bind coordinates. */
function addToyEllipsoid(geometry, center, radii, jointIndex, latSegments = 8, lonSegments = 12) {
  const first = geometry.positions.length / 3;
  for (let lat = 0; lat <= latSegments; lat += 1) {
    const phi = (lat / latSegments) * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    for (let lon = 0; lon <= lonSegments; lon += 1) {
      const theta = (lon / lonSegments) * Math.PI * 2;
      const local = [sinPhi * Math.cos(theta), cosPhi, sinPhi * Math.sin(theta)];
      const position = [
        center[0] + local[0] * radii[0],
        center[1] + local[1] * radii[1],
        center[2] + local[2] * radii[2],
      ];
      const normal = [local[0] / radii[0], local[1] / radii[1], local[2] / radii[2]];
      pushToyVertex(geometry, position, normal, jointIndex);
    }
  }
  const row = lonSegments + 1;
  for (let lat = 0; lat < latSegments; lat += 1) {
    for (let lon = 0; lon < lonSegments; lon += 1) {
      const a = first + lat * row + lon;
      const b = a + row;
      geometry.indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
}

/** Adds a capsule between two joint-space points, weighted rigidly to the start joint. */
function addToyCapsule(geometry, start, end, radius, jointIndex, radialSegments = 10) {
  const axis = normalize3(subtract3(end, start));
  const reference = Math.abs(dot3(axis, [0, 0, 1])) < 0.92 ? [0, 0, 1] : [1, 0, 0];
  const basisX = normalize3(cross3(reference, axis));
  const basisZ = normalize3(cross3(axis, basisX));
  const center = scale3(add3(start, end), 0.5);
  const halfCylinder = length3(subtract3(end, start)) / 2;
  const rings = [];
  const hemisphereSteps = 3;
  for (let step = 0; step <= hemisphereSteps; step += 1) {
    const angle = -Math.PI / 2 + (step / hemisphereSteps) * (Math.PI / 2);
    rings.push({
      y: -halfCylinder + Math.sin(angle) * radius,
      r: Math.cos(angle) * radius,
      ny: Math.sin(angle),
      nr: Math.cos(angle),
    });
  }
  for (let step = 1; step <= hemisphereSteps; step += 1) {
    const angle = (step / hemisphereSteps) * (Math.PI / 2);
    rings.push({
      y: halfCylinder + Math.sin(angle) * radius,
      r: Math.cos(angle) * radius,
      ny: Math.sin(angle),
      nr: Math.cos(angle),
    });
  }

  const first = geometry.positions.length / 3;
  for (const ring of rings) {
    for (let segment = 0; segment <= radialSegments; segment += 1) {
      const theta = (segment / radialSegments) * Math.PI * 2;
      const radial = add3(scale3(basisX, Math.cos(theta)), scale3(basisZ, Math.sin(theta)));
      const position = add3(center, add3(scale3(axis, ring.y), scale3(radial, ring.r)));
      const normal = add3(scale3(axis, ring.ny), scale3(radial, ring.nr));
      pushToyVertex(geometry, position, normal, jointIndex);
    }
  }
  const row = radialSegments + 1;
  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const a = first + ring * row + segment;
      const b = a + row;
      geometry.indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
}

function createToyAccessors(document, buffer, name, geometry) {
  if (geometry.positions.length === 0 || geometry.indices.length === 0) {
    fail(`toy body '${name}' generated empty geometry`);
  }
  const vertexCount = geometry.positions.length / 3;
  const indexArray =
    vertexCount > 65535 ? new Uint32Array(geometry.indices) : new Uint16Array(geometry.indices);
  return {
    position: document
      .createAccessor(`${name}_POSITION`)
      .setType('VEC3')
      .setArray(new Float32Array(geometry.positions))
      .setBuffer(buffer),
    normal: document
      .createAccessor(`${name}_NORMAL`)
      .setType('VEC3')
      .setArray(new Float32Array(geometry.normals))
      .setBuffer(buffer),
    joints: document
      .createAccessor(`${name}_JOINTS_0`)
      .setType('VEC4')
      .setArray(new Uint16Array(geometry.joints))
      .setBuffer(buffer),
    weights: document
      .createAccessor(`${name}_WEIGHTS_0`)
      .setType('VEC4')
      .setArray(new Float32Array(geometry.weights))
      .setBuffer(buffer),
    indices: document
      .createAccessor(`${name}_INDICES`)
      .setType('SCALAR')
      .setArray(indexArray)
      .setBuffer(buffer),
  };
}

/** Position/normal/index subset for unskinned authored hair and prop pieces. */
function createStaticAccessors(document, buffer, name, geometry) {
  if (geometry.positions.length === 0 || geometry.indices.length === 0) {
    fail(`static mesh '${name}' generated empty geometry`);
  }
  const vertexCount = geometry.positions.length / 3;
  const indexArray =
    vertexCount > 65535 ? new Uint32Array(geometry.indices) : new Uint16Array(geometry.indices);
  return {
    position: document
      .createAccessor(`${name}_POSITION`)
      .setType('VEC3')
      .setArray(new Float32Array(geometry.positions))
      .setBuffer(buffer),
    normal: document
      .createAccessor(`${name}_NORMAL`)
      .setType('VEC3')
      .setArray(new Float32Array(geometry.normals))
      .setBuffer(buffer),
    indices: document
      .createAccessor(`${name}_INDICES`)
      .setType('SCALAR')
      .setArray(indexArray)
      .setBuffer(buffer),
  };
}

function addStaticMeshNode(document, parent, name, accessors, material) {
  const primitive = document
    .createPrimitive()
    .setAttribute('POSITION', accessors.position)
    .setAttribute('NORMAL', accessors.normal)
    .setIndices(accessors.indices)
    .setMaterial(material);
  const node = document.createNode(name).setMesh(document.createMesh(name).addPrimitive(primitive));
  parent.addChild(node);
  return node;
}

function addToyMeshNode(document, parent, skin, name, accessors, material) {
  const primitive = document
    .createPrimitive()
    .setAttribute('POSITION', accessors.position)
    .setAttribute('NORMAL', accessors.normal)
    .setAttribute('JOINTS_0', accessors.joints)
    .setAttribute('WEIGHTS_0', accessors.weights)
    .setIndices(accessors.indices)
    .setMaterial(material);
  parent.addChild(
    document
      .createNode(name)
      .setMesh(document.createMesh(name).addPrimitive(primitive))
      .setSkin(skin),
  );
}

function transformPoint(matrix, point) {
  return [
    matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
    matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
    matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
  ];
}

function invertMatrix4(matrix) {
  const [n11, n21, n31, n41, n12, n22, n32, n42, n13, n23, n33, n43, n14, n24, n34, n44] = matrix;
  const t1 = n11 * n22 - n21 * n12;
  const t2 = n11 * n32 - n31 * n12;
  const t3 = n11 * n42 - n41 * n12;
  const t4 = n21 * n32 - n31 * n22;
  const t5 = n21 * n42 - n41 * n22;
  const t6 = n31 * n42 - n41 * n32;
  const t7 = n13 * n24 - n23 * n14;
  const t8 = n13 * n34 - n33 * n14;
  const t9 = n13 * n44 - n43 * n14;
  const t10 = n23 * n34 - n33 * n24;
  const t11 = n23 * n44 - n43 * n24;
  const t12 = n33 * n44 - n43 * n34;
  const determinant = t1 * t12 - t2 * t11 + t3 * t10 + t4 * t9 - t5 * t8 + t6 * t7;
  if (Math.abs(determinant) <= Number.EPSILON) fail('toy rig reshape: singular bind matrix');
  const d = 1 / determinant;
  return [
    (n22 * t12 - n32 * t11 + n42 * t10) * d,
    (n31 * t11 - n21 * t12 - n41 * t10) * d,
    (n24 * t6 - n34 * t5 + n44 * t4) * d,
    (n33 * t5 - n23 * t6 - n43 * t4) * d,
    (n32 * t9 - n12 * t12 - n42 * t8) * d,
    (n11 * t12 - n31 * t9 + n41 * t8) * d,
    (n34 * t3 - n14 * t6 - n44 * t2) * d,
    (n13 * t6 - n33 * t3 + n43 * t2) * d,
    (n12 * t11 - n22 * t9 + n42 * t7) * d,
    (n21 * t9 - n11 * t11 - n41 * t7) * d,
    (n14 * t5 - n24 * t3 + n44 * t1) * d,
    (n23 * t3 - n13 * t5 - n43 * t1) * d,
    (n22 * t8 - n12 * t10 - n32 * t7) * d,
    (n11 * t10 - n21 * t8 + n31 * t7) * d,
    (n24 * t2 - n14 * t4 - n34 * t1) * d,
    (n13 * t4 - n23 * t2 + n33 * t1) * d,
  ];
}

function reshapeToyRig(skin) {
  const joints = skin.listJoints();
  const jointByName = new Map(joints.map((item) => [item.getName(), item]));
  const changes = {};
  const setTranslation = (name, transform) => {
    const item = jointByName.get(name);
    if (!item) fail(`toy rig reshape: required joint '${name}' is missing`);
    const before = item.getTranslation();
    const after = transform([...before]);
    item.setTranslation(after);
    changes[name] = {
      before: before.map((value) => Number(value.toFixed(6))),
      after: after.map((value) => Number(value.toFixed(6))),
    };
  };
  for (const side of ['l', 'r']) {
    setTranslation(`clavicle_${side}`, (value) => [
      value[0],
      value[1] - TOY_SHOULDER_DROP_UNITS,
      value[2],
    ]);
    setTranslation(`lowerarm_${side}`, (value) => scale3(value, TOY_ARM_LENGTH_SCALE));
    setTranslation(`hand_${side}`, (value) => scale3(value, TOY_ARM_LENGTH_SCALE));
  }

  const inverseBindMatrices = skin.getInverseBindMatrices();
  for (let index = 0; index < joints.length; index += 1) {
    const inverse = invertMatrix4(joints[index].getWorldMatrix());
    inverseBindMatrices.setElement(index, inverse);
  }
  return changes;
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function createIO() {
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  io.setLogger(new Logger(Logger.Verbosity.WARN));
  return io;
}

function quietDoc(document) {
  document.setLogger(new Logger(Logger.Verbosity.WARN));
  return document;
}

function disposeSubtree(node) {
  for (const child of node.listChildren()) disposeSubtree(child);
  node.dispose();
}

function toHex(rgb) {
  return `#${rgb
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** Build a chunky toy body on the UBC topology, with an explicit arm bind reshape. */
async function buildToyBody(io, manifest) {
  const document = quietDoc(await io.read(join(BODY_DIR, SOURCE_BODY_GLTF)));
  const root = document.getRoot();
  const scene = root.listScenes()[0];
  const skin = root.listSkins()[0];
  const joints = skin.listJoints();
  if (joints.length !== 65) fail(`toy body: expected the UBC 65-joint rig, got ${joints.length}`);

  const jointByName = new Map(joints.map((joint, index) => [joint.getName(), { joint, index }]));
  const joint = (name) => {
    const match = jointByName.get(name);
    if (!match) fail(`toy body: required joint '${name}' is missing`);
    return match;
  };
  const jointNames = joints.map((item) => item.getName());
  const rigReshape = reshapeToyRig(skin);
  const jointPosition = (name) => joint(name).joint.getWorldTranslation();

  for (const animation of root.listAnimations()) animation.dispose();
  for (const node of root.listNodes().filter((item) => item.getMesh())) {
    const mesh = node.getMesh();
    node.dispose();
    mesh.dispose();
  }

  const buffer = root.listBuffers()[0];
  const skinGeometry = createToyGeometry();
  const topGeometry = createToyGeometry();
  const bottomGeometry = createToyGeometry();
  const shoesGeometry = createToyGeometry();

  const headCenter = jointPosition('Head');
  const headRadiusY = (headCenter[1] - TOY_SHOE_BOTTOM_Y) / (2 * TOY_HEAD_RATIO - 1);
  const headRadii = TOY_PROPORTION_CORRECTIONS.headRadii.map((scale) => headRadiusY * scale);
  const headTop = headCenter[1] + headRadii[1];
  const headBottom = headCenter[1] - headRadii[1];

  addToyEllipsoid(skinGeometry, headCenter, headRadii, joint('Head').index, 10, 14);
  addToyCapsule(
    skinGeometry,
    add3(jointPosition('neck_01'), [0, -0.035, 0]),
    add3(jointPosition('Head'), [0, -0.19, 0]),
    TOY_GEOMETRY.neckRadius,
    joint('neck_01').index,
  );

  const handCenters = {};
  for (const side of ['l', 'r']) {
    const handName = `hand_${side}`;
    const handCenter = add3(jointPosition(handName), [side === 'l' ? 0.018 : -0.018, 0, 0.018]);
    handCenters[side] = handCenter;
    addToyEllipsoid(skinGeometry, handCenter, TOY_GEOMETRY.handRadii, joint(handName).index, 7, 10);
  }

  addToyEllipsoid(
    topGeometry,
    [0, 1.115, -0.018],
    TOY_GEOMETRY.lowerTorsoRadii,
    joint('spine_01').index,
    7,
    12,
  );
  addToyEllipsoid(
    topGeometry,
    [0, 1.345, -0.012],
    TOY_GEOMETRY.chestRadii,
    joint('spine_03').index,
    7,
    12,
  );
  for (const side of ['l', 'r']) {
    addToyCapsule(
      topGeometry,
      jointPosition(`upperarm_${side}`),
      jointPosition(`lowerarm_${side}`),
      TOY_GEOMETRY.upperArmRadius,
      joint(`upperarm_${side}`).index,
    );
    addToyCapsule(
      topGeometry,
      jointPosition(`lowerarm_${side}`),
      jointPosition(`hand_${side}`),
      TOY_GEOMETRY.lowerArmRadius,
      joint(`lowerarm_${side}`).index,
    );
  }

  const pelvisPosition = jointPosition('pelvis');
  const pelvisCenter = add3(pelvisPosition, [0, -0.02, 0]);
  const pelvisRadii = TOY_GEOMETRY.pelvisRadii;
  addToyEllipsoid(bottomGeometry, pelvisCenter, pelvisRadii, joint('pelvis').index, 7, 12);
  const shoeCenters = {};
  for (const side of ['l', 'r']) {
    addToyCapsule(
      bottomGeometry,
      jointPosition(`thigh_${side}`),
      jointPosition(`calf_${side}`),
      TOY_GEOMETRY.thighRadius,
      joint(`thigh_${side}`).index,
    );
    addToyCapsule(
      bottomGeometry,
      jointPosition(`calf_${side}`),
      add3(jointPosition(`foot_${side}`), [0, 0.065, 0.02]),
      TOY_GEOMETRY.calfRadius,
      joint(`calf_${side}`).index,
    );
    const foot = jointPosition(`foot_${side}`);
    const shoeCenter = [foot[0], TOY_SHOE_BOTTOM_Y + TOY_GEOMETRY.shoeRadii[1], 0.04];
    shoeCenters[side] = shoeCenter;
    addToyEllipsoid(
      shoesGeometry,
      shoeCenter,
      TOY_GEOMETRY.shoeRadii,
      joint(`foot_${side}`).index,
      7,
      12,
    );
  }

  const allGeometry = [skinGeometry, topGeometry, bottomGeometry, shoesGeometry];
  const yValues = allGeometry.flatMap((geometry) =>
    geometry.positions.filter((_, index) => index % 3 === 1),
  );
  const bodyMinY = Math.min(...yValues);
  const bodyMaxY = Math.max(...yValues);
  const totalHeight = bodyMaxY - bodyMinY;
  const measuredHeadRatio = totalHeight / (headTop - headBottom);
  if (Math.abs(bodyMinY - TOY_SHOE_BOTTOM_Y) > 1e-4 || Math.abs(bodyMaxY - headTop) > 1e-4) {
    fail(
      `toy body: declared head/shoe landmarks do not bound geometry (geometry ${bodyMinY.toFixed(4)}..${bodyMaxY.toFixed(4)}, landmarks ${TOY_SHOE_BOTTOM_Y.toFixed(4)}..${headTop.toFixed(4)})`,
    );
  }
  if (measuredHeadRatio < TOY_HEAD_RATIO_RANGE[0] || measuredHeadRatio > TOY_HEAD_RATIO_RANGE[1]) {
    fail(
      `toy body: ${measuredHeadRatio.toFixed(3)}-head proportion is outside ` +
        `${TOY_HEAD_RATIO_RANGE[0]}-${TOY_HEAD_RATIO_RANGE[1]}`,
    );
  }

  const makeMaterial = (name, color) =>
    document
      .createMaterial(name)
      .setBaseColorFactor(color)
      .setMetallicFactor(0)
      .setRoughnessFactor(0.94);
  const materials = {
    skinLight: makeMaterial('SkinLight', TOY_SKIN_LIGHT),
    skinDark: makeMaterial('SkinDark', TOY_SKIN_DARK),
    top: makeMaterial('OutfitTop', [1, 1, 1, 1]),
    bottom: makeMaterial('OutfitBottom', [1, 1, 1, 1]),
    shoes: makeMaterial('Shoes', SHOE_BASE_COLOR),
  };
  const skinAccessors = createToyAccessors(document, buffer, 'ToySkin', skinGeometry);
  addToyMeshNode(document, scene, skin, 'Body_Skin_Light', skinAccessors, materials.skinLight);
  addToyMeshNode(document, scene, skin, 'Body_Skin_Dark', skinAccessors, materials.skinDark);
  addToyMeshNode(
    document,
    scene,
    skin,
    'Body_Top',
    createToyAccessors(document, buffer, 'ToyTop', topGeometry),
    materials.top,
  );
  addToyMeshNode(
    document,
    scene,
    skin,
    'Body_Bottom',
    createToyAccessors(document, buffer, 'ToyBottom', bottomGeometry),
    materials.bottom,
  );
  addToyMeshNode(
    document,
    scene,
    skin,
    'Body_Shoes',
    createToyAccessors(document, buffer, 'ToyShoes', shoesGeometry),
    materials.shoes,
  );
  const landmarks = {
    ToyHeadTop: { joint: 'Head', bindPosition: [headCenter[0], headTop, headCenter[2]] },
    ToyChin: { joint: 'Head', bindPosition: [headCenter[0], headBottom, headCenter[2]] },
    ToyButtContact: {
      joint: 'pelvis',
      bindPosition: [pelvisCenter[0], pelvisCenter[1] - pelvisRadii[1], pelvisCenter[2]],
    },
    ToyPalmL: {
      joint: 'hand_l',
      bindPosition: [
        handCenters.l[0],
        handCenters.l[1] - TOY_GEOMETRY.handRadii[1],
        handCenters.l[2],
      ],
    },
    ToyPalmR: {
      joint: 'hand_r',
      bindPosition: [
        handCenters.r[0],
        handCenters.r[1] - TOY_GEOMETRY.handRadii[1],
        handCenters.r[2],
      ],
    },
    ToySoleL: {
      joint: 'foot_l',
      bindPosition: [shoeCenters.l[0], TOY_SHOE_BOTTOM_Y, shoeCenters.l[2]],
    },
    ToySoleR: {
      joint: 'foot_r',
      bindPosition: [shoeCenters.r[0], TOY_SHOE_BOTTOM_Y, shoeCenters.r[2]],
    },
  };
  const inverseBindMatrices = skin.getInverseBindMatrices();
  for (const [name, spec] of Object.entries(landmarks)) {
    const targetJoint = joint(spec.joint);
    const inverseBind = inverseBindMatrices.getElement(targetJoint.index, []);
    const localTranslation = transformPoint(inverseBind, spec.bindPosition);
    const node = document.createNode(name).setTranslation(localTranslation);
    targetJoint.joint.addChild(node);
    const round = (values) => values.map((value) => Number(value.toFixed(6)));
    spec.bindPosition = round(spec.bindPosition);
    spec.jointLocalTranslation = round(localTranslation);
    const world = node.getWorldTranslation();
    if (Math.max(...subtract3(world, spec.bindPosition).map(Math.abs)) > 1e-4) {
      fail(`toy body: landmark '${name}' bind transform does not resolve to its surface point`);
    }
  }

  if (JSON.stringify(jointNames) !== JSON.stringify(joints.map((item) => item.getName()))) {
    fail('toy body: 65-joint topology changed during procedural bind reshape');
  }

  const sceneScale = TOY_METRICS.character.height / totalHeight;
  const shoulderWidthUnits = Math.abs(
    jointPosition('upperarm_l')[0] - jointPosition('upperarm_r')[0],
  );
  const sweaterTorsoWidthUnits =
    shoulderWidthUnits *
    TOY_GARMENTS.torsoWidthToShoulder *
    2 *
    TOY_PROPORTION_CORRECTIONS.garmentTorsoByOutfit.sweater.width;
  const sleeveShoulderWidthUnits =
    shoulderWidthUnits * (1 + 2 * TOY_GARMENTS.upperSleeveStartToShoulder);
  const garmentShoulderWidthUnits = Math.max(sweaterTorsoWidthUnits, sleeveShoulderWidthUnits);
  const round6 = (value) => Number(value.toFixed(6));
  const variantMatrix = [];
  for (const [bodyType, girth] of Object.entries(TOY_CHARACTER_CONTRACT.bodyTypeGirth)) {
    for (const [headShape, headScale] of Object.entries(TOY_CHARACTER_CONTRACT.headShapeScale)) {
      const variantHeadTop = headCenter[1] + headRadii[1] * headScale[1];
      const variantHeadBottom = headCenter[1] - headRadii[1] * headScale[1];
      const totalHeightScene = (variantHeadTop - TOY_SHOE_BOTTOM_Y) * sceneScale;
      const effectiveHeadHeightScene = (variantHeadTop - variantHeadBottom) * sceneScale;
      const headWidthScene = 2 * headRadii[0] * headScale[0] * girth * sceneScale;
      const chestWidthScene = 2 * TOY_GEOMETRY.chestRadii[0] * girth * sceneScale;
      const hipWidthScene = 2 * TOY_GEOMETRY.pelvisRadii[0] * girth * sceneScale;
      const shoulderEnvelopeWidthScene = garmentShoulderWidthUnits * girth * sceneScale;
      const handWidthScene = 2 * TOY_GEOMETRY.handRadii[0] * girth * sceneScale;
      const sleeveWristWidthScene =
        2 * shoulderWidthUnits * TOY_GARMENTS.lowerSleeveEndToShoulder * girth * sceneScale;
      const thighDiameterScene = 2 * TOY_GEOMETRY.thighRadius * girth * sceneScale;
      const shoeWidthScene = 2 * TOY_GEOMETRY.shoeRadii[0] * girth * sceneScale;
      const shoeHeightScene = 2 * TOY_GEOMETRY.shoeRadii[1] * sceneScale;
      const shoeLengthScene = 2 * TOY_GEOMETRY.shoeRadii[2] * girth * sceneScale;
      const ratios = {
        chestToHead: chestWidthScene / headWidthScene,
        garmentShoulderToHead: shoulderEnvelopeWidthScene / headWidthScene,
        thighToChest: thighDiameterScene / chestWidthScene,
        handToHead: handWidthScene / headWidthScene,
        handToSleeve: handWidthScene / sleeveWristWidthScene,
        shoeWidthToHead: shoeWidthScene / headWidthScene,
        shoeLengthToHeight: shoeLengthScene / totalHeightScene,
      };
      const gates = TOY_METRICS.silhouette.gates;
      const pass =
        totalHeightScene >= gates.allHeight[0] &&
        totalHeightScene <= gates.allHeight[1] &&
        totalHeightScene / effectiveHeadHeightScene >= TOY_METRICS.character.minimumHeadCount &&
        totalHeightScene / effectiveHeadHeightScene <= TOY_METRICS.character.maximumHeadCount &&
        (bodyType !== 'normal' || ratios.chestToHead <= gates.allNormalChestToHeadMax) &&
        (bodyType !== 'stocky' || ratios.chestToHead <= gates.stockyChestToHeadMax) &&
        (bodyType !== 'normal' ||
          ratios.garmentShoulderToHead <= gates.normalGarmentShoulderToHeadMax) &&
        (bodyType !== 'stocky' ||
          ratios.garmentShoulderToHead <= gates.stockyGarmentShoulderToHeadMax) &&
        ratios.thighToChest <= gates.thighToChestMax &&
        ratios.handToHead >= gates.handToHead[0] &&
        ratios.handToHead <= gates.handToHead[1] &&
        ratios.handToSleeve >= gates.handToSleeveMin &&
        ratios.shoeWidthToHead <= gates.shoeWidthToHeadMax &&
        ratios.shoeLengthToHeight <= gates.shoeLengthToHeightMax;
      variantMatrix.push({
        id: `${bodyType}:${headShape}`,
        bodyType,
        headShape,
        girth,
        headScale,
        totalHeightScene: round6(totalHeightScene),
        effectiveHeadHeightScene: round6(effectiveHeadHeightScene),
        headCount: round6(totalHeightScene / effectiveHeadHeightScene),
        headWidthScene: round6(headWidthScene),
        chestWidthScene: round6(chestWidthScene),
        hipWidthScene: round6(hipWidthScene),
        shoulderEnvelopeWidthScene: round6(shoulderEnvelopeWidthScene),
        handWidthScene: round6(handWidthScene),
        sleeveWristWidthScene: round6(sleeveWristWidthScene),
        thighDiameterScene: round6(thighDiameterScene),
        shoeWidthScene: round6(shoeWidthScene),
        shoeHeightScene: round6(shoeHeightScene),
        shoeLengthScene: round6(shoeLengthScene),
        ratios: Object.fromEntries(
          Object.entries(ratios).map(([key, value]) => [key, round6(value)]),
        ),
        pass,
      });
    }
  }
  const canonicalVariant = variantMatrix.find((variant) => variant.id === 'normal:round');
  const canonicalChestGate = TOY_METRICS.silhouette.gates.canonicalChestToHead;
  if (
    variantMatrix.some((variant) => !variant.pass) ||
    !canonicalVariant ||
    canonicalVariant.ratios.chestToHead < canonicalChestGate[0] ||
    canonicalVariant.ratios.chestToHead > canonicalChestGate[1] ||
    Math.abs(canonicalVariant.totalHeightScene - TOY_METRICS.character.height) >
      TOY_METRICS.silhouette.gates.roundHeightTolerance
  ) {
    fail('toy body: generated 9-variant silhouette matrix violates toy-performance-metrics gates');
  }

  await document.transform(
    prune({ keepLeaves: true }),
    dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MATERIAL] }),
  );
  await document.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(join(OUT_DIR, 'body_toy.glb'), document);

  manifest.bodies.toy = {
    file: 'body_toy.glb',
    heightUnits: Number(totalHeight.toFixed(4)),
    headHeightUnits: Number((headTop - headBottom).toFixed(4)),
    headRadiiUnits: headRadii.map((value) => Number(value.toFixed(4))),
    headRatio: Number(measuredHeadRatio.toFixed(4)),
    allowedHeadRatio: TOY_HEAD_RATIO_RANGE,
    silhouette:
      'procedural large-head toy body with tapered limbs and readable hands/feet; runtime eye decals, no mouth',
    measurements: {
      source: 'generated procedural geometry plus shipped runtime girth/head-shape contracts',
      sceneScale: round6(sceneScale),
      geometryUnits: TOY_GEOMETRY,
      garmentProportions: TOY_GARMENTS,
      baseEnvelopeUnits: {
        shoulderJointWidth: round6(shoulderWidthUnits),
        worstGarmentShoulderWidth: round6(garmentShoulderWidthUnits),
        chestWidth: round6(TOY_GEOMETRY.chestRadii[0] * 2),
        hipWidth: round6(TOY_GEOMETRY.pelvisRadii[0] * 2),
        handWidth: round6(TOY_GEOMETRY.handRadii[0] * 2),
        shoeWidth: round6(TOY_GEOMETRY.shoeRadii[0] * 2),
        shoeHeight: round6(TOY_GEOMETRY.shoeRadii[1] * 2),
        shoeLength: round6(TOY_GEOMETRY.shoeRadii[2] * 2),
      },
      variantMatrix,
    },
    rig: {
      source: 'Quaternius Universal Base Characters Standard',
      jointCount: joints.length,
      topologyPreserved: true,
      inverseBindMatricesRecomputed: true,
      bindReshape: {
        purpose: 'lower shoulders and shorten forearms/hands for the toy silhouette',
        armLengthScale: TOY_ARM_LENGTH_SCALE,
        shoulderDropUnits: TOY_SHOULDER_DROP_UNITS,
        joints: rigReshape,
      },
    },
    landmarks,
    skinReference: {
      light: toHex(TOY_SKIN_LIGHT.slice(0, 3).map((value) => value * 255)),
      dark: toHex(TOY_SKIN_DARK.slice(0, 3).map((value) => value * 255)),
    },
    skinTintMode: 'direct',
  };
}

function stripToSkeleton(document, keepClipRenames) {
  const root = document.getRoot();
  for (const animation of root.listAnimations()) {
    const neutralName = keepClipRenames[animation.getName()];
    if (!neutralName) {
      for (const channel of animation.listChannels()) channel.dispose();
      for (const sampler of animation.listSamplers()) sampler.dispose();
      animation.dispose();
    } else {
      animation.setName(neutralName);
    }
  }
  for (const node of root.listNodes()) {
    if (node.getMesh()) node.setMesh(null);
    if (node.getSkin()) node.setSkin(null);
  }
  for (const skin of root.listSkins()) skin.dispose();
  for (const mesh of root.listMeshes()) mesh.dispose();
}

function disposeAnimationChannel(animation, channel) {
  const sampler = channel.getSampler();
  const samplerIsShared = animation
    .listChannels()
    .some((candidate) => candidate !== channel && candidate.getSampler() === sampler);
  channel.dispose();
  if (!samplerIsShared) sampler.dispose();
}

function samplerValueIndex(sampler, keyIndex) {
  return sampler.getInterpolation() === 'CUBICSPLINE' ? keyIndex * 3 + 1 : keyIndex;
}

function samplerMaxDelta(sampler) {
  const input = sampler.getInput();
  const output = sampler.getOutput();
  if (!input || !output || input.getCount() === 0) return 0;
  const first = output.getElement(samplerValueIndex(sampler, 0), []);
  let maxDelta = 0;
  for (let keyIndex = 1; keyIndex < input.getCount(); keyIndex += 1) {
    const value = output.getElement(samplerValueIndex(sampler, keyIndex), []);
    for (let component = 0; component < first.length; component += 1) {
      maxDelta = Math.max(maxDelta, Math.abs(value[component] - first[component]));
    }
  }
  return maxDelta;
}

/**
 * Keep rotations plus semantic root/pelvis translations. Constant imported
 * translations on every other joint would overwrite the reshaped toy bind
 * offsets; constant scale tracks similarly carry no animation semantics.
 */
function stripNonSemanticRetargetTracks(document) {
  const result = {
    removedNonRootTranslations: 0,
    removedConstantScales: 0,
    retainedAnimatedScales: 0,
  };
  for (const animation of document.getRoot().listAnimations()) {
    for (const channel of [...animation.listChannels()]) {
      const path = channel.getTargetPath();
      const nodeName = channel.getTargetNode()?.getName();
      if (path === 'translation' && nodeName !== 'root' && nodeName !== 'pelvis') {
        disposeAnimationChannel(animation, channel);
        result.removedNonRootTranslations += 1;
      } else if (path === 'scale') {
        if (samplerMaxDelta(channel.getSampler()) <= TOY_CONSTANT_TRACK_EPSILON) {
          disposeAnimationChannel(animation, channel);
          result.removedConstantScales += 1;
        } else {
          result.retainedAnimatedScales += 1;
        }
      }
    }
  }
  return result;
}

function offsetClipPelvisTranslation(document, clipName, localOffset) {
  const animation = document
    .getRoot()
    .listAnimations()
    .find((candidate) => candidate.getName() === clipName);
  if (!animation) fail(`animations: grounding clip '${clipName}' is missing`);
  const channel = animation
    .listChannels()
    .find(
      (candidate) =>
        candidate.getTargetPath() === 'translation' &&
        candidate.getTargetNode()?.getName() === 'pelvis',
    );
  if (!channel) fail(`animations: grounding clip '${clipName}' has no pelvis translation`);
  const sampler = channel.getSampler();
  const output = sampler.getOutput();
  const outputUseCount = document
    .getRoot()
    .listAnimations()
    .flatMap((candidate) => candidate.listSamplers())
    .filter((candidate) => candidate.getOutput() === output).length;
  if (outputUseCount !== 1) {
    fail(`animations: grounding clip '${clipName}' shares its pelvis output accessor`);
  }
  const input = sampler.getInput();
  for (let keyIndex = 0; keyIndex < input.getCount(); keyIndex += 1) {
    const index = samplerValueIndex(sampler, keyIndex);
    output.setElement(index, add3(output.getElement(index, []), localOffset));
  }
  return {
    clip: clipName,
    joint: 'pelvis',
    localOffset,
    keysAdjusted: input.getCount(),
  };
}

function animationDuration(animation) {
  let duration = 0;
  for (const sampler of animation.listSamplers()) {
    const times = sampler.getInput()?.getArray();
    if (times?.length) duration = Math.max(duration, times[times.length - 1]);
  }
  if (!(duration > 0)) fail(`animations: clip '${animation.getName()}' has no duration`);
  return duration;
}

function normalizeQuaternion(value) {
  const length = Math.hypot(value[0], value[1], value[2], value[3]);
  if (!(length > Number.EPSILON)) fail('animations: cannot normalize a zero quaternion');
  return value.map((component) => component / length);
}

function slerpQuaternion(from, to, amount) {
  let target = to;
  let dot = from[0] * to[0] + from[1] * to[1] + from[2] * to[2] + from[3] * to[3];
  if (dot < 0) {
    dot = -dot;
    target = to.map((component) => -component);
  }
  if (dot > 0.9995) {
    return normalizeQuaternion(
      from.map((component, index) => component + amount * (target[index] - component)),
    );
  }
  const theta = Math.acos(Math.min(1, Math.max(-1, dot)));
  const denominator = Math.sin(theta);
  const fromWeight = Math.sin((1 - amount) * theta) / denominator;
  const toWeight = Math.sin(amount * theta) / denominator;
  return normalizeQuaternion(
    from.map((component, index) => component * fromWeight + target[index] * toWeight),
  );
}

function multiplyQuaternions(left, right) {
  const [ax, ay, az, aw] = left;
  const [bx, by, bz, bw] = right;
  return normalizeQuaternion([
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]);
}

function quaternionFromEulerXYZ([x, y, z]) {
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  return normalizeQuaternion([
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ]);
}

function sampleAnimationChannel(channel, time) {
  const sampler = channel.getSampler();
  const input = sampler.getInput();
  const output = sampler.getOutput();
  const times = input?.getArray();
  if (!input || !output || !times?.length) {
    fail(`animations: cannot sample empty '${channel.getTargetNode()?.getName()}' channel`);
  }
  if (sampler.getInterpolation() === 'CUBICSPLINE') {
    fail('animations: procedural authoring requires LINEAR/STEP source tracks');
  }
  if (time <= times[0]) return output.getElement(samplerValueIndex(sampler, 0), []);
  const last = times.length - 1;
  if (time >= times[last]) return output.getElement(samplerValueIndex(sampler, last), []);
  let right = 1;
  while (times[right] < time) right += 1;
  const left = right - 1;
  const from = output.getElement(samplerValueIndex(sampler, left), []);
  if (sampler.getInterpolation() === 'STEP') return from;
  const to = output.getElement(samplerValueIndex(sampler, right), []);
  const amount = (time - times[left]) / (times[right] - times[left]);
  if (channel.getTargetPath() === 'rotation') return slerpQuaternion(from, to, amount);
  return from.map((component, index) => component + amount * (to[index] - component));
}

function smoothstep(value) {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

function typingPoseWeight(joint) {
  if (joint.startsWith('clavicle_')) return 0.82;
  if (joint.startsWith('upperarm_')) return 0.94;
  if (joint.startsWith('lowerarm_')) return 0.98;
  if (joint === 'hand_l') return 1;
  if (joint === 'hand_r') return 0.96;
  return 0;
}

function typingEulerDelta(joint, normalizedTime) {
  const alternating = Math.sin(normalizedTime * Math.PI * 4);
  const cycle = Math.sin(normalizedTime * Math.PI * 2);
  switch (joint) {
    case 'lowerarm_l':
      return [0.008 * cycle, 0, 0];
    case 'lowerarm_r':
      return [0.025 * alternating, 0, 0];
    case 'hand_r':
      return [0.09 * alternating, 0, 0.025 * cycle];
    case 'index_01_r':
      return [0.14 * Math.max(0, alternating), 0, 0];
    case 'middle_01_r':
      return [0.14 * Math.max(0, -alternating), 0, 0];
    default:
      return [0, 0, 0];
  }
}

/*
 * Direct-V2 derived clip design (mirrors derive-character-action-clips.mjs).
 * All periodic terms complete an integer number of cycles per loop so
 * first/last frames match exactly; lower-body tracks stay exact base copies.
 */
const DERIVED_TAU = Math.PI * 2;

function fidgetPoseWeight(joint) {
  if (joint.startsWith('clavicle_')) return 0.35;
  if (joint.startsWith('upperarm_')) return 0.45;
  if (joint.startsWith('lowerarm_')) return 0.6;
  if (joint === 'hand_l') return 0.65;
  if (joint === 'hand_r') return 0.6;
  return 0;
}

function fidgetEulerDelta(joint, normalizedTime) {
  const slow = Math.sin(normalizedTime * DERIVED_TAU);
  const mid = Math.sin(normalizedTime * DERIVED_TAU * 2);
  const quick = Math.sin(normalizedTime * DERIVED_TAU * 3);
  switch (joint) {
    case 'lowerarm_l':
      return [0.02 * quick, 0, 0.012 * mid];
    case 'lowerarm_r':
      return [-0.02 * quick, 0, -0.012 * mid];
    case 'hand_l':
      return [0.045 * quick, 0.03 * mid, 0];
    case 'hand_r':
      return [-0.045 * quick, -0.03 * mid, 0];
    case 'spine_01':
      return [0.012 * slow, 0, 0.01 * mid];
    case 'Head':
      return [0.02 * mid, 0.035 * slow, 0];
    default:
      return [0, 0, 0];
  }
}

function lookAroundEulerDelta(joint, normalizedTime) {
  const scan = Math.sin(normalizedTime * DERIVED_TAU);
  const nod = Math.sin(normalizedTime * DERIVED_TAU * 2);
  switch (joint) {
    case 'neck_01':
      return [0.03 * nod, 0.16 * scan, 0];
    case 'Head':
      return [0.05 * nod, 0.3 * scan, 0];
    case 'spine_03':
      return [0, 0.04 * scan, 0];
    default:
      return [0, 0, 0];
  }
}

function stretchEnvelope(normalizedTime) {
  return Math.sin(normalizedTime * Math.PI);
}

function stretchPoseWeight(joint, normalizedTime) {
  const envelope = stretchEnvelope(normalizedTime);
  if (joint.startsWith('clavicle_')) return 0.3 * envelope;
  if (joint.startsWith('upperarm_')) return 0.5 * envelope;
  if (joint.startsWith('lowerarm_')) return 0.35 * envelope;
  if (joint.startsWith('hand_')) return 0.3 * envelope;
  if (joint === 'spine_02' || joint === 'spine_03') return 0.25 * envelope;
  if (joint === 'neck_01' || joint === 'Head') return 0.2 * envelope;
  return 0;
}

function stretchEulerDelta(joint, normalizedTime) {
  const envelope = stretchEnvelope(normalizedTime);
  switch (joint) {
    case 'spine_02':
      return [-0.05 * envelope, 0, 0];
    case 'Head':
      return [-0.06 * envelope, 0, 0];
    default:
      return [0, 0, 0];
  }
}

function saveSkeletonPose(document) {
  return document
    .getRoot()
    .listNodes()
    .map((node) => ({
      node,
      translation: node.getTranslation(),
      rotation: node.getRotation(),
      scale: node.getScale(),
    }));
}

function restoreSkeletonPose(saved) {
  for (const { node, translation, rotation, scale } of saved) {
    node.setTranslation(translation);
    node.setRotation(rotation);
    node.setScale(scale);
  }
}

function averageHandHeight(document, animation, time) {
  for (const channel of animation.listChannels()) {
    const node = channel.getTargetNode();
    if (!node) continue;
    const value = sampleAnimationChannel(channel, time);
    const path = channel.getTargetPath();
    if (path === 'rotation') node.setRotation(value);
    else if (path === 'translation') node.setTranslation(value);
    else if (path === 'scale') node.setScale(value);
  }
  const nodesByName = new Map(
    document
      .getRoot()
      .listNodes()
      .map((node) => [node.getName(), node]),
  );
  const left = nodesByName.get('hand_l');
  const right = nodesByName.get('hand_r');
  if (!left || !right) fail('animations: rig is missing hand joints');
  return (left.getWorldTranslation()[1] + right.getWorldTranslation()[1]) / 2;
}

/**
 * Deterministically pick (clip, normalizedTime) with the highest average
 * hand position across the celebration candidates — the most readable
 * arms-up reference for the restrained stretch. Same rule as
 * derive-character-action-clips.mjs so both pipelines agree.
 */
function pickStretchReference(document) {
  const candidates = ['celebrate.yes', 'celebrate.dance'];
  const saved = saveSkeletonPose(document);
  let best = null;
  for (const name of candidates) {
    const animation = document
      .getRoot()
      .listAnimations()
      .find((candidate) => candidate.getName() === name);
    if (!animation) fail(`animations: stretch reference candidate '${name}' is missing`);
    const duration = animationDuration(animation);
    for (let step = 0; step <= 20; step += 1) {
      const normalizedTime = step / 20;
      const height = averageHandHeight(document, animation, normalizedTime * duration);
      if (best === null || height > best.height) {
        best = { clip: name, normalizedTime, height };
      }
    }
  }
  restoreSkeletonPose(saved);
  return { clip: best.clip, normalizedTime: best.normalizedTime };
}

function addAnimationChannel(document, animation, buffer, sourceChannel, inputArray, outputArray) {
  const target = sourceChannel.getTargetNode();
  const path = sourceChannel.getTargetPath();
  if (!target) fail(`animations: procedural '${animation.getName()}' channel target is missing`);
  const key = `${animation.getName()}_${target.getName()}_${path}`;
  const sourceInput = sourceChannel.getSampler().getInput();
  const sourceOutput = sourceChannel.getSampler().getOutput();
  const input = document
    .createAccessor(`${key}_input`)
    .setType(sourceInput.getType())
    .setArray(inputArray)
    .setBuffer(buffer);
  const output = document
    .createAccessor(`${key}_output`)
    .setType(sourceOutput.getType())
    .setNormalized(sourceOutput.getNormalized())
    .setArray(outputArray)
    .setBuffer(buffer);
  const sampler = document
    .createAnimationSampler()
    .setInterpolation(sourceChannel.getSampler().getInterpolation())
    .setInput(input)
    .setOutput(output);
  const channel = document
    .createAnimationChannel()
    .setTargetNode(target)
    .setTargetPath(path)
    .setSampler(sampler);
  animation.addSampler(sampler).addChannel(channel);
}

function createProceduralAnimation(document, name, spec) {
  const root = document.getRoot();
  const base = root.listAnimations().find((animation) => animation.getName() === spec.baseClip);
  const reference = root
    .listAnimations()
    .find((animation) => animation.getName() === spec.poseReferenceClip);
  if (!base || !reference) {
    fail(
      `animations: '${name}' source clips missing ` +
        `(base=${spec.baseClip}, reference=${spec.poseReferenceClip})`,
    );
  }
  const buffer = root.listBuffers()[0];
  if (!buffer) fail(`animations: '${name}' has no target buffer`);
  const baseDuration = animationDuration(base);
  const referenceDuration = animationDuration(reference);
  const referenceChannels = new Map(
    reference
      .listChannels()
      .map((channel) => [
        `${channel.getTargetNode()?.getName()}:${channel.getTargetPath()}`,
        channel,
      ]),
  );
  const modified = new Set(spec.modifiedJoints);
  const observed = new Set();
  const animation = document.createAnimation(name);

  for (const sourceChannel of base.listChannels()) {
    const sampler = sourceChannel.getSampler();
    const sourceInput = sampler.getInput();
    const sourceOutput = sampler.getOutput();
    const sourceTimes = sourceInput?.getArray();
    const sourceValues = sourceOutput?.getArray();
    const joint = sourceChannel.getTargetNode()?.getName();
    const path = sourceChannel.getTargetPath();
    if (!sourceInput || !sourceOutput || !sourceTimes || !sourceValues || !joint) {
      fail(`animations: '${name}' cannot clone an incomplete base channel`);
    }

    if (path === 'rotation' && modified.has(joint)) {
      observed.add(joint);
      const referenceChannel = referenceChannels.get(`${joint}:rotation`);
      if (!referenceChannel) fail(`animations: '${name}' reference rotation '${joint}' missing`);
      const frameCount = Math.round(spec.durationSeconds * 30) + 1;
      const times = new Float32Array(frameCount);
      const values = new Float32Array(frameCount * 4);
      for (let frame = 0; frame < frameCount; frame += 1) {
        const normalizedTime = frame / (frameCount - 1);
        times[frame] = normalizedTime * spec.durationSeconds;
        const baseRotation = sampleAnimationChannel(sourceChannel, normalizedTime * baseDuration);
        const referenceRotation = sampleAnimationChannel(
          referenceChannel,
          spec.poseReferenceTime * referenceDuration,
        );
        const poseWeight = spec.poseWeightFor(joint, normalizedTime);
        let rotation = slerpQuaternion(baseRotation, referenceRotation, poseWeight);
        rotation = multiplyQuaternions(
          rotation,
          quaternionFromEulerXYZ(spec.eulerDeltaFor(joint, normalizedTime)),
        );
        values.set(rotation, frame * 4);
      }
      addAnimationChannel(document, animation, buffer, sourceChannel, times, values);
      continue;
    }

    const times = sourceTimes.slice();
    for (let index = 0; index < times.length; index += 1) {
      times[index] = (times[index] / baseDuration) * spec.durationSeconds;
    }
    addAnimationChannel(document, animation, buffer, sourceChannel, times, sourceValues.slice());
  }

  const missing = spec.modifiedJoints.filter((joint) => !observed.has(joint));
  if (missing.length > 0)
    fail(`animations: '${name}' did not author joints [${missing.join(', ')}]`);
  return {
    baseClip: spec.baseClip,
    poseReferenceClip: spec.poseReferenceClip,
    mode: spec.mode,
    durationSeconds: spec.durationSeconds,
    sampleRate: 30,
    modifiedJoints: spec.modifiedJoints,
    lowerBodyPolicy: `exact ${spec.baseClip} channels with duration-normalized key times`,
  };
}

/**
 * Assert that every retained clip is in-place for every translation key, not
 * merely at its endpoints. This intentionally targets the skeleton `root`;
 * the retargeted library otherwise retains only semantic pelvis translations.
 */
function assertInPlaceRootMotion(animations) {
  let maxObservedAbsDelta = 0;
  let translationChannelsChecked = 0;
  const clips = {};
  for (const animation of animations) {
    let clipMax = 0;
    let keysChecked = 0;
    let rootTranslationTracks = 0;
    for (const channel of animation.listChannels()) {
      if (
        channel.getTargetPath() !== 'translation' ||
        channel.getTargetNode()?.getName() !== 'root'
      ) {
        continue;
      }
      rootTranslationTracks += 1;
      translationChannelsChecked += 1;
      const sampler = channel.getSampler();
      const input = sampler.getInput();
      const output = sampler.getOutput();
      if (!input || !output || input.getCount() === 0) {
        fail(`animations: clip '${animation.getName()}' has an empty root translation channel`);
      }
      const first = output.getElement(samplerValueIndex(sampler, 0), []);
      for (let keyIndex = 0; keyIndex < input.getCount(); keyIndex += 1) {
        const value = output.getElement(samplerValueIndex(sampler, keyIndex), []);
        for (let axis = 0; axis < 3; axis += 1) {
          const delta = Math.abs(value[axis] - first[axis]);
          clipMax = Math.max(clipMax, delta);
          maxObservedAbsDelta = Math.max(maxObservedAbsDelta, delta);
        }
        keysChecked += 1;
      }
    }
    if (rootTranslationTracks !== 1) {
      fail(
        `animations: clip '${animation.getName()}' has ${rootTranslationTracks} root translation tracks (expected 1)`,
      );
    }
    if (clipMax > ROOT_MOTION_MAX_DELTA) {
      fail(
        `animations: clip '${animation.getName()}' root translation drifts by ` +
          `${clipMax} (limit ${ROOT_MOTION_MAX_DELTA})`,
      );
    }
    clips[animation.getName()] = {
      keysChecked,
      rootTranslationTracks,
      maxAbsDelta: Number(clipMax.toFixed(8)),
    };
  }
  return {
    sourceFiles: ['UAL1_Standard.glb', 'UAL2_Standard.glb'],
    sourceMode: 'non-root-motion',
    targetNode: 'root',
    allTranslationKeysChecked: true,
    maxAbsDeltaThreshold: ROOT_MOTION_MAX_DELTA,
    maxObservedAbsDelta: Number(maxObservedAbsDelta.toFixed(8)),
    clipsChecked: animations.length,
    translationChannelsChecked,
    clips,
    result: 'pass',
  };
}

async function buildAnimations(io, manifest) {
  const target = quietDoc(await io.read(UAL1_GLB));
  stripToSkeleton(target, UAL1_CLIP_RENAMES);
  const ual1Retarget = stripNonSemanticRetargetTracks(target);
  const targetNodesByName = new Map(
    target
      .getRoot()
      .listNodes()
      .map((node) => [node.getName(), node]),
  );

  const source = quietDoc(await io.read(UAL2_GLB));
  stripToSkeleton(source, UAL2_CLIP_RENAMES);
  const ual2Retarget = stripNonSemanticRetargetTracks(source);
  const carryGrounding = offsetClipPelvisTranslation(source, 'carry', [
    0,
    0,
    TOY_CARRY_GROUND_LIFT_UNITS,
  ]);
  const clipCountBefore = target.getRoot().listAnimations().length;
  mergeDocuments(target, source);

  const root = target.getRoot();
  const mergedAnimations = root.listAnimations().slice(clipCountBefore);
  const dropped = new Set();
  for (const animation of mergedAnimations) {
    for (const channel of animation.listChannels()) {
      const node = channel.getTargetNode();
      if (!node) continue;
      const match = targetNodesByName.get(node.getName());
      if (match) {
        channel.setTargetNode(match);
      } else {
        dropped.add(node.getName());
        channel.dispose();
      }
    }
  }
  // Drop the merged UAL2 scene + its now-retargeted skeleton copy.
  const scenes = root.listScenes();
  for (const scene of scenes.slice(1)) {
    for (const child of scene.listChildren()) disposeSubtree(child);
    scene.dispose();
  }
  root.setDefaultScene(scenes[0]);
  if (dropped.size > 0)
    console.log(`  animations: dropped channels targeting [${[...dropped].join(', ')}]`);

  const stretchReference = pickStretchReference(target);
  const proceduralSpecs = {
    ...PROCEDURAL_ANIMATION_SPECS,
    stretch: {
      ...PROCEDURAL_ANIMATION_SPECS.stretch,
      poseReferenceClip: stretchReference.clip,
      poseReferenceTime: stretchReference.normalizedTime,
    },
  };
  const proceduralAnimations = Object.fromEntries(
    Object.entries(proceduralSpecs).map(([name, spec]) => [
      name,
      createProceduralAnimation(target, name, spec),
    ]),
  );

  // Every remaining track must target a bone that exists on the UBC body rig.
  const bodyDoc = quietDoc(await io.read(join(BODY_DIR, SOURCE_BODY_GLTF)));
  const bodyBoneNames = new Set(
    bodyDoc
      .getRoot()
      .listSkins()[0]
      .listJoints()
      .map((joint) => joint.getName()),
  );
  for (const animation of root.listAnimations()) {
    for (const channel of animation.listChannels()) {
      const node = channel.getTargetNode();
      if (node && !bodyBoneNames.has(node.getName())) {
        fail(
          `animations: clip '${animation.getName()}' targets '${node.getName()}' missing on the UBC rig`,
        );
      }
    }
  }

  await target.transform(resample(), prune(), dedup(), unpartition());
  // The oracle audits the exact tracks being shipped (post-resample), matching
  // the ledger semantics of derive-character-action-clips.mjs.
  manifest.rootMotionOracle = assertInPlaceRootMotion(root.listAnimations());
  await target.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));

  const clipNames = root
    .listAnimations()
    .map((animation) => animation.getName())
    .sort();
  const expected = [
    ...Object.values(UAL1_CLIP_RENAMES),
    ...Object.values(UAL2_CLIP_RENAMES),
    ...Object.keys(PROCEDURAL_ANIMATION_SPECS),
  ].sort();
  if (JSON.stringify(clipNames) !== JSON.stringify(expected)) {
    fail(
      `animations: clip set mismatch\n  got:      ${clipNames.join(', ')}\n  expected: ${expected.join(', ')}`,
    );
  }
  if (clipNames.length > MAX_ANIMATION_CLIPS) {
    fail(`animations: clip budget exceeded (${clipNames.length}/${MAX_ANIMATION_CLIPS})`);
  }

  await io.write(join(OUT_DIR, 'animations.glb'), target);
  manifest.clips = clipNames;
  manifest.clipSources = {
    ...Object.fromEntries(Object.entries(UAL1_CLIP_RENAMES).map(([k, v]) => [v, `UAL1:${k}`])),
    ...Object.fromEntries(Object.entries(UAL2_CLIP_RENAMES).map(([k, v]) => [v, `UAL2:${k}`])),
    ...Object.fromEntries(
      Object.keys(PROCEDURAL_ANIMATION_SPECS).map((name) => [name, `offisim-procedural:${name}`]),
    ),
  };
  manifest.proceduralAnimations = proceduralAnimations;
  manifest.animationRetarget = {
    nonRootTranslationPolicy: 'removed; toy body bind offsets remain authoritative',
    scalePolicy: 'constant tracks removed; animated scale tracks retained',
    clipGrounding: {
      ...carryGrounding,
      worldEffect: 'constant vertical lift; does not create root-motion drift',
    },
    sourceTrackCleanup: { UAL1: ual1Retarget, UAL2: ual2Retarget },
  };
}

async function buildProps(io, manifest) {
  const props = quietDoc(new Document());
  const buffer = props.createBuffer();
  const scene = props.createScene('props');
  props.getRoot().setDefaultScene(scene);

  const authoredMaterials = new Map();
  const materialFor = (name, color) => {
    const key = `${name}:${color.join(',')}`;
    const existing = authoredMaterials.get(key);
    if (existing) return existing;
    const material = props
      .createMaterial(name)
      .setBaseColorFactor(color)
      .setMetallicFactor(0)
      .setRoughnessFactor(0.78);
    authoredMaterials.set(key, material);
    return material;
  };
  const ellipsoid = (center, radii, color, name = 'surface') => {
    const geometry = createToyGeometry();
    addToyEllipsoid(geometry, center, radii, 0, 6, 10);
    return { geometry, color, name };
  };
  const capsule = (start, end, radius, color, name = 'trim') => {
    const geometry = createToyGeometry();
    addToyCapsule(geometry, start, end, radius, 0, 9);
    return { geometry, color, name };
  };
  const addAuthoredProp = (nodeName, parts) => {
    const group = props.createNode(nodeName);
    scene.addChild(group);
    parts.forEach((part, index) => {
      addStaticMeshNode(
        props,
        group,
        `${nodeName}_${part.name}_${index + 1}`,
        createStaticAccessors(props, buffer, `${nodeName}_${index + 1}`, part.geometry),
        materialFor(part.name, part.color),
      );
    });
    manifest.props[nodeName] = 'offisim-procedural:toy-work-accessory';
  };
  const ink = [0.12, 0.15, 0.18, 1];
  const paper = [0.82, 0.78, 0.68, 1];
  const blue = [0.25, 0.46, 0.65, 1];
  const teal = [0.3, 0.55, 0.52, 1];
  const amber = [0.7, 0.5, 0.25, 1];
  const violet = [0.52, 0.4, 0.63, 1];

  const absorb = (sourceDoc, nodeName) => {
    mergeDocuments(props, sourceDoc);
    const mergedScene = props.getRoot().listScenes().at(-1);
    const children = mergedScene.listChildren();
    if (children.length !== 1) fail(`${nodeName}: expected a single root node`);
    const node = children[0].setName(nodeName);
    scene.addChild(node);
    mergedScene.dispose();
    return node;
  };

  for (const [nodeName, file] of Object.entries(KENNEY_PROPS)) {
    absorb(quietDoc(await io.read(join(KENNEY_DIR, file))), nodeName);
    manifest.props[nodeName] = `kenney-furniture-kit:${file}`;
  }
  addAuthoredProp('prop_clipboard', [
    ellipsoid([0, 0, 0], [0.18, 0.25, 0.025], paper, 'board'),
    capsule([-0.055, 0.19, 0.032], [0.055, 0.19, 0.032], 0.032, ink, 'clip'),
  ]);
  addAuthoredProp('prop_tablet', [
    ellipsoid([0, 0, 0], [0.18, 0.25, 0.03], ink, 'shell'),
    ellipsoid([0, 0.005, 0.033], [0.145, 0.21, 0.008], blue, 'screen'),
  ]);
  addAuthoredProp('prop_terminal', [
    ellipsoid([0, 0.055, 0], [0.21, 0.17, 0.035], ink, 'shell'),
    ellipsoid([0, 0.06, 0.038], [0.17, 0.125, 0.008], teal, 'screen'),
    capsule([-0.15, -0.13, 0], [0.15, -0.13, 0], 0.045, ink, 'keyboard'),
  ]);
  addAuthoredProp('prop_pointer', [
    capsule([0, -0.28, 0], [0, 0.28, 0], 0.018, ink, 'shaft'),
    ellipsoid([0, 0.31, 0], [0.035, 0.06, 0.035], amber, 'tip'),
  ]);
  addAuthoredProp('prop_headset', [
    capsule([-0.34, 0, 0], [-0.34, 0.15, 0], 0.035, ink, 'band'),
    capsule([-0.34, 0.15, 0], [-0.18, 0.31, 0], 0.035, ink, 'band'),
    capsule([-0.18, 0.31, 0], [0.18, 0.31, 0], 0.035, ink, 'band'),
    capsule([0.18, 0.31, 0], [0.34, 0.15, 0], 0.035, ink, 'band'),
    capsule([0.34, 0.15, 0], [0.34, 0, 0], 0.035, ink, 'band'),
    ellipsoid([-0.35, -0.03, 0], [0.07, 0.1, 0.06], blue, 'earpad'),
    ellipsoid([0.35, -0.03, 0], [0.07, 0.1, 0.06], blue, 'earpad'),
    capsule([0.35, -0.05, 0.03], [0.22, -0.18, 0.17], 0.018, ink, 'microphone'),
  ]);
  addAuthoredProp('prop_swatch', [
    ellipsoid([-0.055, 0.02, 0], [0.12, 0.24, 0.018], violet, 'card'),
    ellipsoid([0, 0, 0.022], [0.12, 0.24, 0.018], teal, 'card'),
    ellipsoid([0.055, -0.02, 0.044], [0.12, 0.24, 0.018], amber, 'card'),
    ellipsoid([0, -0.19, 0.07], [0.03, 0.03, 0.025], ink, 'pin'),
  ]);
  addAuthoredProp('prop_checklist', [
    ellipsoid([0, 0, 0], [0.18, 0.25, 0.025], paper, 'board'),
    capsule([-0.09, 0.12, 0.035], [0.1, 0.12, 0.035], 0.014, teal, 'check'),
    capsule([-0.09, 0.02, 0.035], [0.1, 0.02, 0.035], 0.014, teal, 'check'),
    capsule([-0.09, -0.08, 0.035], [0.1, -0.08, 0.035], 0.014, teal, 'check'),
  ]);
  addAuthoredProp('prop_keycard', [
    capsule([-0.09, 0.22, 0], [0, 0.34, 0], 0.014, ink, 'lanyard'),
    capsule([0, 0.34, 0], [0.09, 0.22, 0], 0.014, ink, 'lanyard'),
    ellipsoid([0, 0, 0], [0.15, 0.2, 0.025], blue, 'card'),
    ellipsoid([0, 0.055, 0.03], [0.075, 0.06, 0.008], paper, 'label'),
  ]);

  // Kenney files ship KHR_materials_unlit — drop it so props take scene lighting.
  for (const material of props.getRoot().listMaterials()) {
    material.setExtension('KHR_materials_unlit', null);
    material.setMetallicFactor(0);
  }
  for (const extension of props.getRoot().listExtensionsUsed()) {
    if (extension.extensionName === 'KHR_materials_unlit') extension.dispose();
  }

  await props.transform(prune(), dedup(), unpartition());
  await props.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(join(OUT_DIR, 'props.glb'), props);
}

function writeLicenses() {
  const packs = [
    {
      name: 'Universal Base Characters [Standard] — Quaternius',
      url: 'https://quaternius.itch.io/universal-base-characters',
      license: join(UBC_DIR, 'License_Standard.txt'),
      used: 'Superhero male 65-joint rig topology (body skeleton basis).',
    },
    {
      name: 'Universal Animation Library [Standard] — Quaternius',
      url: 'https://quaternius.itch.io/universal-animation-library',
      license: join(RAW_DIR, 'unpacked/ual/Universal Animation Library[Standard]/License.txt'),
      used: 'Animation clips (idle/talk/walk/sit/interact/pickup/dance families).',
    },
    {
      name: 'Universal Animation Library 2 [Standard] — Quaternius',
      url: 'https://quaternius.itch.io/universal-animation-library-2',
      license: join(RAW_DIR, 'unpacked/ual2/Universal Animation Library 2[Standard]/License.txt'),
      used: 'Animation clips (fold-arms/head-shake/phone/carry/chest-open/consume/yes).',
    },
    {
      name: 'Furniture Kit (2.0) — Kenney (kenney.nl)',
      url: 'https://kenney.nl/assets/furniture-kit',
      license: join(RAW_DIR, 'unpacked/kenney-furniture/License.txt'),
      used: 'laptop prop.',
    },
  ];
  const sections = packs.map((pack) => {
    if (!existsSync(pack.license)) fail(`license file missing: ${pack.license}`);
    const text = readFileSync(pack.license, 'utf8')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n')
      .trim();
    return [
      `## ${pack.name}`,
      '',
      `- Source: ${pack.url}`,
      '- License: CC0 1.0 Universal (public domain) — https://creativecommons.org/publicdomain/zero/1.0/',
      `- Used for: ${pack.used}`,
      '',
      '```text',
      text,
      '```',
    ].join('\n');
  });
  const header = [
    '# Character Asset Licenses',
    '',
    'Third-party derivatives in this directory come from the CC0 1.0 packs below',
    'and are built by `scripts/build-character-assets.mjs`. Original license texts follow.',
    '',
    '## Offisim-authored procedural geometry',
    '',
    '- Source: `scripts/build-character-assets.mjs` in this repository.',
    '- License: covered by the Offisim repository license; no third-party asset input.',
    '- Used for: toy capsule body, runtime eye contract, all twelve non-bald toy hairstyles',
    '  generated by `scripts/build-character-hair-assets.mjs`, and the',
    '  clipboard, tablet, terminal, pointer, headset, swatch, checklist, and keycard props.',
    '',
    '## Offisim-authored procedural animation derivatives',
    '',
    '- Build logic: `scripts/build-character-assets.mjs` in this repository.',
    '- Source clips: Quaternius CC0 rig clips from the packs listed below.',
    '- License: the baked animation derivatives remain CC0 1.0; the build logic is',
    '  covered by the Offisim repository license.',
    '- Used for: the `sit.type`, `approval.wait`, `look.around`, `sit.fidget`, and',
    '  `stretch` animation tracks.',
    '',
  ].join('\n');
  writeFileSync(join(OUT_DIR, 'LICENSES.md'), `${header}\n${sections.join('\n\n')}\n`);
}

async function main() {
  // RAW_DIR existence is enforced by requireRawDir() at module load.
  await MeshoptEncoder.ready;
  mkdirSync(OUT_DIR, { recursive: true });
  const io = createIO();
  const manifest = { version: 4, bodies: {}, hair: {}, props: {} };

  console.log('building body_toy.glb');
  await buildToyBody(io, manifest);
  await buildToyHairAssets({ io, outDir: OUT_DIR, manifest });
  console.log('building animations.glb');
  await buildAnimations(io, manifest);
  console.log('building props.glb');
  await buildProps(io, manifest);
  writeLicenses();

  const files = [
    'body_toy.glb',
    ...HAIR_ASSET_IDS.map((name) => `${name}.glb`),
    'animations.glb',
    'props.glb',
    'LICENSES.md',
  ].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const shippedFiles = new Set(files);
  for (const entry of readdirSync(OUT_DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.glb') && !shippedFiles.has(entry.name)) {
      rmSync(join(OUT_DIR, entry.name), { force: true });
    }
  }
  let total = 0;
  const sizes = {};
  for (const file of files) {
    const bytes = statSync(join(OUT_DIR, file)).size;
    sizes[file] = bytes;
    total += bytes;
  }
  manifest.files = sizes;
  manifest.totalBytes = total;
  writeFileSync(join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log('\nSize manifest:');
  for (const [file, bytes] of Object.entries(sizes)) {
    console.log(`  ${file.padEnd(18)} ${(bytes / 1024).toFixed(1).padStart(9)} KB`);
  }
  console.log(`  ${'TOTAL'.padEnd(18)} ${(total / 1024 / 1024).toFixed(2).padStart(9)} MB`);
  if (total > SIZE_BUDGET_BYTES) {
    fail(`total output ${(total / 1024 / 1024).toFixed(2)} MB exceeds the 25 MB budget`);
  }
  console.log('\nOK: character assets built within budget.');
}

await main();
