#!/usr/bin/env node
/**
 * Deterministic derivation of the direct-V2 semantic action clips
 * (`look.around`, `sit.fidget`, `stretch`) into the COMMITTED
 * `apps/desktop/renderer/src/assets/characters/animations.glb`.
 *
 * This script reads only the committed animation library — no
 * CHARACTER_ASSETS_RAW_DIR, no raw packs, no network. It removes any existing
 * clips under the three derived names, re-authors them from the retained base
 * clips (same procedural approach as `scripts/build-character-assets.mjs`,
 * which emits the identical 24-name clip set + provenance on a full raw
 * rebuild), then rewrites the GLB and the manifest ledgers (clip list,
 * procedural provenance, root-motion oracle, per-file bytes, totalBytes).
 *
 * Determinism contract: identical input bytes → identical output bytes, and
 * running the script on its own output is a byte-for-byte no-op. Every clip
 * keeps exactly one in-place root translation track, finite normalized
 * quaternion keys, and strictly increasing key times.
 */

import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample, unpartition } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = process.cwd();
const ASSET_DIR = join(ROOT, 'apps/desktop/renderer/src/assets/characters');
const ANIMATIONS_GLB = join(ASSET_DIR, 'animations.glb');
const MANIFEST_JSON = join(ASSET_DIR, 'manifest.json');
const SAMPLE_RATE = 30;
const ROOT_MOTION_MAX_DELTA = 1e-5;
const QUATERNION_NORM_TOLERANCE = 2e-3;
const SIZE_BUDGET_BYTES = 25 * 1024 * 1024;

const DERIVED_CLIP_NAMES = ['look.around', 'sit.fidget', 'stretch'];

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

/* ----------------------------------------------------------------------- */
/* Quaternion / sampling helpers (mirrors build-character-assets.mjs).      */
/* ----------------------------------------------------------------------- */

function samplerValueIndex(sampler, keyIndex) {
  return sampler.getInterpolation() === 'CUBICSPLINE' ? keyIndex * 3 + 1 : keyIndex;
}

function animationDuration(animation) {
  let duration = 0;
  for (const sampler of animation.listSamplers()) {
    const times = sampler.getInput()?.getArray();
    if (times?.length) duration = Math.max(duration, times[times.length - 1]);
  }
  if (!(duration > 0)) fail(`derive: clip '${animation.getName()}' has no duration`);
  return duration;
}

