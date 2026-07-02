#!/usr/bin/env node
/**
 * Character asset pipeline (production-work-dramaturgy I6).
 *
 * Reads the raw CC0 packs (Quaternius Universal Base Characters + Universal
 * Animation Library 1/2, Kenney Furniture Kit, KayKit Furniture Bits) from
 * RAW_DIR and emits the shipped runtime set into
 * `apps/desktop/renderer/src/assets/characters/`:
 *
 *   body_male.glb / body_female.glb   rigged bodies, split by dominant skinning
 *                                     joint into Skin(Light|Dark)/Top/Bottom/
 *                                     Shoes nodes so the office outfit is flat
 *                                     retintable color while the face keeps its
 *                                     texture (Light + Dark skin variants ship
 *                                     as sibling nodes; runtime shows one).
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
 * RAW_DIR is a dev-machine artifact (downloaded + unpacked pack contents); it is
 * NOT checked in. Override with CHARACTER_ASSETS_RAW_DIR. The emitted files ARE
 * source-controlled. The build is deterministic for a given raw set.
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

const RAW_DIR =
  process.env.CHARACTER_ASSETS_RAW_DIR ??
  '/private/tmp/claude-501/-Users-haoshengli-Seafile-WebWorkSpace-Offisim/6f9f221a-ba6c-4646-9a27-635b28e31f51/scratchpad/character-assets';
const OUT_DIR = join(process.cwd(), 'apps/desktop/renderer/src/assets/characters');
const SIZE_BUDGET_BYTES = 25 * 1024 * 1024;

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

const BODIES = {
  male: {
    gltf: 'Superhero_Male_FullBody.gltf',
    lightTexture: 'T_Superhero_Male_Ligh.png', // sic — source pack filename typo
    darkTexture: 'T_Superhero_Male_Dark.png',
  },
  female: {
    gltf: 'Superhero_Female_FullBody.gltf',
    lightTexture: 'T_Superhero_Female_Light_BaseColor.png',
    darkTexture: 'T_Superhero_Female_Dark_BaseColor.png',
  },
};

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

/** Body texture target size (source 2048). */
const BODY_TEXTURE_SIZE = 1024;
const HAIR_TEXTURE_SIZE = 512;
const BROWS_TEXTURE_SIZE = 256;
/** Grayscale-normalized hair mean luminance target (0-255): multiply-tint base. */
const HAIR_LUMINANCE_TARGET = 184;
/** Forehead sample window (fraction of texture) for the skin reference color. */
const SKIN_SAMPLE_REGION = { left: 0.12, top: 0.04, width: 0.12, height: 0.07 };

/** Outfit split groups by dominant skinning joint (65-bone UE-style rig). */
const JOINT_GROUP_RULES = [
  {
    group: 'skin',
    pattern: /^(Head|neck_01|hand_[lr]|(thumb|index|middle|ring|pinky)_\d+(_leaf)?_[lr])$/,
  },
  { group: 'top', pattern: /^(spine_\d+|clavicle_[lr]|(upperarm|lowerarm)(_twist_\d+)?_[lr])$/ },
  { group: 'bottom', pattern: /^(root|pelvis|(thigh|calf)(_twist_\d+)?_[lr])$/ },
  { group: 'shoes', pattern: /^(foot_[lr]|ball_[lr])$/ },
];
const GROUP_PRIORITY = ['skin', 'top', 'bottom', 'shoes'];
const SHOE_BASE_COLOR = [0.16, 0.17, 0.2, 1];
const BOOK_BASE_COLOR = [0.61, 0.3, 0.29, 1];

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

