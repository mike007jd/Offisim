import type { ResolvedAppearance } from '@/lib/avatar.js';
import type { CharacterPerformanceState } from '@offisim/shared-types';
import { useAnimations } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import type { ComponentProps } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import {
  type AnimationAction,
  Color,
  LoopOnce,
  LoopRepeat,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  SkinnedMesh,
} from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { BlockCharacter } from '../BlockCharacter.js';
import { LIGHT_SCENE_3D } from '../r3d/scene-colors.js';
import { CHARACTER_ASSET_URLS, characterManifest, useCharacterGltf } from './character-assets.js';
import {
  type ClipName,
  type ClipSelection,
  POSTURE_TRANSITION_CLIPS,
  clipForPerformance,
} from './clip-map.js';

/**
 * GltfCharacter — drop-in replacement for {@link BlockCharacter} rendering the
 * Quaternius rigged bodies + shared animation library built by
 * `scripts/build-character-assets.mjs`. Implements the exact BlockCharacter
 * props contract (`ComponentProps<typeof BlockCharacter>` — compiler-enforced
 * parity) so the scene can swap components without call-site changes.
 *
 * Appearance mapping:
 *  - gender: masculine → male body, feminine → female body, neutral →
 *    deterministic pick from a stable appearance+phase hash.
 *  - skin: Light/Dark texture variant picked by target luminance, then a
 *    channel-wise multiply tint toward the exact resolved skin color (reference
 *    averages ship in manifest.json).
 *  - clothing: flat Body_Top multiply; Body_Bottom gets the same color darkened
 *    (slacks); shoes keep their baked dark color.
 *  - hair: 8 HairStyle values → 6 baked hair meshes (see HAIR_STYLE_TO_ASSET);
 *    `bald` attaches none. Eyebrows always attach (gendered mesh), tinted with
 *    the hair color. Hair textures are grayscale-normalized so the multiply
 *    reproduces the palette color faithfully.
 *  - accentColor/accentVariant: NOT rendered — the base bodies have no
 *    vest/jacket/scarf overlay geometry (documented integration gap).
 *  - expression: drives clip selection only; the gltf face is textured and has
 *    no morph targets, so there is no per-expression face swap.
 *
 * Rendering contract parity: selection halo + working typing-dots match
 * BlockCharacter's visuals (re-implemented locally — the originals are not
 * exported). Must be mounted inside <Suspense> (glb loads suspend).
 */

type GltfCharacterProps = ComponentProps<typeof BlockCharacter>;
type BlockAction = NonNullable<GltfCharacterProps['action']>;
type BlockPosture = NonNullable<GltfCharacterProps['posture']>;

/** Uniform scale normalizing the ~1.8-unit bodies into the scene's character size. */
const TARGET_HEIGHT_UNITS = 1.62;
/** Typing-dots heights (scene units), adapted to the gltf silhouette. */
const DOTS_Y_STANDING = 1.86;
const DOTS_Y_SITTING = 1.62;
/** Skin tint clamp so extreme palette/texture ratios stay physical. */
const TINT_MIN = 0.35;
const TINT_MAX = 2.8;
/** Bottom-wear darkening relative to the clothing color (reads as slacks). */
const BOTTOM_DARKEN = 0.62;

/** 8 HairStyle values → shipped hair meshes (hair_06 beard reserved for future accents). */
const HAIR_STYLE_TO_ASSET: Record<
  ResolvedAppearance['hairStyle'],
  keyof typeof CHARACTER_ASSET_URLS.hair | null
> = {
  short: 'hair_01', // SimpleParted — generic short office cut
  long: 'hair_02', // Long
  ponytail: 'hair_03', // Buns — closest updo silhouette
  curly: 'hair_04', // Buzzed — tight crop reads as short curls at distance
  bob: 'hair_05', // BuzzedFemale — soft short feminine cut
  spiky: 'hair_04', // Buzzed
  braids: 'hair_03', // Buns
  bald: null,
};

/** Hand-prop attach table (offsets are integration-tunable). */
const PROP_ATTACH = {
  laptop: {
    node: 'prop_laptop',
    bone: 'hand_l',
    position: [0, 0.06, 0.04] as const,
    rotation: [-Math.PI / 2, 0, 0] as const,
  },
  book: {
    node: 'prop_book',
    bone: 'hand_r',
    position: [0, 0.05, 0.02] as const,
    rotation: [-Math.PI / 2, 0, Math.PI] as const,
  },
} as const;