function normalizeQuaternion(value) {
  const length = Math.hypot(value[0], value[1], value[2], value[3]);
  if (!(length > Number.EPSILON)) fail('derive: cannot normalize a zero quaternion');
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
    fail(`derive: cannot sample empty '${channel.getTargetNode()?.getName()}' channel`);
  }
  if (sampler.getInterpolation() === 'CUBICSPLINE') {
    fail('derive: procedural authoring requires LINEAR/STEP source tracks');
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

/* ----------------------------------------------------------------------- */
/* Clip motion design. All periodic terms complete an integer number of     */
/* cycles per loop so first/last frames match exactly. Amplitudes stay      */
/* small (Animal-Crossing-like restrained toy motion) and lower-body tracks */
/* are always exact base-clip copies, keeping butt/soles pinned.            */
/* ----------------------------------------------------------------------- */

const TAU = Math.PI * 2;

function fidgetPoseWeight(joint) {
  if (joint.startsWith('clavicle_')) return 0.35;
  if (joint.startsWith('upperarm_')) return 0.45;
  if (joint.startsWith('lowerarm_')) return 0.6;
  if (joint === 'hand_l') return 0.65;
  if (joint === 'hand_r') return 0.6;
  return 0;
}

function fidgetEulerDelta(joint, normalizedTime) {
  const slow = Math.sin(normalizedTime * TAU);
  const mid = Math.sin(normalizedTime * TAU * 2);
  const quick = Math.sin(normalizedTime * TAU * 3);
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
  const scan = Math.sin(normalizedTime * TAU);
  const nod = Math.sin(normalizedTime * TAU * 2);
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

const ARM_JOINTS = [
  'clavicle_l',
  'upperarm_l',
  'lowerarm_l',
  'hand_l',
  'clavicle_r',
  'upperarm_r',
  'lowerarm_r',
  'hand_r',
];

/* ----------------------------------------------------------------------- */
/* Reference-pose selection: pose the skeleton with a candidate clip and     */
/* measure hand height, picking the most arms-up frame deterministically.    */
/* ----------------------------------------------------------------------- */

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
  if (!left || !right) fail('derive: rig is missing hand joints');
  return (left.getWorldTranslation()[1] + right.getWorldTranslation()[1]) / 2;
}

/**
 * Deterministically pick (clip, normalizedTime) with the highest average
 * hand position across the celebration candidates — the most readable
 * arms-up reference for the restrained stretch.
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
    if (!animation) fail(`derive: stretch reference candidate '${name}' is missing`);
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

/* ----------------------------------------------------------------------- */
/* Derived clip authoring (mirrors createProceduralAnimation).              */
/* ----------------------------------------------------------------------- */

function addAnimationChannel(document, animation, buffer, sourceChannel, inputArray, outputArray) {
  const target = sourceChannel.getTargetNode();
  const path = sourceChannel.getTargetPath();
  if (!target) fail(`derive: procedural '${animation.getName()}' channel target is missing`);
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

function authorDerivedClip(document, name, spec) {
  const root = document.getRoot();
  const base = root.listAnimations().find((animation) => animation.getName() === spec.baseClip);
  const reference = root
    .listAnimations()
    .find((animation) => animation.getName() === spec.poseReferenceClip);
  if (!base || !reference) {
    fail(
      `derive: '${name}' source clips missing ` +
        `(base=${spec.baseClip}, reference=${spec.poseReferenceClip})`,
    );
  }
  const buffer = root.listBuffers()[0];
  if (!buffer) fail(`derive: '${name}' has no target buffer`);
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
      fail(`derive: '${name}' cannot clone an incomplete base channel`);
    }

    if (path === 'rotation' && modified.has(joint)) {
      observed.add(joint);
      const referenceChannel = referenceChannels.get(`${joint}:rotation`);
      if (!referenceChannel) fail(`derive: '${name}' reference rotation '${joint}' missing`);
      const frameCount = Math.round(spec.durationSeconds * SAMPLE_RATE) + 1;
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
  if (missing.length > 0) fail(`derive: '${name}' did not author joints [${missing.join(', ')}]`);
  return {
    baseClip: spec.baseClip,
    poseReferenceClip: spec.poseReferenceClip,
    mode: spec.mode,
    durationSeconds: spec.durationSeconds,
    sampleRate: SAMPLE_RATE,
    modifiedJoints: spec.modifiedJoints,
    lowerBodyPolicy: `exact ${spec.baseClip} channels with duration-normalized key times`,
  };
}

function disposeAnimationChannel(animation, channel) {
  const sampler = channel.getSampler();
  const samplerIsShared = animation
    .listChannels()
    .some((candidate) => candidate !== channel && candidate.getSampler() === sampler);
  channel.dispose();
  if (!samplerIsShared) sampler.dispose();
}

/** Remove every existing clip under the derived names (idempotent rebuild). */
function removeDerivedClips(document) {
  const names = new Set(DERIVED_CLIP_NAMES);
  for (const animation of document.getRoot().listAnimations()) {
    if (!names.has(animation.getName())) continue;
    for (const channel of [...animation.listChannels()]) {
      disposeAnimationChannel(animation, channel);
    }
    animation.dispose();
  }
}

/* ----------------------------------------------------------------------- */
/* Output invariant checks: in-place root, strict times, finite values,     */
/* normalized quaternions — evaluated over the full final clip set.         */
/* ----------------------------------------------------------------------- */

function verifyAndLedger(document) {
  const clips = {};
  let translationChannelsChecked = 0;
  let maxObservedAbsDelta = 0;
  for (const animation of document.getRoot().listAnimations()) {
    const name = animation.getName();
    let rootTranslationTracks = 0;
    let keysChecked = 0;
    let clipMax = 0;
    const targetPaths = new Set();
    for (const channel of animation.listChannels()) {
      const node = channel.getTargetNode();
      const sampler = channel.getSampler();
      const input = sampler?.getInput();
      const output = sampler?.getOutput();
      if (!node || !input || !output || input.getCount() === 0 || output.getCount() === 0) {
        fail(`derive: ${name} has an incomplete channel`);
      }
      const targetPath = `${node.getName()}:${channel.getTargetPath()}`;
      if (targetPaths.has(targetPath)) fail(`derive: ${name} duplicate channel '${targetPath}'`);
      targetPaths.add(targetPath);
      const times = input.getArray();
      const values = output.getArray();
      for (let index = 0; index < times.length; index += 1) {
        if (!Number.isFinite(times[index])) fail(`derive: ${name}:${targetPath} non-finite time`);
        if (index > 0 && times[index] <= times[index - 1]) {
          fail(`derive: ${name}:${targetPath} times are not strictly increasing`);
        }
      }
      for (const value of values) {
        if (!Number.isFinite(value)) fail(`derive: ${name}:${targetPath} non-finite value`);
      }
      if (channel.getTargetPath() === 'rotation') {
        for (let index = 0; index < values.length; index += 4) {
          const norm = Math.hypot(
            values[index],
            values[index + 1],
            values[index + 2],
            values[index + 3],
          );
          if (Math.abs(norm - 1) > QUATERNION_NORM_TOLERANCE) {
            fail(`derive: ${name}:${targetPath} quaternion norm ${norm} is invalid`);
          }
        }
      }
      if (node.getName() === 'root' && channel.getTargetPath() === 'translation') {
        rootTranslationTracks += 1;
        translationChannelsChecked += 1;
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
    }
    if (rootTranslationTracks !== 1) {
      fail(`derive: ${name} has ${rootTranslationTracks} root translation tracks (expected 1)`);
    }
    if (clipMax > ROOT_MOTION_MAX_DELTA) {
      fail(`derive: ${name} root translation drifts by ${clipMax}`);
    }
    clips[name] = {
      keysChecked,
      rootTranslationTracks,
      maxAbsDelta: Number(clipMax.toFixed(8)),
    };
  }
  return { clips, translationChannelsChecked, maxObservedAbsDelta };
}

/* ----------------------------------------------------------------------- */

async function main() {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  io.setLogger(new Logger(Logger.Verbosity.WARN));

  const beforeBytes = readFileSync(ANIMATIONS_GLB);
  const document = await io.read(ANIMATIONS_GLB);
  document.setLogger(new Logger(Logger.Verbosity.WARN));

  removeDerivedClips(document);

  const stretchReference = pickStretchReference(document);
  const specs = {
    'look.around': {
      baseClip: 'idle',
      poseReferenceClip: 'idle',
      poseReferenceTime: 0.25,
      durationSeconds: 2.4,
      mode: 'loop',
      modifiedJoints: ['neck_01', 'Head', 'spine_03'],
      poseWeightFor: () => 0,
      eulerDeltaFor: lookAroundEulerDelta,
    },
    'sit.fidget': {
      baseClip: 'sit.idle',
      poseReferenceClip: 'sit.type',
      poseReferenceTime: 0.5,
      durationSeconds: 2.4,
      mode: 'loop',
      modifiedJoints: [...ARM_JOINTS, 'spine_01', 'Head'],
      poseWeightFor: (joint) => fidgetPoseWeight(joint),
      eulerDeltaFor: fidgetEulerDelta,
    },
    stretch: {
      baseClip: 'idle',
      poseReferenceClip: stretchReference.clip,
      poseReferenceTime: stretchReference.normalizedTime,
      durationSeconds: 2.2,
      mode: 'hold',
      modifiedJoints: [...ARM_JOINTS, 'spine_02', 'spine_03', 'neck_01', 'Head'],
      poseWeightFor: (joint, normalizedTime) => stretchPoseWeight(joint, normalizedTime),
      eulerDeltaFor: stretchEulerDelta,
    },
  };

  const provenance = {};
  for (const name of DERIVED_CLIP_NAMES) {
    provenance[name] = authorDerivedClip(document, name, specs[name]);
  }

  const clipNames = document
    .getRoot()
    .listAnimations()
    .map((animation) => animation.getName())
    .sort();
  if (clipNames.length !== 24) {
    fail(`derive: expected exactly 24 clips after derivation, got ${clipNames.length}`);
  }

  const ledger = verifyAndLedger(document);

  await document.transform(resample(), prune(), dedup(), unpartition());
  await document.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(ANIMATIONS_GLB, document);

  const manifest = JSON.parse(readFileSync(MANIFEST_JSON, 'utf8'));
  manifest.clips = clipNames;
  for (const name of DERIVED_CLIP_NAMES) {
    manifest.clipSources[name] = `offisim-procedural:${name}`;
    manifest.proceduralAnimations[name] = provenance[name];
  }
  manifest.rootMotionOracle = {
    ...manifest.rootMotionOracle,
    maxObservedAbsDelta: Number(ledger.maxObservedAbsDelta.toFixed(8)),
    clipsChecked: clipNames.length,
    translationChannelsChecked: ledger.translationChannelsChecked,
    clips: ledger.clips,
    result: 'pass',
  };
  const animationsBytes = statSync(ANIMATIONS_GLB).size;
  manifest.files['animations.glb'] = animationsBytes;
  manifest.totalBytes = Object.values(manifest.files).reduce((sum, bytes) => sum + bytes, 0);
  if (manifest.totalBytes > SIZE_BUDGET_BYTES) {
    fail(
      `derive: total assets ${(manifest.totalBytes / 1024 / 1024).toFixed(2)} MB exceed the 25 MB budget`,
    );
  }
  writeFileSync(MANIFEST_JSON, `${JSON.stringify(manifest, null, 2)}\n`);

  const afterBytes = readFileSync(ANIMATIONS_GLB);
  console.log(
    [
      `derived ${DERIVED_CLIP_NAMES.join(', ')} into animations.glb`,
      `  stretch reference: ${provenance.stretch.poseReferenceClip} @ t=${specs.stretch.poseReferenceTime}`,
      `  clips: ${clipNames.length} (budget 24), animations.glb ${(animationsBytes / 1024).toFixed(1)} KB, total ${(manifest.totalBytes / 1024 / 1024).toFixed(2)} MB`,
      `  bytes ${beforeBytes.length} -> ${afterBytes.length}`,
    ].join('\n'),
  );
}

await main();
