#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AnimationMixer, Box3, Vector3 } from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

globalThis.ProgressEvent ??= class ProgressEvent {};
globalThis.self ??= globalThis;

const ROOT = new URL('../../../../', import.meta.url);
const ASSET_DIR = new URL('apps/desktop/renderer/src/assets/characters/', ROOT);
const METRICS_URL = new URL(
  'apps/desktop/renderer/src/surfaces/office/scene/toy-performance-metrics.json',
  ROOT,
);
const CHARACTER_CONTRACT_URL = new URL(
  'apps/desktop/renderer/src/lib/toy-character-contract.json',
  ROOT,
);
const EVIDENCE_URL = new URL('Docs/evidence/2026-07-office-toy/p0/oracle-results.json', ROOT);
const PROPORTION_EVIDENCE_URL = new URL(
  'Docs/evidence/2026-07-office-toy/p7-proportions/oracle-results.json',
  ROOT,
);
const LANDMARKS = [
  'ToyHeadTop',
  'ToyChin',
  'ToyButtContact',
  'ToyPalmL',
  'ToyPalmR',
  'ToySoleL',
  'ToySoleR',
];
const SAMPLE_TIMES = [0, 0.25, 0.5, 0.75, 1];
const LOCOMOTION_CLIPS = ['walk', 'walk.formal', 'carry'];
const P0_CLIPS = [
  'blocked.headshake',
  'carry',
  'celebrate.dance',
  'celebrate.yes',
  'consume',
  'idle',
  'idle.talk',
  'inspect.open',
  'interact',
  'phone',
  'pickup',
  'sit.enter',
  'sit.exit',
  'sit.idle',
  'sit.talk',
  'tpose',
  'wait.foldarms',
  'walk',
  'walk.formal',
];
const MAX_CLIP_COUNT = 24;
const GROUND_TOLERANCE = 0.04;

const round = (value) => Number(value.toFixed(6));
const roundVector = (vector) => vector.toArray().map(round);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

async function loadGltf(name) {
  const bytes = await readFile(new URL(name, ASSET_DIR));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer, '');
  return { bytes, gltf };
}

function requireObject(root, name) {
  const object = root.getObjectByName(name);
  if (!object) throw new Error(`missing required glTF node '${name}'`);
  return object;
}

function check(id, pass, observed, expected) {
  return { id, pass, observed, expected };
}

function inspectMeshWinding(root) {
  const result = {};
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const na = new Vector3();
  const nb = new Vector3();
  const nc = new Vector3();
  const edgeA = new Vector3();
  const edgeB = new Vector3();
  const faceNormal = new Vector3();
  const vertexNormal = new Vector3();
  root.traverse((object) => {
    if (!object.isMesh) return;
    const position = object.geometry.getAttribute('position');
    const normal = object.geometry.getAttribute('normal');
    const index = object.geometry.getIndex();
    if (!position || !normal || !index) return;
    const counts = { aligned: 0, reversed: 0, degenerate: 0 };
    for (let offset = 0; offset < index.count; offset += 3) {
      const ia = index.getX(offset);
      const ib = index.getX(offset + 1);
      const ic = index.getX(offset + 2);
      a.fromBufferAttribute(position, ia);
      b.fromBufferAttribute(position, ib);
      c.fromBufferAttribute(position, ic);
      na.fromBufferAttribute(normal, ia);
      nb.fromBufferAttribute(normal, ib);
      nc.fromBufferAttribute(normal, ic);
      edgeA.subVectors(b, a);
      edgeB.subVectors(c, a);
      faceNormal.crossVectors(edgeA, edgeB);
      vertexNormal.copy(na).add(nb).add(nc);
      const dot = faceNormal.dot(vertexNormal);
      if (Math.abs(dot) <= 1e-8) counts.degenerate += 1;
      else if (dot > 0) counts.aligned += 1;
      else counts.reversed += 1;
    }
    result[object.name] = counts;
  });
  return result;
}