/** Knuth multiplicative hash (mirrors lib/avatar.ts) for the neutral-gender pick. */
function hashString(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 2654435761 + seed.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function luminance(color: Color): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface CharacterRig {
  root: Object3D;
  headBone: Object3D | null;
  /** Materials cloned for per-instance tinting (disposed on rebuild/unmount). */
  materials: MeshStandardMaterial[];
  propHandles: { laptop: Object3D | null; book: Object3D | null };
  scale: number;
}

function cloneMaterial(mesh: Mesh, materials: MeshStandardMaterial[]): MeshStandardMaterial {
  const material = (mesh.material as MeshStandardMaterial).clone();
  mesh.material = material;
  materials.push(material);
  return material;
}

function legacyPerformance(action: BlockAction, posture: BlockPosture): CharacterPerformanceState {
  const base = {
    locomotion: 'idle',
    posture: posture === 'sitting' ? 'sit' : 'stand',
    workGesture: 'none',
    socialGesture: 'none',
    expression: 'neutral',
    intensity: 0,
  } as const satisfies CharacterPerformanceState;
  if (action === 'working') {
    return { ...base, workGesture: 'type', expression: 'focus', intensity: 1, prop: 'laptop' };
  }
  if (action === 'active') {
    return { ...base, socialGesture: 'discuss', expression: 'happy', intensity: 1 };
  }
  // idle + dragging both rest — the halo carries the dragging state.
  return base;
}

function ActionHalo({ action, opacity }: { action: BlockAction; opacity: number }) {
  if (action === 'idle') return null;
  const color =
    action === 'working'
      ? LIGHT_SCENE_3D.ledGreen
      : action === 'active'
        ? LIGHT_SCENE_3D.selectionRing
        : LIGHT_SCENE_3D.ledAmber;
  return (
    <group position={[0, 0.028, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.42, action === 'dragging' ? 0.74 : 0.58, 52]} />
        <meshBasicMaterial transparent opacity={opacity * 0.38} depthWrite={false} color={color} />
      </mesh>
      {action === 'active' ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
          <circleGeometry args={[0.46, 52]} />
          <meshBasicMaterial
            transparent
            opacity={opacity * 0.08}
            depthWrite={false}
            color={color}
          />
        </mesh>
      ) : null}
    </group>
  );
}

