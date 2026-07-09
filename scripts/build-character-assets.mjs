#!/usr/bin/env node
/**
 * Character asset pipeline (production-work-dramaturgy I6).
 *
 * Reads the raw CC0 packs (Quaternius Universal Base Characters + Universal
 * Animation Library 1/2, Kenney Furniture Kit, KayKit Furniture Bits) from
 * RAW_DIR and emits the shipped runtime set into
 * `apps/desktop/renderer/src/assets/characters/`:
 *
 *   body_toy.glb                      procedural toy capsule body on the exact
 *                                     65-joint UBC rig, with machine-sampleable
 *                                     head/contact landmark nodes.
 *   hair_01..06.glb, brows_01..02.glb head-bone-baked static meshes (source
 *                                     meshes are 100% `Head`-weighted; verified
 *                                     at build time) with grayscale-normalized
 *                                     basecolor so hair color is a pure multiply.
 *   animations.glb                    one shared clip library on the 65-bone rig
 *                                     (mannequin stripped), clips renamed to the
 *                                     neutral scheme below.
 *   props.glb                         laptop / monitor / box / books / book as
 *                                     flat retintable materials.
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

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Document, Logger, NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  mergeDocuments,
  meshopt,
  prune,
  resample,
  transformMesh,
  unpartition,
} from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

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
      '  KayKit Furniture Bits (github)         https://kaylousberg.itch.io/furniture-bits',
      '',
      'Expected layout under $CHARACTER_ASSETS_RAW_DIR:',
      '  unpacked/ubc/Universal Base Characters[Standard]/            (bodies, hairstyles, License_Standard.txt)',
      '  unpacked/ual/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb  (+ License.txt)',
      '  unpacked/ual2/Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb (+ License.txt)',
      '  unpacked/kenney-furniture/Models/GLTF format/                (+ License.txt)',
      '  kaykit-furniture-github/addons/kaykit_furniture_bits/Assets/ (+ LICENSE.txt)',
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
const SIZE_BUDGET_BYTES = 25 * 1024 * 1024;
const ROOT_MOTION_MAX_DELTA = 1e-5;
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
const HAIR_DIR = join(UBC_DIR, 'Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)');
const UAL1_GLB = join(
  RAW_DIR,
  'unpacked/ual/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb',
);
const UAL2_GLB = join(
  RAW_DIR,
  'unpacked/ual2/Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb',
);
const KENNEY_DIR = join(RAW_DIR, 'unpacked/kenney-furniture/Models/GLTF format');
const KAYKIT_DIR = join(RAW_DIR, 'kaykit-furniture-github/addons/kaykit_furniture_bits/Assets');

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

const SOURCE_BODY_GLTF = 'Superhero_Male_FullBody.gltf';

const HAIR_FILES = {
  hair_01: 'Hair_SimpleParted',
  hair_02: 'Hair_Long',
  hair_03: 'Hair_Buns',
  hair_04: 'Hair_Buzzed',
  hair_05: 'Hair_BuzzedFemale',
  hair_06: 'Hair_Beard',
  brows_01: 'Eyebrows_Regular',
  brows_02: 'Eyebrows_Female',
};

const KENNEY_PROPS = {
  prop_laptop: 'laptop.glb',
  prop_monitor: 'computerScreen.glb',
  prop_box: 'cardboardBoxClosed.glb',
  prop_books: 'books.glb',
};

const HAIR_TEXTURE_SIZE = 512;
const BROWS_TEXTURE_SIZE = 256;
/** Grayscale-normalized hair mean luminance target (0-255): multiply-tint base. */
const HAIR_LUMINANCE_TARGET = 184;
const SHOE_BASE_COLOR = [0.16, 0.17, 0.2, 1];
const BOOK_BASE_COLOR = [0.61, 0.3, 0.29, 1];
const TOY_SKIN_LIGHT = [0.651, 0.471, 0.345, 1];
const TOY_SKIN_DARK = [0.612, 0.431, 0.306, 1];
const TOY_EYE_COLOR = [0.035, 0.043, 0.055, 1];

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

async function grayscaleNormalizedPng(input, size, meanTarget) {
  const gray = sharp(input).resize(size, size, { fit: 'fill' }).greyscale();
  const stats = await gray.clone().stats();
  const mean = stats.channels[0].mean || 1;
  const factor = Math.max(0.5, Math.min(3, meanTarget / mean));
  return gray.linear(factor, 0).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}