function setActorTransform(scene, metrics, seated) {
  const workstation = metrics.workstation;
  const actorZ = workstation.deskDepth.standard / 2 + workstation.seatForward;
  scene.scale.setScalar(metrics.character.height / manifest.bodies.toy.heightUnits);
  scene.rotation.set(0, seated ? Math.PI : 0, 0);
  scene.position.set(
    0,
    seated ? workstation.seatedBodyLift : 0,
    seated ? actorZ - workstation.seatedBodyForward : 0,
  );
}

function setVariantTransform(scene, metrics, bodyType, headShape) {
  const sceneScale = metrics.character.height / manifest.bodies.toy.heightUnits;
  const girth = characterContract.bodyTypeGirth[bodyType];
  const headScale = characterContract.headShapeScale[headShape];
  scene.position.set(0, 0, 0);
  scene.rotation.set(0, 0, 0);
  scene.scale.set(sceneScale * girth, sceneScale, sceneScale * girth);
  requireObject(scene, 'Head').scale.fromArray(headScale);
}

function setVariantWorkstationTransform(scene, metrics, bodyType, headShape, seated) {
  const workstation = metrics.workstation;
  const actorZ = workstation.deskDepth.standard / 2 + workstation.seatForward;
  setVariantTransform(scene, metrics, bodyType, headShape);
  scene.rotation.set(0, seated ? Math.PI : 0, 0);
  scene.position.set(
    0,
    seated ? workstation.seatedBodyLift : 0,
    seated ? actorZ - workstation.seatedBodyForward : 0,
  );
}

function sampleLandmarks(scene) {
  scene.updateMatrixWorld(true);
  return Object.fromEntries(
    LANDMARKS.map((name) => [
      name,
      roundVector(requireObject(scene, name).getWorldPosition(new Vector3())),
    ]),
  );
}

function playAt(mixer, clipsByName, scene, clipName, normalizedTime) {
  mixer.stopAllAction();
  mixer.setTime(0);
  const clip = clipsByName.get(clipName);
  if (!clip) throw new Error(`missing canonical clip '${clipName}'`);
  mixer.clipAction(clip).reset().play();
  mixer.setTime(clip.duration * Math.min(normalizedTime, 0.999999));
  return sampleLandmarks(scene);
}

function samplePropAttaches(scene, propsScene, propAttach, metrics) {
  const headPoint = requireObject(scene, 'Head').getWorldPosition(new Vector3());
  return Object.entries(propAttach).map(([kind, spec]) => {
    const prop = requireObject(propsScene, spec.node).clone(true);
    prop.position.fromArray(spec.position);
    prop.rotation.fromArray(spec.rotation);
    requireObject(scene, spec.bone).add(prop);
    scene.updateMatrixWorld(true);
    const box = new Box3().setFromObject(prop);
    const targetName =
      spec.bone === 'Head' ? 'Head' : spec.bone === 'hand_l' ? 'ToyPalmL' : 'ToyPalmR';
    const targetPoint = requireObject(scene, targetName).getWorldPosition(new Vector3());
    const reach = box.distanceToPoint(targetPoint);
    const headDistance = box.distanceToPoint(headPoint);
    const unexpectedFaceRisk = spec.bone !== 'Head' && box.containsPoint(headPoint);
    const sample = {
      kind,
      node: spec.node,
      attachBone: spec.bone,
      target: targetName,
      aabb: { min: roundVector(box.min), max: roundVector(box.max) },
      reach: round(reach),
      headDistance: round(headDistance),
      unexpectedFaceRisk,
      pass:
        !box.isEmpty() && reach <= metrics.silhouette.gates.propReachMax && !unexpectedFaceRisk,
    };
    if (kind === 'laptop') {
      sample.visibleAtDesk = box.max.y >= metrics.workstation.deskTop;
      sample.clearOfDesk = box.min.y >= metrics.workstation.deskTop - 0.01;
      sample.pass = sample.pass && sample.visibleAtDesk && sample.clearOfDesk;
    }
    prop.removeFromParent();
    return sample;
  });
}