/** Three bouncing dots above the head — the unmistakable "I'm working" tell. */
function TypingDots({
  phase,
  opacity,
  posture,
  reducedMotion = false,
}: { phase: number; opacity: number; posture: BlockPosture; reducedMotion?: boolean }) {
  const dotRefs = [useRef<Mesh>(null), useRef<Mesh>(null), useRef<Mesh>(null)];
  useFrame((state) => {
    const t = state.clock.elapsedTime + phase;
    for (let index = 0; index < dotRefs.length; index += 1) {
      const mesh = dotRefs[index]?.current;
      if (!mesh) continue;
      if (reducedMotion) {
        mesh.position.y = 0;
        mesh.scale.setScalar(1);
        continue;
      }
      const bounce = Math.max(0, Math.sin(t * 5.4 - index * 0.85));
      mesh.position.y = bounce * 0.07;
      mesh.scale.setScalar(0.85 + bounce * 0.45);
    }
  });
  return (
    <group position={[0, posture === 'sitting' ? DOTS_Y_SITTING : DOTS_Y_STANDING, 0]}>
      {[-0.09, 0, 0.09].map((x, index) => (
        <mesh key={x} position={[x, 0, 0]} ref={dotRefs[index]}>
          <sphereGeometry args={[0.032, 10, 8]} />
          <meshBasicMaterial
            color={LIGHT_SCENE_3D.ledGreen}
            transparent
            opacity={opacity * 0.9}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

export function GltfCharacter({
  appearance,
  action,
  posture = 'standing',
  running = false,
  reducedMotion = false,
  performance,
  walkingRef,
  tempo = 1,
  phase = 0,
  opacity = 1,
}: GltfCharacterProps) {
  const actionState: BlockAction = action ?? (running ? 'working' : 'idle');
  const usePerformance = performance !== undefined && actionState !== 'dragging';

  const appearanceKey = useMemo(() => JSON.stringify(appearance), [appearance]);
  const seedHash = useMemo(() => hashString(`${appearanceKey}:${phase}`), [appearanceKey, phase]);
  const bodyGender: 'male' | 'female' =
    appearance.gender === 'masculine'
      ? 'male'
      : appearance.gender === 'feminine'
        ? 'female'
        : seedHash % 2 === 0
          ? 'male'
          : 'female';

  const bodyGltf = useCharacterGltf(
    bodyGender === 'male' ? CHARACTER_ASSET_URLS.bodyMale : CHARACTER_ASSET_URLS.bodyFemale,
  );
  const animationsGltf = useCharacterGltf(CHARACTER_ASSET_URLS.animations);
  const propsGltf = useCharacterGltf(CHARACTER_ASSET_URLS.props);
  const hairAsset = HAIR_STYLE_TO_ASSET[appearance.hairStyle];
  // Bald still loads a (cached) placeholder so hooks stay unconditional; it is not attached.
  const hairGltf = useCharacterGltf(
    hairAsset ? CHARACTER_ASSET_URLS.hair[hairAsset] : CHARACTER_ASSET_URLS.brows.brows_01,
  );
  const browsGltf = useCharacterGltf(
    bodyGender === 'male'
      ? CHARACTER_ASSET_URLS.brows.brows_01
      : CHARACTER_ASSET_URLS.brows.brows_02,
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: appearanceKey is the stable serialized identity for `appearance` (fresh object per render upstream); rebuilding on it covers every appearance field read inside.
  const rig = useMemo<CharacterRig>(() => {
    const root = cloneSkeleton(bodyGltf.scene);
    const materials: MeshStandardMaterial[] = [];
    const body = characterManifest.bodies[bodyGender];

    // Skin variant pick + exact-tone tint.
    const target = new Color(appearance.skin);
    const lightRef = new Color(body.skinReference.light);
    const darkRef = new Color(body.skinReference.dark);
    const useLight = luminance(target) >= (luminance(lightRef) + luminance(darkRef)) / 2;
    const reference = useLight ? lightRef : darkRef;
    const skinTint = new Color(
      clamp(target.r / Math.max(reference.r, 0.01), TINT_MIN, TINT_MAX),
      clamp(target.g / Math.max(reference.g, 0.01), TINT_MIN, TINT_MAX),
      clamp(target.b / Math.max(reference.b, 0.01), TINT_MIN, TINT_MAX),
    );
    const clothing = new Color(appearance.clothing);
    const bottom = clothing.clone().multiplyScalar(BOTTOM_DARKEN);
    const hairColor = new Color(appearance.hair);

    const unusedSkinVariant = useLight ? 'Body_Skin_Dark' : 'Body_Skin_Light';
    const removals: Object3D[] = [];
    root.traverse((child) => {
      if (!(child as Mesh).isMesh) return;
      const mesh = child as Mesh;
      mesh.castShadow = true;
      if (mesh instanceof SkinnedMesh) mesh.frustumCulled = false;
      if (mesh.name === unusedSkinVariant) {
        removals.push(mesh);
      } else if (mesh.name === 'Body_Skin_Light' || mesh.name === 'Body_Skin_Dark') {
        cloneMaterial(mesh, materials).color.copy(skinTint);
      } else if (mesh.name === 'Body_Top') {
        cloneMaterial(mesh, materials).color.copy(clothing);
      } else if (mesh.name === 'Body_Bottom') {
        cloneMaterial(mesh, materials).color.copy(bottom);
      } else {
        // Body_Shoes / Eyes keep their baked materials; clone for opacity control.
        cloneMaterial(mesh, materials);
      }
    });
    for (const mesh of removals) mesh.removeFromParent();

    // Head-bone accessories (baked into head-local space at build time).
    const headBone = root.getObjectByName('Head') ?? null;
    if (headBone) {
      const accessories: Object3D[] = [];
      if (hairAsset) accessories.push(hairGltf.scene.clone(true));
      accessories.push(browsGltf.scene.clone(true));
      for (const accessory of accessories) {
        accessory.traverse((child) => {
          if (!(child as Mesh).isMesh) return;
          const mesh = child as Mesh;
          mesh.castShadow = true;
          cloneMaterial(mesh, materials).color.copy(hairColor);
        });
        headBone.add(accessory);
      }
    }

    // Hand props: pre-attached, toggled per-frame from performance.prop.
    const propHandles: CharacterRig['propHandles'] = { laptop: null, book: null };
    for (const [key, spec] of Object.entries(PROP_ATTACH) as [
      keyof typeof PROP_ATTACH,
      (typeof PROP_ATTACH)[keyof typeof PROP_ATTACH],
    ][]) {
      const bone = root.getObjectByName(spec.bone);
      const source = propsGltf.scene.getObjectByName(spec.node);
      if (!bone || !source) continue;
      const prop = source.clone(true);
      prop.position.set(spec.position[0], spec.position[1], spec.position[2]);
      prop.rotation.set(spec.rotation[0], spec.rotation[1], spec.rotation[2]);
      prop.visible = false;
      bone.add(prop);
      propHandles[key] = prop;
    }

    return {
      root,
      headBone,
      materials,
      propHandles,
      scale: TARGET_HEIGHT_UNITS / body.heightUnits,
    };
  }, [
    bodyGltf.scene,
    hairGltf.scene,
    browsGltf.scene,
    propsGltf.scene,
    appearanceKey,
    bodyGender,
    hairAsset,
  ]);

  // Opacity is animated by the scene — mutate the cloned materials, never rebuild.
  useEffect(() => {
    for (const material of rig.materials) {
      material.transparent = opacity < 1;
      material.opacity = opacity;
      material.depthWrite = opacity >= 1;
      material.needsUpdate = true;
    }
  }, [rig, opacity]);

  useEffect(
    () => () => {
      for (const material of rig.materials) material.dispose();
    },
    [rig],
  );

  const { actions, mixer } = useAnimations(animationsGltf.animations, rig.root);

  const playback = useRef<{
    clip: ClipName | null;
    action: AnimationAction | null;
    posture: CharacterPerformanceState['posture'] | null;
    pending: ClipSelection | null;
  }>({ clip: null, action: null, posture: null, pending: null });

  const startClip = (selection: ClipSelection, instant: boolean) => {
    const next = actions[selection.clip];
    if (!next) return;
    const previous = playback.current.action;
    next.reset();
    if (selection.loop) {
      next.setLoop(LoopRepeat, Number.POSITIVE_INFINITY);
      const duration = next.getClip().duration;
      if (duration > 0) next.time = (phase * 1.7) % duration;
    } else {
      next.setLoop(LoopOnce, 1);
      next.clampWhenFinished = true;
    }
    if (previous && previous !== next && !instant) {
      next.crossFadeFrom(previous, selection.fade, false);
    } else if (previous && previous !== next) {
      previous.stop();
    }
    next.play();
    if (instant) mixer.update(0);
    playback.current.clip = selection.clip;
    playback.current.action = next;
  };

  // Posture transitions completing → enter the pending destination clip.
  // biome-ignore lint/correctness/useExhaustiveDependencies: startClip reads live refs/actions; the mixer identity changes together with the rig root, which is when re-registration matters.
  useEffect(() => {
    const onFinished = () => {
      const pending = playback.current.pending;
      if (!pending) return;
      playback.current.pending = null;
      startClip(pending, false);
    };
    mixer.addEventListener('finished', onFinished);
    return () => mixer.removeEventListener('finished', onFinished);
  }, [mixer]);

  useFrame(() => {
    mixer.timeScale = reducedMotion ? 0 : tempo;
    const walking = reducedMotion ? false : (walkingRef?.current ?? false);
    const perf =
      usePerformance && performance
        ? walking
          ? { ...performance, locomotion: 'walk' as const }
          : performance
        : legacyPerformance(actionState, posture);
    const selection = clipForPerformance(perf);
    // While relocating the actor is on their feet — keeps the stand ⇄ sit
    // transition correct when a walk ends at a seated anchor.
    if (perf.locomotion === 'walk') playback.current.posture = 'stand';

    // Hand props follow the performance prop channel.
    const propKind = usePerformance && performance ? performance.prop : undefined;
    const { laptop, book } = rig.propHandles;
    if (laptop) laptop.visible = propKind === 'laptop';
    if (book) book.visible = propKind === 'document' || propKind === 'tablet';

    if (playback.current.clip === selection.clip) return;
    const previousPosture = playback.current.posture;
    playback.current.posture = perf.posture;
    if (reducedMotion) {
      // Static pose: jump straight to the destination clip's first frame.
      startClip(selection, true);
      return;
    }
    if (perf.locomotion !== 'walk' && previousPosture && previousPosture !== perf.posture) {
      // stand ⇄ sit goes through the transition one-shot, then the destination.
      const transition: ClipName =
        perf.posture === 'sit'
          ? POSTURE_TRANSITION_CLIPS.sitEnter
          : POSTURE_TRANSITION_CLIPS.sitExit;
      const transitionAction = actions[transition];
      if (transitionAction) {
        playback.current.pending = selection;
        startClip({ clip: transition, loop: false, fade: 0.15 }, false);
        // Report the destination so later frames don't cut the transition short;
        // the mixer 'finished' event promotes `pending` into the playing clip.
        playback.current.clip = selection.clip;
        return;
      }
    }
    playback.current.pending = null;
    startClip(selection, false);
  });

  return (
    <group>
      <ActionHalo action={actionState} opacity={opacity} />
      {actionState === 'working' ? (
        <TypingDots
          phase={phase}
          opacity={opacity}
          posture={posture}
          reducedMotion={reducedMotion}
        />
      ) : null}
      <group scale={rig.scale}>
        <primitive object={rig.root} />
      </group>
    </group>
  );
}