function classifyJoint(jointName, parentByName) {
  let name = jointName;
  const seen = new Set();
  while (name && !seen.has(name)) {
    seen.add(name);
    for (const rule of JOINT_GROUP_RULES) {
      if (rule.pattern.test(name)) return rule.group;
    }
    name = parentByName.get(name);
  }
  return 'top';
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

async function resizePng(input, size) {
  return sharp(input)
    .resize(size, size, { fit: 'fill' })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function grayscaleNormalizedPng(input, size, meanTarget) {
  const gray = sharp(input).resize(size, size, { fit: 'fill' }).greyscale();
  const stats = await gray.clone().stats();
  const mean = stats.channels[0].mean || 1;
  const factor = Math.max(0.5, Math.min(3, meanTarget / mean));
  return gray.linear(factor, 0).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}

async function skinReferenceColor(pngBuffer, size) {
  const region = {
    left: Math.round(SKIN_SAMPLE_REGION.left * size),
    top: Math.round(SKIN_SAMPLE_REGION.top * size),
    width: Math.round(SKIN_SAMPLE_REGION.width * size),
    height: Math.round(SKIN_SAMPLE_REGION.height * size),
  };
  const stats = await sharp(pngBuffer).extract(region).stats();
  return toHex(stats.channels.slice(0, 3).map((channel) => channel.mean));
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

/** Split the body primitive into skin/top/bottom/shoes index sets by dominant joint. */
function splitBodyPrimitive(document, bodyNode) {
  const prim = bodyNode.getMesh().listPrimitives()[0];
  const skin = bodyNode.getSkin();
  const joints = skin.listJoints();
  const parentByName = new Map();
  for (const joint of joints) {
    for (const child of joint.listChildren()) parentByName.set(child.getName(), joint.getName());
  }
  const groupOfJoint = joints.map((joint) => classifyJoint(joint.getName(), parentByName));

  const jointsAcc = prim.getAttribute('JOINTS_0');
  const weightsAcc = prim.getAttribute('WEIGHTS_0');
  const indices = prim.getIndices();
  if (!jointsAcc || !weightsAcc || !indices)
    fail('body primitive missing JOINTS_0/WEIGHTS_0/indices');

  const vertexGroup = new Array(jointsAcc.getCount());
  const j = [];
  const w = [];
  for (let i = 0; i < jointsAcc.getCount(); i += 1) {
    jointsAcc.getElement(i, j);
    weightsAcc.getElement(i, w);
    let best = 0;
    for (let c = 1; c < 4; c += 1) if (w[c] > w[best]) best = c;
    vertexGroup[i] = groupOfJoint[j[best]] ?? 'top';
  }

  const groupIndices = { skin: [], top: [], bottom: [], shoes: [] };
  const triangleCount = Math.floor(indices.getCount() / 3);
  for (let t = 0; t < triangleCount; t += 1) {
    const a = indices.getScalar(t * 3);
    const b = indices.getScalar(t * 3 + 1);
    const c = indices.getScalar(t * 3 + 2);
    const votes = [vertexGroup[a], vertexGroup[b], vertexGroup[c]];
    let winner = votes[0];
    if (votes[1] === votes[2]) winner = votes[1];
    if (votes[0] !== votes[1] && votes[1] !== votes[2] && votes[0] !== votes[2]) {
      winner = GROUP_PRIORITY.find((group) => votes.includes(group));
    }
    groupIndices[winner].push(a, b, c);
  }
  for (const group of GROUP_PRIORITY) {
    if (groupIndices[group].length === 0) fail(`body split produced an empty '${group}' group`);
  }

  const buffer = document.getRoot().listBuffers()[0];
  const makeIndexAccessor = (array) =>
    document
      .createAccessor()
      .setType('SCALAR')
      .setArray(array.length > 65535 ? new Uint32Array(array) : new Uint16Array(array))
      .setBuffer(buffer);

  const makePrim = (indexArray, material) => {
    const next = document.createPrimitive().setMode(prim.getMode()).setMaterial(material);
    for (const semantic of prim.listSemantics()) {
      next.setAttribute(semantic, prim.getAttribute(semantic));
    }
    next.setIndices(makeIndexAccessor(indexArray));
    return next;
  };
  return { prim, makePrim, groupIndices };
}

async function buildBody(io, gender, spec, manifest) {
  const document = quietDoc(await io.read(join(BODY_DIR, spec.gltf)));
  const root = document.getRoot();

  for (const animation of root.listAnimations()) animation.dispose();

  const meshNodes = root.listNodes().filter((node) => node.getMesh());
  const eyebrowsNode = meshNodes.find((node) => node.getName().startsWith('Eyebrows'));
  const eyesNode = meshNodes.find((node) => node.getName() === 'Eyes');
  const bodyNode = meshNodes.find((node) => node !== eyebrowsNode && node !== eyesNode);
  if (!eyebrowsNode || !eyesNode || !bodyNode)
    fail(`${spec.gltf}: expected Eyebrows/Eyes/body mesh nodes`);
  // Standalone brows glbs replace the built-in eyebrows (composable at runtime).
  eyebrowsNode.dispose();

  const parent = bodyNode.getParentNode() ?? root.listScenes()[0];
  const skin = bodyNode.getSkin();
  const { prim, makePrim, groupIndices } = splitBodyPrimitive(document, bodyNode);

  // Height (bind pose) for runtime scale normalization.
  const position = prim.getAttribute('POSITION');
  const min = position.getMinNormalized([]);
  const max = position.getMaxNormalized([]);
  const heightUnits = max[1] - min[1];

  // Textures: Light + Dark 1024 skin variants; flat outfit materials.
  const lightPng = await resizePng(
    readFileSync(join(BODY_DIR, spec.lightTexture)),
    BODY_TEXTURE_SIZE,
  );
  const darkPng = await resizePng(
    readFileSync(join(BODY_DIR, spec.darkTexture)),
    BODY_TEXTURE_SIZE,
  );
  const lightTexture = document
    .createTexture(`skin_light_${gender}`)
    .setImage(lightPng)
    .setMimeType('image/png');
  const darkTexture = document
    .createTexture(`skin_dark_${gender}`)
    .setImage(darkPng)
    .setMimeType('image/png');

  const makeMaterial = (name) =>
    document.createMaterial(name).setMetallicFactor(0).setRoughnessFactor(1);
  const skinLightMaterial = makeMaterial('SkinLight').setBaseColorTexture(lightTexture);
  const skinDarkMaterial = makeMaterial('SkinDark').setBaseColorTexture(darkTexture);
  const topMaterial = makeMaterial('OutfitTop').setBaseColorFactor([1, 1, 1, 1]);
  const bottomMaterial = makeMaterial('OutfitBottom').setBaseColorFactor([1, 1, 1, 1]);
  const shoesMaterial = makeMaterial('Shoes').setBaseColorFactor(SHOE_BASE_COLOR);

  const parts = [
    ['Body_Skin_Light', groupIndices.skin, skinLightMaterial],
    ['Body_Skin_Dark', groupIndices.skin, skinDarkMaterial],
    ['Body_Top', groupIndices.top, topMaterial],
    ['Body_Bottom', groupIndices.bottom, bottomMaterial],
    ['Body_Shoes', groupIndices.shoes, shoesMaterial],
  ];
  for (const [name, indexArray, material] of parts) {
    const partPrim = makePrim(indexArray, material);
    dropInertAttributes(partPrim);
    const mesh = document.createMesh(name).addPrimitive(partPrim);
    parent.addChild(document.createNode(name).setMesh(mesh).setSkin(skin));
  }
  const oldMesh = bodyNode.getMesh();
  bodyNode.dispose();
  oldMesh.dispose();

  for (const eyesPrim of eyesNode.getMesh().listPrimitives()) dropInertAttributes(eyesPrim);
  stripSecondaryTextures(document);
  // Scope dedup away from materials: OutfitTop/OutfitBottom are identical white
  // bases and must stay distinct so runtime tinting stays self-documenting.
  await document.transform(
    prune(),
    dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.TEXTURE] }),
  );
  await document.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));

  const outFile = `body_${gender}.glb`;
  await io.write(join(OUT_DIR, outFile), document);
  manifest.bodies[gender] = {
    file: outFile,
    heightUnits: Number(heightUnits.toFixed(4)),
    skinReference: {
      light: await skinReferenceColor(lightPng, BODY_TEXTURE_SIZE),
      dark: await skinReferenceColor(darkPng, BODY_TEXTURE_SIZE),
    },
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

async function buildAnimations(io, manifest) {
  const target = quietDoc(await io.read(UAL1_GLB));
  stripToSkeleton(target, UAL1_CLIP_RENAMES);
  const targetNodesByName = new Map(
    target
      .getRoot()
      .listNodes()
      .map((node) => [node.getName(), node]),
  );

  const source = quietDoc(await io.read(UAL2_GLB));
  stripToSkeleton(source, UAL2_CLIP_RENAMES);
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
  const bodyDoc = quietDoc(await io.read(join(BODY_DIR, BODIES.male.gltf)));
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
      used: 'Superhero male/female bodies, 6 hairstyles, 2 eyebrow meshes, skin/hair/eye textures.',
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
    const text = readFileSync(pack.license, 'utf8').trim();
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
  if (!existsSync(RAW_DIR)) {
    fail(
      `RAW_DIR not found: ${RAW_DIR}\nThe raw packs are a dev-machine artifact (not checked in). Set CHARACTER_ASSETS_RAW_DIR.`,
    );
  }
  await MeshoptEncoder.ready;
  mkdirSync(OUT_DIR, { recursive: true });
  const io = createIO();
  const manifest = { version: 1, bodies: {}, hair: {}, brows: {}, props: {} };

  for (const [gender, spec] of Object.entries(BODIES)) {
    console.log(`building body_${gender}.glb`);
    await buildBody(io, gender, spec, manifest);
  }
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
    'body_male.glb',
    'body_female.glb',
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