function inspectFinalRootMotion(clips) {
  let maxObservedAbsDelta = 0;
  const checked = {};
  for (const clip of clips) {
    const track = clip.tracks.find((candidate) => candidate.name === 'root.position');
    if (!track || track.getValueSize() !== 3 || track.times.length === 0) {
      checked[clip.name] = { pass: false, reason: 'missing root.position VEC3 track' };
      continue;
    }
    const first = track.values.slice(0, 3);
    let clipMax = 0;
    for (let index = 0; index < track.values.length; index += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        clipMax = Math.max(clipMax, Math.abs(track.values[index + axis] - first[axis]));
      }
    }
    maxObservedAbsDelta = Math.max(maxObservedAbsDelta, clipMax);
    checked[clip.name] = {
      pass: clipMax <= 0.00001,
      keysChecked: track.times.length,
      maxAbsDelta: round(clipMax),
    };
  }
  return {
    checked,
    clipsChecked: Object.keys(checked).length,
    maxObservedAbsDelta: round(maxObservedAbsDelta),
  };
}

const [manifest, metrics, characterContract, bodyAsset, animationAsset, propsAsset] =
  await Promise.all([
    readJson(new URL('manifest.json', ASSET_DIR)),
    readJson(METRICS_URL),
    readJson(CHARACTER_CONTRACT_URL),
    loadGltf('body_toy.glb'),
    loadGltf('animations.glb'),
    loadGltf('props.glb'),
  ]);

const body = bodyAsset.gltf.scene;
const clips = animationAsset.gltf.animations;
const clipsByName = new Map(clips.map((clip) => [clip.name, clip]));
const mixer = new AnimationMixer(body);
const checks = [];

checks.push(
  check(
    'clip-count',
    clips.length === manifest.clips.length &&
      clips.length <= MAX_CLIP_COUNT &&
      P0_CLIPS.every((clip) => clipsByName.has(clip)),
    { glb: clips.length, manifest: manifest.clips.length },
    { retainedP0Clips: P0_CLIPS.length, max: MAX_CLIP_COUNT },
  ),
);
for (const landmark of LANDMARKS) {
  const present = Boolean(body.getObjectByName(landmark));
  checks.push(check(`landmark:${landmark}`, present, present ? 'present' : 'missing', 'present'));
}

const winding = inspectMeshWinding(body);
checks.push(
  check(
    'mesh-frontside-winding',
    Object.keys(winding).length > 0 &&
      Object.values(winding).every((item) => item.aligned > 0 && item.reversed === 0),
    winding,
    'every mesh has outward-facing nondegenerate triangles and zero reversed triangles',
  ),
);
const skinMeshes = ['Body_Skin_Light', 'Body_Skin_Dark'].map((name) => requireObject(body, name));
const texturelessSkin = skinMeshes.every((mesh) => !mesh.material.map);
checks.push(
  check(
    'textureless-skin-direct-tint',
    texturelessSkin && manifest.bodies.toy.skinTintMode === 'direct',
    { texturelessSkin, skinTintMode: manifest.bodies.toy.skinTintMode },
    { texturelessSkin: true, skinTintMode: 'direct' },
  ),
);

setActorTransform(body, metrics, false);
const tpose = playAt(mixer, clipsByName, body, 'tpose', 0);
const headHeight = tpose.ToyHeadTop[1] - tpose.ToyChin[1];
const bodyHeight = tpose.ToyHeadTop[1] - Math.min(tpose.ToySoleL[1], tpose.ToySoleR[1]);
const headCount = bodyHeight / headHeight;
checks.push(
  check(
    'head-count',
    headCount >= metrics.character.minimumHeadCount &&
      headCount <= metrics.character.maximumHeadCount &&
      Math.abs(headCount - metrics.character.targetHeadCount) <= 0.05,
    { headCount: round(headCount), bodyHeight: round(bodyHeight), headHeight: round(headHeight) },
    {
      range: [metrics.character.minimumHeadCount, metrics.character.maximumHeadCount],
      target: metrics.character.targetHeadCount,
      targetTolerance: 0.05,
    },
  ),
);
checks.push(
  check(
    'measurement-contract-drift',
    JSON.stringify(manifest.bodies.toy.measurements?.geometryUnits) ===
      JSON.stringify(metrics.silhouette.geometryUnits) &&
      JSON.stringify(manifest.bodies.toy.measurements?.garmentProportions) ===
        JSON.stringify(metrics.silhouette.garmentProportions) &&
      manifest.bodies.toy.measurements?.variantMatrix?.length === 9,
    manifest.bodies.toy.measurements,
    'manifest measurements match toy-performance-metrics and contain 9 shipped variants',
  ),
);