function stripSecondaryTextures(document) {
  for (const material of document.getRoot().listMaterials()) {
    material.setNormalTexture(null);
    material.setOcclusionTexture(null);
    material.setEmissiveTexture(null);
    material.setMetallicRoughnessTexture(null);
  }
}

function assertUniformWhiteColor(prim, semantic) {
  const accessor = prim.getAttribute(semantic);
  if (!accessor) return true;
  const element = [];
  const count = accessor.getCount();
  const step = Math.max(1, Math.floor(count / 200));
  for (let i = 0; i < count; i += step) {
    accessor.getElement(i, element);
    for (const value of element) {
      if (Math.abs(value - 1) > 0.01) return false;
    }
  }
  return true;
}

function dropInertAttributes(prim) {
  for (const semantic of ['COLOR_0', 'COLOR_1', 'TEXCOORD_1', 'TEXCOORD_2', 'TEXCOORD_3']) {
    if (!prim.getAttribute(semantic)) continue;
    if (semantic.startsWith('COLOR') && !assertUniformWhiteColor(prim, semantic)) {
      fail(`${semantic} is not uniformly white; refusing to strip a meaningful vertex color`);
    }
    prim.setAttribute(semantic, null);
  }
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
  const eyesGeometry = createToyGeometry();

  const headCenter = jointPosition('Head');
  const headRadiusY = (headCenter[1] - TOY_SHOE_BOTTOM_Y) / (2 * TOY_HEAD_RATIO - 1);
  const headRadii = [headRadiusY * 0.91, headRadiusY, headRadiusY * 0.89];
  const headTop = headCenter[1] + headRadii[1];
  const headBottom = headCenter[1] - headRadii[1];

  addToyEllipsoid(skinGeometry, headCenter, headRadii, joint('Head').index, 10, 14);
  addToyCapsule(
    skinGeometry,
    add3(jointPosition('neck_01'), [0, -0.035, 0]),
    add3(jointPosition('Head'), [0, -0.19, 0]),
    0.105,
    joint('neck_01').index,
  );

  const handCenters = {};
  for (const side of ['l', 'r']) {
    const handName = `hand_${side}`;
    const handCenter = add3(jointPosition(handName), [side === 'l' ? 0.018 : -0.018, 0, 0.018]);
    handCenters[side] = handCenter;
    addToyEllipsoid(skinGeometry, handCenter, [0.142, 0.105, 0.12], joint(handName).index, 7, 10);
  }

  addToyEllipsoid(
    topGeometry,
    [0, 1.115, -0.018],
    [0.335, 0.255, 0.23],
    joint('spine_01').index,
    7,
    12,
  );
  addToyEllipsoid(
    topGeometry,
    [0, 1.345, -0.012],
    [0.385, 0.275, 0.245],
    joint('spine_03').index,
    7,
    12,
  );
  for (const side of ['l', 'r']) {
    addToyCapsule(
      topGeometry,
      jointPosition(`upperarm_${side}`),
      jointPosition(`lowerarm_${side}`),
      0.135,
      joint(`upperarm_${side}`).index,
    );
    addToyCapsule(
      topGeometry,
      jointPosition(`lowerarm_${side}`),
      jointPosition(`hand_${side}`),
      0.118,
      joint(`lowerarm_${side}`).index,
    );
  }

  const pelvisPosition = jointPosition('pelvis');
  const pelvisCenter = add3(pelvisPosition, [0, -0.02, 0]);
  const pelvisRadii = [0.33, 0.21, 0.24];
  addToyEllipsoid(bottomGeometry, pelvisCenter, pelvisRadii, joint('pelvis').index, 7, 12);
  const shoeCenters = {};
  for (const side of ['l', 'r']) {
    addToyCapsule(
      bottomGeometry,
      jointPosition(`thigh_${side}`),
      jointPosition(`calf_${side}`),
      0.17,
      joint(`thigh_${side}`).index,
    );
    addToyCapsule(
      bottomGeometry,
      jointPosition(`calf_${side}`),
      add3(jointPosition(`foot_${side}`), [0, 0.065, 0.02]),
      0.145,
      joint(`calf_${side}`).index,
    );
    const foot = jointPosition(`foot_${side}`);
    const shoeCenter = [foot[0], TOY_SHOE_BOTTOM_Y + 0.1, 0.04];
    shoeCenters[side] = shoeCenter;
    addToyEllipsoid(
      shoesGeometry,
      shoeCenter,
      [0.155, 0.1, 0.25],
      joint(`foot_${side}`).index,
      7,
      12,
    );
  }

  const eyeOffsetX = headRadii[0] * 0.34;
  const eyeOffsetY = headRadii[1] * 0.19;
  const faceSurfaceZ =
    headCenter[2] +
    headRadii[2] *
      Math.sqrt(1 - (eyeOffsetX / headRadii[0]) ** 2 - (eyeOffsetY / headRadii[1]) ** 2);
  for (const direction of [-1, 1]) {
    addToyEllipsoid(
      eyesGeometry,
      [headCenter[0] + eyeOffsetX * direction, headCenter[1] + eyeOffsetY, faceSurfaceZ + 0.006],
      [0.042, 0.048, 0.028],
      joint('Head').index,
      6,
      9,
    );
  }

  const allGeometry = [skinGeometry, topGeometry, bottomGeometry, shoesGeometry, eyesGeometry];
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
    eyes: makeMaterial('EyeDots', TOY_EYE_COLOR),
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
  addToyMeshNode(
    document,
    scene,
    skin,
    'ToyEyeDots',
    createToyAccessors(document, buffer, 'ToyEyes', eyesGeometry),
    materials.eyes,
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
      bindPosition: [handCenters.l[0], handCenters.l[1] - 0.105, handCenters.l[2]],
    },
    ToyPalmR: {
      joint: 'hand_r',
      bindPosition: [handCenters.r[0], handCenters.r[1] - 0.105, handCenters.r[2]],
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
    headRatio: Number(measuredHeadRatio.toFixed(4)),
    allowedHeadRatio: TOY_HEAD_RATIO_RANGE,
    silhouette:
      'procedural capsule body, short chunky limbs, oversized shoes, point eyes, no mouth',
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

/** Bake a Head-rigged accessory (hair/brows) into head-local space as a static mesh. */
async function buildHeadAccessory(io, outName, sourceName, manifest) {
  const document = quietDoc(await io.read(join(HAIR_DIR, `${sourceName}.gltf`)));
  const root = document.getRoot();
  const meshNode = root.listNodes().find((node) => node.getMesh());
  if (!meshNode || !meshNode.getSkin()) fail(`${sourceName}: expected one skinned mesh node`);

  const skin = meshNode.getSkin();
  const joints = skin.listJoints();
  const headIndex = joints.findIndex((joint) => joint.getName() === 'Head');
  if (headIndex < 0) fail(`${sourceName}: no 'Head' joint in skin`);

  // Verify the 100%-Head weighting the bake relies on.
  const prim = meshNode.getMesh().listPrimitives()[0];
  const jointsAcc = prim.getAttribute('JOINTS_0');
  const weightsAcc = prim.getAttribute('WEIGHTS_0');
  const j = [];
  const w = [];
  for (let i = 0; i < jointsAcc.getCount(); i += 1) {
    jointsAcc.getElement(i, j);
    weightsAcc.getElement(i, w);
    for (let c = 0; c < 4; c += 1) {
      if (w[c] > 0.001 && joints[j[c]].getName() !== 'Head') {
        fail(`${sourceName}: vertex ${i} weighted to '${joints[j[c]].getName()}', not Head-only`);
      }
    }
  }

  const ibm = skin.getInverseBindMatrices().getElement(headIndex, []);
  const mesh = meshNode.getMesh();
  transformMesh(mesh, ibm);
  for (const meshPrim of mesh.listPrimitives()) {
    meshPrim.setAttribute('JOINTS_0', null);
    meshPrim.setAttribute('WEIGHTS_0', null);
    dropInertAttributes(meshPrim);
  }

  const isBrows = outName.startsWith('brows');
  const scene = root.listScenes()[0];
  const bakedNode = document.createNode(outName).setMesh(mesh);
  meshNode.setMesh(null);
  for (const child of scene.listChildren()) disposeSubtree(child);
  scene.addChild(bakedNode);

  stripSecondaryTextures(document);
  await document.transform(prune());
  const materials = root.listMaterials();
  if (materials.length !== 1) fail(`${sourceName}: expected 1 material after prune`);
  const material = materials[0].setName('Hair').setMetallicFactor(0).setRoughnessFactor(1);
  const baseTexture = material.getBaseColorTexture();
  if (!baseTexture) fail(`${sourceName}: missing basecolor texture`);
  const size = isBrows ? BROWS_TEXTURE_SIZE : HAIR_TEXTURE_SIZE;
  baseTexture
    .setImage(await grayscaleNormalizedPng(baseTexture.getImage(), size, HAIR_LUMINANCE_TARGET))
    .setMimeType('image/png')
    .setName(outName);

  await document.transform(dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(join(OUT_DIR, `${outName}.glb`), document);
  manifest[isBrows ? 'brows' : 'hair'][outName] = sourceName;
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
    for (const channel of animation.listChannels()) {
      if (
        channel.getTargetPath() !== 'translation' ||
        channel.getTargetNode()?.getName() !== 'root'
      ) {
        continue;
      }
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
    if (clipMax > ROOT_MOTION_MAX_DELTA) {
      fail(
        `animations: clip '${animation.getName()}' root translation drifts by ` +
          `${clipMax} (limit ${ROOT_MOTION_MAX_DELTA})`,
      );
    }
    clips[animation.getName()] = {
      keysChecked,
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

  manifest.rootMotionOracle = assertInPlaceRootMotion(root.listAnimations());
  await target.transform(resample(), prune(), dedup(), unpartition());
  await target.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));

  const clipNames = root
    .listAnimations()
    .map((animation) => animation.getName())
    .sort();
  const expected = [
    ...Object.values(UAL1_CLIP_RENAMES),
    ...Object.values(UAL2_CLIP_RENAMES),
  ].sort();
  if (JSON.stringify(clipNames) !== JSON.stringify(expected)) {
    fail(
      `animations: clip set mismatch\n  got:      ${clipNames.join(', ')}\n  expected: ${expected.join(', ')}`,
    );
  }

  await io.write(join(OUT_DIR, 'animations.glb'), target);
  manifest.clips = clipNames;
  manifest.clipSources = {
    ...Object.fromEntries(Object.entries(UAL1_CLIP_RENAMES).map(([k, v]) => [v, `UAL1:${k}`])),
    ...Object.fromEntries(Object.entries(UAL2_CLIP_RENAMES).map(([k, v]) => [v, `UAL2:${k}`])),
  };
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
  props.createBuffer();
  const scene = props.createScene('props');
  props.getRoot().setDefaultScene(scene);

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
  const bookDoc = quietDoc(await io.read(join(KAYKIT_DIR, 'gltf/book_single.gltf')));
  // The KayKit atlas costs ~1MB for one book — flatten to a retintable color.
  for (const material of bookDoc.getRoot().listMaterials()) {
    material.setBaseColorTexture(null).setBaseColorFactor(BOOK_BASE_COLOR);
  }
  absorb(bookDoc, 'prop_book');
  manifest.props.prop_book = 'kaykit-furniture-bits:book_single.gltf';

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
      used: 'Superhero male 65-joint rig topology, 6 hairstyles, and 2 eyebrow meshes.',
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
      used: 'laptop, computerScreen, cardboardBoxClosed, books props.',
    },
    {
      name: 'KayKit Furniture Bits — Kay Lousberg',
      url: 'https://kaylousberg.itch.io/furniture-bits',
      license: join(RAW_DIR, 'kaykit-furniture-github/LICENSE.txt'),
      used: 'book_single prop (atlas material replaced with a flat color).',
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
    'All assets in this directory are processed derivatives of CC0 1.0 packs,',
    'built by `scripts/build-character-assets.mjs`. Original license texts follow.',
    '',
  ].join('\n');
  writeFileSync(join(OUT_DIR, 'LICENSES.md'), `${header}\n${sections.join('\n\n')}\n`);
}

async function main() {
  // RAW_DIR existence is enforced by requireRawDir() at module load.
  await MeshoptEncoder.ready;
  mkdirSync(OUT_DIR, { recursive: true });
  const io = createIO();
  const manifest = { version: 2, bodies: {}, hair: {}, brows: {}, props: {} };

  console.log('building body_toy.glb');
  await buildToyBody(io, manifest);
  for (const [outName, sourceName] of Object.entries(HAIR_FILES)) {
    console.log(`building ${outName}.glb (${sourceName})`);
    await buildHeadAccessory(io, outName, sourceName, manifest);
  }
  console.log('building animations.glb');
  await buildAnimations(io, manifest);
  console.log('building props.glb');
  await buildProps(io, manifest);
  writeLicenses();

  const files = [
    'body_toy.glb',
    ...Object.keys(HAIR_FILES).map((name) => `${name}.glb`),
    'animations.glb',
    'props.glb',
    'LICENSES.md',
  ];
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