const variantMeasurements = [];
for (const bodyType of Object.keys(characterContract.bodyTypeGirth)) {
  for (const headShape of Object.keys(characterContract.headShapeScale)) {
    const id = `${bodyType}:${headShape}`;
    const declared = manifest.bodies.toy.measurements.variantMatrix.find(
      (variant) => variant.id === id,
    );
    setVariantTransform(body, metrics, bodyType, headShape);
    const landmarks = playAt(mixer, clipsByName, body, 'tpose', 0);
    const totalHeightScene =
      landmarks.ToyHeadTop[1] - Math.min(landmarks.ToySoleL[1], landmarks.ToySoleR[1]);
    const effectiveHeadHeightScene = landmarks.ToyHeadTop[1] - landmarks.ToyChin[1];
    const measured = {
      id,
      totalHeightScene: round(totalHeightScene),
      effectiveHeadHeightScene: round(effectiveHeadHeightScene),
      headCount: round(totalHeightScene / effectiveHeadHeightScene),
    };
    setVariantWorkstationTransform(body, metrics, bodyType, headShape, true);
    const variantSitIdle = playAt(mixer, clipsByName, body, 'sit.idle', 0.5);
    const variantSitTalk = playAt(mixer, clipsByName, body, 'sit.talk', 0.5);
    const contact = {
      soleDelta: round(
        Math.max(Math.abs(landmarks.ToySoleL[1]), Math.abs(landmarks.ToySoleR[1])),
      ),
      seatButtDelta: round(
        Math.abs(variantSitIdle.ToyButtContact[1] - metrics.workstation.seatTop),
      ),
      deskPalmDelta: round(
        Math.max(
          Math.abs(variantSitTalk.ToyPalmL[1] - metrics.workstation.deskTop),
          Math.abs(variantSitTalk.ToyPalmR[1] - metrics.workstation.deskTop),
        ),
      ),
    };
    const propAttach = samplePropAttaches(
      body,
      propsAsset.gltf.scene,
      characterContract.propAttach,
      metrics,
    );
    const gates = metrics.silhouette.gates;
    const canonicalChestBand = gates.canonicalChestToHead;
    const pass =
      declared?.pass === true &&
      Math.abs(effectiveHeadHeightScene - declared.effectiveHeadHeightScene) <= 0.0002 &&
      totalHeightScene >= gates.allHeight[0] &&
      totalHeightScene <= gates.allHeight[1] + gates.roundHeightTolerance &&
      totalHeightScene / effectiveHeadHeightScene >= metrics.character.minimumHeadCount &&
      totalHeightScene / effectiveHeadHeightScene <= metrics.character.maximumHeadCount &&
      declared.ratios.thighToChest <= gates.thighToChestMax &&
      declared.ratios.shoeLengthToHeight <= gates.shoeLengthToHeightMax &&
      declared.ratios.shoeWidthToHead <= gates.shoeWidthToHeadMax &&
      declared.ratios.handToHead >= gates.handToHead[0] &&
      declared.ratios.handToHead <= gates.handToHead[1] &&
      declared.ratios.handToSleeve >= gates.handToSleeveMin &&
      contact.soleDelta <= GROUND_TOLERANCE &&
      contact.seatButtDelta <= gates.seatDeltaMax &&
      contact.deskPalmDelta <= gates.deskPalmDeltaMax &&
      propAttach.length === Object.keys(characterContract.propAttach).length &&
      propAttach.every((sample) => sample.pass) &&
      (id !== 'normal:round' ||
        (declared.ratios.chestToHead >= canonicalChestBand[0] &&
          declared.ratios.chestToHead <= canonicalChestBand[1]));
    variantMeasurements.push({ ...measured, contact, propAttach, declared, pass });
  }
}
checks.push(
  check(
    'shipped-variant-proportion-matrix',
    variantMeasurements.length === 9 && variantMeasurements.every((variant) => variant.pass),
    variantMeasurements.map((variant) => ({
      id: variant.id,
      totalHeightScene: variant.totalHeightScene,
      effectiveHeadHeightScene: variant.effectiveHeadHeightScene,
      headCount: variant.headCount,
      contact: variant.contact,
      propAttachPassed: variant.propAttach.filter((sample) => sample.pass).length,
      propAttachTotal: variant.propAttach.length,
      pass: variant.pass,
    })),
    'all 9 bodyType × headShape bind envelopes pass, with runtime tpose head geometry independently sampled',
  ),
);
setVariantTransform(body, metrics, 'normal', 'round');
const tposeSoleDistance = Math.max(Math.abs(tpose.ToySoleL[1]), Math.abs(tpose.ToySoleR[1]));
checks.push(
  check(
    'tpose-sole-ground',
    tposeSoleDistance <= GROUND_TOLERANCE,
    round(tposeSoleDistance),
    GROUND_TOLERANCE,
  ),
);

const finalRootMotion = inspectFinalRootMotion(clips);
const finalRootPass =
  finalRootMotion.clipsChecked === clips.length &&
  Object.values(finalRootMotion.checked).every((item) => item.pass) &&
  finalRootMotion.maxObservedAbsDelta <= 0.00001;
checks.push(
  check('final-animation-root-motion', finalRootPass, finalRootMotion, {
    clipsChecked: clips.length,
    maxAbsDelta: 0.00001,
  }),
);
checks.push(
  check(
    'root-motion-all-keys',
    manifest.rootMotionOracle?.result === 'pass' &&
      manifest.rootMotionOracle?.clipsChecked === clips.length &&
      manifest.rootMotionOracle?.maxObservedAbsDelta <=
        manifest.rootMotionOracle?.maxAbsDeltaThreshold,
    manifest.rootMotionOracle,
    { clipsChecked: clips.length, maxAbsDelta: 0.00001 },
  ),
);

const samples = [];
for (const clipName of manifest.clips) {
  const seated = clipName.startsWith('sit.') && clipName !== 'sit.exit';
  setActorTransform(body, metrics, seated);
  for (const normalizedTime of SAMPLE_TIMES) {
    samples.push({
      clip: clipName,
      normalizedTime,
      coordinateSpace: seated ? 'workstationLocal' : 'actorLocal',
      landmarks: playAt(mixer, clipsByName, body, clipName, normalizedTime),
    });
  }
}

setActorTransform(body, metrics, true);
const sitIdle = playAt(mixer, clipsByName, body, 'sit.idle', 0.5);
const buttDelta = Math.abs(sitIdle.ToyButtContact[1] - metrics.workstation.seatTop);
const chairCenterZ = metrics.workstation.deskDepth.standard / 2 + metrics.workstation.chairForward;
const chairFlatHalfWidth =
  metrics.workstation.chairCushionWidth / 2 - metrics.workstation.chairCushionRadius;
const chairFlatHalfDepth =
  metrics.workstation.chairCushionDepth / 2 - metrics.workstation.chairCushionRadius;
const buttInChairFootprint =
  Math.abs(sitIdle.ToyButtContact[0]) <= chairFlatHalfWidth &&
  Math.abs(sitIdle.ToyButtContact[2] - chairCenterZ) <= chairFlatHalfDepth;
checks.push(
  check(
    'sit-butt-to-seat',
    buttDelta <= 0.05 && buttInChairFootprint,
    {
      workstationLocal: sitIdle.ToyButtContact,
      yDelta: round(buttDelta),
      inFlatTopFootprint: buttInChairFootprint,
    },
    {
      seatTop: metrics.workstation.seatTop,
      yTolerance: 0.05,
      x: [-round(chairFlatHalfWidth), round(chairFlatHalfWidth)],
      z: [round(chairCenterZ - chairFlatHalfDepth), round(chairCenterZ + chairFlatHalfDepth)],
    },
  ),
);

const sitTalk = playAt(mixer, clipsByName, body, 'sit.talk', 0.5);
const deskHalfWidth = metrics.workstation.standardDeskWidth / 2 - metrics.workstation.deskEdgeInset;
const deskHalfDepth =
  metrics.workstation.deskDepth.standard / 2 - metrics.workstation.deskEdgeInset;
const contactSamples = [];
for (const palmName of ['ToyPalmL', 'ToyPalmR']) {
  const [x, y, z] = sitTalk[palmName];
  const inVerticalBand =
    Math.abs(y - metrics.workstation.deskTop) <= metrics.workstation.contactTolerance;
  const inFootprint = Math.abs(x) <= deskHalfWidth && Math.abs(z) <= deskHalfDepth;
  checks.push(
    check(
      `desk-contact:${palmName}`,
      inVerticalBand && inFootprint,
      { x, y, z, inVerticalBand, inFootprint },
      {
        y: [
          round(metrics.workstation.deskTop - metrics.workstation.contactTolerance),
          round(metrics.workstation.deskTop + metrics.workstation.contactTolerance),
        ],
        x: [-round(deskHalfWidth), round(deskHalfWidth)],
        z: [-round(deskHalfDepth), round(deskHalfDepth)],
      },
    ),
  );
  contactSamples.push({
    clip: 'sit.talk',
    normalizedTime: 0.5,
    landmark: palmName,
    workstationLocal: [x, y, z],
    pass: inVerticalBand && inFootprint,
  });
}
contactSamples.push({
  clip: 'sit.idle',
  normalizedTime: 0.5,
  landmark: 'ToyButtContact',
  workstationLocal: sitIdle.ToyButtContact,
  pass: buttDelta <= 0.05 && buttInChairFootprint,
});

const propAttachSamples = variantMeasurements.find(
  (variant) => variant.id === 'normal:round',
).propAttach;
for (const sample of propAttachSamples) {
  checks.push(
    check(
      `prop-attach:${sample.kind}`,
      sample.pass,
      sample,
      { reachMax: metrics.silhouette.gates.propReachMax, unexpectedFaceRisk: false },
    ),
  );
  if (sample.kind === 'laptop') {
    checks.push(
      check(
        'held-laptop-aabb',
        sample.visibleAtDesk && sample.clearOfDesk,
        sample,
        { deskPenetrationMax: 0.01 },
      ),
    );
  }
}

for (const clipName of LOCOMOTION_CLIPS) {
  const clip = clipsByName.get(clipName);
  let maxGroundDistance = 0;
  for (let frame = 0; frame <= Math.ceil(clip.duration * 60); frame += 1) {
    setActorTransform(body, metrics, false);
    const landmarks = playAt(
      mixer,
      clipsByName,
      body,
      clipName,
      Math.min(frame / (clip.duration * 60), 0.999999),
    );
    const nearestSole = Math.min(Math.abs(landmarks.ToySoleL[1]), Math.abs(landmarks.ToySoleR[1]));
    maxGroundDistance = Math.max(maxGroundDistance, nearestSole);
  }
  checks.push(
    check(
      `ground-contact:${clipName}`,
      maxGroundDistance <= GROUND_TOLERANCE,
      round(maxGroundDistance),
      GROUND_TOLERANCE,
    ),
  );
}

const report = {
  version: 1,
  result: checks.every((item) => item.pass) ? 'pass' : 'fail',
  assets: {
    bodyToy: { bytes: bodyAsset.bytes.length, sha256: sha256(bodyAsset.bytes) },
    animations: { bytes: animationAsset.bytes.length, sha256: sha256(animationAsset.bytes) },
  },
  metrics,
  checks,
  winding,
  finalRootMotion,
  contactSamples,
  propAttachSamples,
  variantMeasurements,
  samples,
};

if (process.env.CHARACTER_TOY_ORACLE_NO_WRITE !== '1') {
  await mkdir(new URL('.', EVIDENCE_URL), { recursive: true });
  const serializedReport = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(EVIDENCE_URL, serializedReport);
  await mkdir(new URL('.', PROPORTION_EVIDENCE_URL), { recursive: true });
  await writeFile(PROPORTION_EVIDENCE_URL, serializedReport);
}
console.log(
  `[toy-p0] ${checks.filter((item) => item.pass).length}/${checks.length} checks passed; ` +
    `evidence=${fileURLToPath(EVIDENCE_URL)}`,
);
for (const item of checks.filter((value) => !value.pass)) {
  console.error(`[toy-p0] FAIL ${item.id}: ${JSON.stringify(item.observed)}`);
}
if (report.result !== 'pass') process.exit(1);
