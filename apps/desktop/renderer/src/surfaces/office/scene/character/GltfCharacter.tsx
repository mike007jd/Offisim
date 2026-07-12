import type { ResolvedAppearance } from '@/lib/avatar.js';
import {
  CHARACTER_WALK_ANIMATION_TIME_SCALE,
  type CharacterPerformanceState,
  type CharacterStatus,
  performanceForStatus,
} from '@offisim/shared-types';
import { useAnimations } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  type AnimationAction,
  type AnimationClip,
  BoxGeometry,
  type BufferGeometry,
  CircleGeometry,
  Color,
  Group,
  LoopOnce,
  LoopRepeat,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  type Skeleton,
  SkinnedMesh,
  TorusGeometry,
} from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  type CharacterMovementPhase,
  performanceForMovementPhase,
  shouldPromoteSitExit,
} from '../character-movement.js';
import { OFFICE_TOY_CHARACTER_COLORS } from '../r3d/scene-colors.js';
import { OFFICE_CHARACTER_METRICS, WORKSTATION_VERTICAL_METRICS } from '../workstation-geometry.js';
import { CHARACTER_ASSET_URLS, characterManifest, useCharacterGltf } from './character-assets.js';
import {
  createCharacterPlaybackState,
  finishCharacterPlayback,
  isStandingMovementMount,
  reconcilePlaybackMount,
  requestCharacterPlayback,
} from './character-playback.js';
import {
  type ClipName,
  type ClipSelection,
  POSTURE_TRANSITION_CLIPS,
  clipForPerformance,
} from './clip-map.js';
import { attachGarments } from './garments.js';
import { CharacterIndicators } from './indicators.js';
import {
  type AccessoryKind,
  BODY_TYPE_GIRTH,
  EYE_SPEC,
  type EyeStyle,
  HAIR_STYLE_TO_ASSET,
  HAIR_TRANSFORMS,
  HEAD_SHAPE_SCALE,
  PERFORMANCE_PROP_ASSET,
  PROP_ATTACH,
  accessoryForPerformance,
  blinkScheduleForPhase,
  eyeStyleForExpression,
  isBlinking,
  rolePresentationFor,
} from './toy-character-contract.js';

/**
 * GltfCharacter — THE office character renderer: one neutral toy body +
 * the shared animation library built by `scripts/build-character-assets.mjs`.
 * It replaced the procedural block-person renderer outright and owns its props
 * contract ({@link CharacterProps}); the scene (EmployeeUnit / drag ghost) and
 * the Personnel appearance preview are the two call sites.
 *
 * Appearance mapping:
 *  - gender: persona/2D-avatar metadata only; the 3D body is always body_toy.
 *  - skin: one direct-tint material lane across six neutral tone tokens.
 *  - clothing: the flat Body_Top / Body_Bottom multiply is the BASE layer, then
 *    procedural garment geometry (see ./garments.ts) is bone-attached OVER it so
 *    the character reads as dressed, not as a color-coded bodysuit. Body_Top =
 *    clothing color, Body_Bottom = the ACCENT color darkened (both still show
 *    where garments don't cover); the "clothing accent" swatch also tints lapels
 *    / plackets / belts. Baked shoes keep their dark color.
 *  - outfit: blazer | shirt | sweater | dress → the garment SET (jacket lapels +
 *    collar + belt / button placket + collar / crewneck / bodice + flared skirt).
 *    Sleeves + torso shell are common; dress swaps trousers for a skirt. Pieces
 *    are rigid segments parented to the rig bones (torso→spine, sleeves→arm
 *    bones, trousers→leg bones) so they follow every clip; a missing bone just
 *    drops that piece. See ./garments.ts for the attachment math.
 *  - bodyType: slim | normal | stocky → a girth factor applied as a non-uniform
 *    XZ scale on the body wrapper (BODY_TYPE_GIRTH), so the whole silhouette —
 *    body + garments together — reads narrower/wider. Height stays normalized.
 *  - headShape: round | soft-square | capsule → non-uniform Head-bone scale;
 *    attached hair and eye decals inherit the same transform.
 *  - hair: 13 HairStyle values → 12 authored toy-head meshes; bald attaches none.
 *  - expression: switches four procedural eye-decal states. A deterministic
 *    phase-based 2–6s blink is disabled by reduced motion; there is no mouth,
 *    brow, facial bone or morph lane.
 *  - role: a small chest badge is always present; explicit dramaturgy props win,
 *    otherwise an active role may show its default work accessory.
 *
 * Status indicators come from `./indicators.js`: one operational-state
 * language, floor/head anchored at the component origin, with selection as an
 * orthogonal layer.
 * Animation binding lives in the inner {@link RigView}, keyed per rig
 * instance: drei's useAnimations caches its actions against the first bound
 * root, so an appearance/gender/hair change (rig rebuild) must remount the
 * binding or the new clone T-poses forever.
 * Must be mounted inside <Suspense> (glb loads suspend).
 */

type CharacterPosture = 'standing' | 'sitting';

export interface CharacterProps {
  appearance: ResolvedAppearance;
  posture?: CharacterPosture;
  /** First-class office state. Selection never rewrites this value. */
  status?: CharacterStatus;
  selected?: boolean;
  /** A typed T/B/P/C/R/X marker already owns the head-confirmation slot. */
  hasTypedResourceMarker?: boolean;
  /** Suppresses office indicators inside the separately-rendered drag ghost. */
  dragging?: boolean;
  /**
   * Accessibility: when true the character holds a STATIC resting pose — the
   * mixer freezes (timeScale 0) so there is no idle bob, typing sway, gesture
   * loop, celebration, or walk. Status color, expression-driven clip choice,
   * label, approval, and error info are preserved (they are not vestibular
   * motion). Relocation is separately suppressed upstream (modes.ts).
   */
  reducedMotion?: boolean;
  /**
   * Layered dramaturgy performance (Phase 3+). When absent, a total fallback is
   * derived from `status + posture`; there is no legacy action lane.
   */
  performance?: CharacterPerformanceState;
  /** Mutable scene movement phase. A seated departure holds `sit-exit` until
   *  that one-shot finishes, then this component promotes it to `walk`; arrival
   *  returns to `idle` and the normal posture transition plays sit.enter. */
  walkingRef?: { current: CharacterMovementPhase };
  /** Performance-profile tempo (employee flavor); scales animation speed only. */
  tempo?: number;
  /** Deterministic phase offset so idle loops don't sync across the room. */
  phase?: number;
  opacity?: number;
  /** Canonical role slug/label; drives only badge + default prop, never appearance. */
  role?: string;
}

/** Uniform scale normalizing the ~1.8-unit bodies into the scene's character size. */
const TARGET_HEIGHT_UNITS = OFFICE_CHARACTER_METRICS.height;
/** Typing-dots heights (scene units), adapted to the gltf silhouette. */
const DOTS_Y_STANDING = 1.86;
const DOTS_Y_SITTING = 1.62;
/**
 * Seated-body alignment. The sit clips are authored floor-origin: posed-mesh
 * sampling of `sit.idle` puts the butt-bottom at ~0.47 raw units (≈0.42 scene)
 * with the pelvis pulled 0.33 raw (≈0.30 scene) BEHIND the origin and the feet
 * on the floor at the origin — a ~0.45-unit authoring seat. Scene chairs
 * (OfficeChair) top their cushion at 0.60 local, and the seat planner anchors
 * seated actors 0.04 inside the chair centre expecting the butt AT the anchor
 * (the block-character convention the anchors were tuned for). So while seated
 * the rig shifts up and forward to park the butt on the cushion at the anchor;
 * the shift lives HERE (not in the scene) so the floor indicator and component
 * origin stay on the ground at the seat anchor. Applied with a
 * short ease so walk→sit arrivals blend through sit.enter instead of popping.
 */
const SEATED_BODY_LIFT = WORKSTATION_VERTICAL_METRICS.seatedBodyLift;
const SEATED_BODY_FORWARD = WORKSTATION_VERTICAL_METRICS.seatedBodyForward;
/** Ease rate (per second) for the seated-body offset blend. */
const SEATED_OFFSET_EASE = 7;
/** Bottom-wear darkening relative to the clothing color (reads as slacks). */
const BOTTOM_DARKEN = 0.62;
type EyeHandles = Record<EyeStyle | 'blink', Group>;

interface CharacterRig {
  /** Monotonic instance id — keys the RigView remount per rebuilt clone. */
  id: number;
  root: Object3D;
  /** Materials cloned for per-instance tinting/fading (disposed on rebuild/unmount). */
  materials: MeshStandardMaterial[];
  /** Per-clone skeletons (SkeletonUtils.clone creates fresh ones with their own
   *  bone texture) — disposed on rebuild/unmount; shared loader-cache geometry
   *  and textures are NEVER disposed here. */
  skeletons: Skeleton[];
  /** Per-instance procedural garment geometries — created fresh per rig, so
   *  they are disposed on rebuild/unmount (unlike shared loader-cache geometry). */
  proceduralGeometries: BufferGeometry[];
  propHandles: Partial<Record<AccessoryKind, Object3D>>;
  eyeHandles: EyeHandles;
  roleAccessory: AccessoryKind;
  scale: number;
  /** Silhouette girth from bodyType — applied as the wrapper's XZ scale. */
  girth: number;
}

let rigInstanceSeq = 0;

function cloneMaterial(mesh: Mesh, materials: MeshStandardMaterial[]): MeshStandardMaterial {
  const material = (mesh.material as MeshStandardMaterial).clone();
  mesh.material = material;
  materials.push(material);
  return material;
}

/** Mouth decal plane: on the face curve below the eyes, above the chin. */
const MOUTH_Y = -0.15;
const MOUTH_Z = 0.365;

function attachEyeDecals(
  headBone: Object3D,
  materials: MeshStandardMaterial[],
  geometries: BufferGeometry[],
): EyeHandles {
  const eyeMaterial = new MeshStandardMaterial({
    color: OFFICE_TOY_CHARACTER_COLORS.eye,
    roughness: 0.96,
    metalness: 0,
  });
  materials.push(eyeMaterial);
  const handles = {} as EyeHandles;
  // Each expression group carries its eyes AND its mouth, so the per-frame
  // visibility toggle keeps the whole face consistent as one unit.
  const makeFace = (
    style: EyeStyle | 'blink',
    geometry: BufferGeometry,
    mouth: { geometry: BufferGeometry; flipped?: boolean },
    rotationFor: (side: -1 | 1) => number = () => 0,
  ) => {
    const group = new Group();
    group.name = `ToyEyes_${style}`;
    group.visible = false;
    geometries.push(geometry);
    for (const side of [-1, 1] as const) {
      const eye = new Mesh(geometry, eyeMaterial);
      eye.position.set(side * 0.145, 0.07, EYE_SPEC.planeZ);
      eye.rotation.z = rotationFor(side);
      eye.castShadow = false;
      eye.frustumCulled = false;
      group.add(eye);
    }
    geometries.push(mouth.geometry);
    const mouthMesh = new Mesh(mouth.geometry, eyeMaterial);
    mouthMesh.position.set(0, MOUTH_Y, MOUTH_Z);
    // Torus arcs open upward by default; a smile needs the arc flipped down.
    mouthMesh.rotation.z = mouth.flipped ? 0 : Math.PI;
    mouthMesh.castShadow = false;
    mouthMesh.frustumCulled = false;
    group.add(mouthMesh);
    headBone.add(group);
    handles[style] = group;
  };
  const smallSmile = () => ({ geometry: new TorusGeometry(0.05, 0.012, 6, 14, Math.PI) });
  makeFace('neutral', new CircleGeometry(0.05, 16), smallSmile());
  makeFace(
    'happy',
    new TorusGeometry(0.056, 0.014, 6, 14, Math.PI),
    { geometry: new TorusGeometry(0.066, 0.015, 6, 14, Math.PI) },
  );
  makeFace(
    'worried',
    new BoxGeometry(0.088, 0.02, 0.012),
    { geometry: new TorusGeometry(0.042, 0.012, 6, 14, Math.PI), flipped: true },
    (side) => side * 0.28,
  );
  makeFace('focus', new BoxGeometry(0.09, 0.019, 0.012), {
    geometry: new BoxGeometry(0.07, 0.016, 0.012),
  });
  makeFace('blink', new BoxGeometry(0.086, 0.017, 0.012), smallSmile());
  return handles;
}

interface RigViewProps {
  rig: CharacterRig;
  animations: AnimationClip[];
  posture: CharacterPosture;
  status: CharacterStatus;
  performance?: CharacterPerformanceState;
  walkingRef?: { current: CharacterMovementPhase };
  tempo: number;
  phase: number;
  reducedMotion: boolean;
}

/**
 * Animation binding + playback for ONE rig instance. Mounted with
 * `key={rig.id}` so a rig rebuild (appearance/gender/hair change) tears the
 * whole binding down and re-creates it against the new cloned root — drei's
 * useAnimations lazily caches its actions on the first root it binds, so
 * rebinding in place would leave the fresh clone unanimated (T-pose) while the
 * active/desired playback guards suppress any restart.
 */
function RigView({
  rig,
  animations,
  posture,
  status,
  performance,
  walkingRef,
  tempo,
  phase,
  reducedMotion,
}: RigViewProps) {
  const { actions, mixer } = useAnimations(animations, rig.root);
  /** Wrapper group carrying scale + the seated-body offset. The offset must NOT
   *  live on rig.root — the clips bind a constant-zero `root.position` track
   *  that would overwrite any mutation there every mixer update. */
  const bodyRef = useRef<Group>(null);
  const basePerformance =
    performance ?? performanceForStatus(status, posture === 'sitting' ? 'sit' : 'stand');

  // Seed the seated offset before first paint so already-seated actors mount
  // parked on their chair instead of easing up out of the floor.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only seed — the per-frame ease below owns the offset afterwards.
  useLayoutEffect(() => {
    const seated = basePerformance.posture === 'sit';
    bodyRef.current?.position.set(
      0,
      seated ? SEATED_BODY_LIFT : 0,
      seated ? SEATED_BODY_FORWARD : 0,
    );
  }, []);

  const initialPosture: CharacterPerformanceState['posture'] =
    walkingRef?.current === 'walk' ? 'stand' : basePerformance.posture;
  const playback = useRef(createCharacterPlaybackState(initialPosture));
  // Tracks reduced-motion transitions: enabling it mid-clip must snap to the
  // clip's static pose, not freeze whatever frame the mixer happened to be on.
  const wasReducedMotionRef = useRef(reducedMotion);
  const visiblePropRef = useRef<Object3D | null>(null);
  const visibleEyeRef = useRef<Group | null>(null);
  const blinkSchedule = useMemo(() => blinkScheduleForPhase(phase), [phase]);

  const startClip = (selection: ClipSelection, instant: boolean) => {
    const next = actions[selection.clip];
    if (!next) return;
    const previousClip = playback.current.activeClip;
    const previous = previousClip ? actions[previousClip] : null;
    next.reset();
    next.clampWhenFinished = !selection.loop;
    const duration = next.getClip().duration;
    if (selection.loop) {
      next.setLoop(LoopRepeat, Number.POSITIVE_INFINITY);
      if (duration > 0) next.time = (phase * 1.7) % duration;
    } else {
      next.setLoop(LoopOnce, 1);
    }
    if (instant) next.time = Math.min(Math.max(selection.reducedPoseTime, 0), duration);
    if (previous && previous !== next && !instant) {
      next.crossFadeFrom(previous, selection.fade, false);
    } else if (previous && previous !== next) {
      previous.stop();
    }
    next.play();
    if (instant) mixer.update(0);
  };

  // Posture transitions completing → enter the pending destination clip. A
  // scene-requested seated departure advances only AFTER sit.exit has visibly
  // completed, so translation can never start under a seated pose.
  // biome-ignore lint/correctness/useExhaustiveDependencies: startClip reads live refs/actions; the mixer lives as long as this RigView instance (keyed per rig), so mount-time registration is exactly right.
  useEffect(() => {
    const onFinished = (event: { action: AnimationAction }) => {
      const finishedClip = event.action.getClip().name as ClipName;
      const result = finishCharacterPlayback(playback.current, finishedClip);
      if (result.command) startClip(result.command.selection, result.command.instant);
      playback.current = result.state;
      if (
        walkingRef?.current === 'sit-exit' &&
        result.completedTransition === POSTURE_TRANSITION_CLIPS.sitExit
      ) {
        walkingRef.current = 'walk';
      }
    };
    mixer.addEventListener('finished', onFinished);
    return () => mixer.removeEventListener('finished', onFinished);
  }, [mixer]);

  useFrame((state, delta) => {
    const movementPhase = reducedMotion ? 'idle' : (walkingRef?.current ?? 'idle');
    const standingMovementMount = isStandingMovementMount(playback.current, movementPhase);
    playback.current = reconcilePlaybackMount(playback.current, movementPhase);
    const perf = performanceForMovementPhase(basePerformance, movementPhase);
    const selection: ClipSelection = clipForPerformance(perf);
    // Locomotion clips play at the stride-synced rate (feet match the ground
    // actually covered at CHARACTER_WALK_SPEED_UNITS_PER_SECOND); everything
    // else keeps the employee's tempo flavor.
    const striding =
      movementPhase === 'walk' &&
      (selection.clip === 'walk' || selection.clip === 'walk.formal' || selection.clip === 'carry');
    mixer.timeScale = reducedMotion ? 0 : striding ? CHARACTER_WALK_ANIMATION_TIME_SCALE : tempo;

    // Seated-body offset (see SEATED_BODY_LIFT): butt onto the chair cushion
    // while seated, floor origin otherwise. Eased so walk→sit arrivals blend
    // through sit.enter; reduced motion snaps (static pose, no drift motion).
    const body = bodyRef.current;
    if (body) {
      const seated = perf.posture === 'sit' && perf.locomotion !== 'walk';
      const targetLift = seated ? SEATED_BODY_LIFT : 0;
      const targetForward = seated ? SEATED_BODY_FORWARD : 0;
      if (reducedMotion || standingMovementMount) {
        body.position.set(0, targetLift, targetForward);
      } else {
        const ease = Math.min(1, delta * SEATED_OFFSET_EASE);
        body.position.y += (targetLift - body.position.y) * ease;
        body.position.z += (targetForward - body.position.z) * ease;
      }
    }
    // Explicit dramaturgy props win. When none is authored, an active character
    // may show the role's default accessory; idle figures never permanently
    // hold props. Only visibility transitions write into the scene graph.
    const accessory = accessoryForPerformance(perf.prop, rig.roleAccessory, status === 'working');
    const nextProp = accessory ? (rig.propHandles[accessory] ?? null) : null;
    if (visiblePropRef.current !== nextProp) {
      if (visiblePropRef.current) visiblePropRef.current.visible = false;
      if (nextProp) nextProp.visible = true;
      visiblePropRef.current = nextProp;
    }

    const eyeStyle = eyeStyleForExpression(perf.expression);
    const blink = isBlinking(state.clock.elapsedTime, blinkSchedule, reducedMotion);
    const nextEye = rig.eyeHandles[blink ? 'blink' : eyeStyle];
    if (visibleEyeRef.current !== nextEye) {
      if (visibleEyeRef.current) visibleEyeRef.current.visible = false;
      nextEye.visible = true;
      visibleEyeRef.current = nextEye;
    }

    const reducedJustEnabled = reducedMotion && !wasReducedMotionRef.current;
    wasReducedMotionRef.current = reducedMotion;
    // A standing actor has nothing to exit. Promote immediately, but never
    // interrupt an in-flight sit.exit (`transition` stays set until mixer finish).
    if (
      shouldPromoteSitExit(
        movementPhase,
        playback.current.actualPosture,
        playback.current.transition !== null,
      )
    ) {
      if (walkingRef) walkingRef.current = 'walk';
      return;
    }
    const result = requestCharacterPlayback(
      playback.current,
      { posture: perf.posture, selection },
      { reducedMotion, forceRestart: reducedJustEnabled },
    );
    if (result.command) startClip(result.command.selection, result.command.instant);
    playback.current = result.state;
  });

  return (
    // Non-uniform XZ girth (bodyType) widens/narrows the whole silhouette —
    // body + bone-attached garments together — while height stays normalized.
    // The per-frame seated offset only mutates position, so this scale is stable.
    <group ref={bodyRef} scale={[rig.scale * rig.girth, rig.scale, rig.scale * rig.girth]}>
      <primitive object={rig.root} />
    </group>
  );
}

export function GltfCharacter({
  appearance,
  posture = 'standing',
  status = 'idle',
  selected = false,
  hasTypedResourceMarker = false,
  dragging = false,
  reducedMotion = false,
  performance,
  walkingRef,
  tempo = 1,
  phase = 0,
  opacity = 1,
  role,
}: CharacterProps) {
  // `gender` is deliberately absent: it is 2D/persona metadata and must not
  // rebuild the 3D skeleton, materials, props, garments, or animation binding.
  const appearanceKey = JSON.stringify([
    appearance.skin,
    appearance.hair,
    appearance.clothing,
    appearance.accent,
    appearance.hairStyle,
    appearance.bodyType,
    appearance.headShape,
    appearance.outfit,
  ]);
  const bodyGltf = useCharacterGltf(CHARACTER_ASSET_URLS.bodyToy);
  const animationsGltf = useCharacterGltf(CHARACTER_ASSET_URLS.animations);
  const propsGltf = useCharacterGltf(CHARACTER_ASSET_URLS.props);
  const hairAsset = HAIR_STYLE_TO_ASSET[appearance.hairStyle];
  // Hooks stay unconditional for bald; hair_01 is already in the loader cache
  // and is simply not attached when the resolved style is null.
  const hairGltf = useCharacterGltf(CHARACTER_ASSET_URLS.hair[hairAsset ?? 'hair_01']);
  const rolePresentation = rolePresentationFor(role);

  // biome-ignore lint/correctness/useExhaustiveDependencies: appearanceKey is the stable serialized identity for `appearance` (fresh object per render upstream); rebuilding on it covers every appearance field read inside.
  const rig = useMemo<CharacterRig>(() => {
    const root = cloneSkeleton(bodyGltf.scene);
    const materials: MeshStandardMaterial[] = [];
    const proceduralGeometries: BufferGeometry[] = [];
    const skeletonSet = new Set<Skeleton>();
    const body = characterManifest.bodies.toy;

    // The procedural P0 body has no basecolor texture: apply the resolved skin
    // tone directly. Texture-ratio tinting would replace the material factor
    // with a multiplier and overexpose light tones.
    const target = new Color(appearance.skin);
    // Two-tone BASE layer: top = clothing, bottom = the accent color darkened so
    // vivid accents read as slacks. The procedural garments (below) sit over this
    // so the character reads as dressed; the base still shows where garments
    // don't cover, and accent also tints garment lapels/plackets/belts.
    const clothing = new Color(appearance.clothing);
    const accent = new Color(appearance.accent);
    const bottom = accent.clone().multiplyScalar(BOTTOM_DARKEN);
    const hairColor = new Color(appearance.hair);

    const unusedSkinVariant = 'Body_Skin_Dark';
    const removals: Object3D[] = [];
    root.traverse((child) => {
      if (!(child as Mesh).isMesh) return;
      const mesh = child as Mesh;
      mesh.castShadow = true;
      if (mesh instanceof SkinnedMesh) {
        mesh.frustumCulled = false;
        // Per-clone GPU resource (bone texture) — tracked for disposal.
        skeletonSet.add(mesh.skeleton);
      }
      if (mesh.name === unusedSkinVariant) {
        removals.push(mesh);
      } else if (mesh.name === 'Body_Skin_Light' || mesh.name === 'Body_Skin_Dark') {
        cloneMaterial(mesh, materials).color.copy(target);
      } else if (mesh.name === 'Body_Top') {
        cloneMaterial(mesh, materials).color.copy(clothing);
      } else if (mesh.name === 'Body_Bottom') {
        cloneMaterial(mesh, materials).color.copy(bottom);
      } else {
        // Body_Shoes keeps its baked material; clone for opacity control.
        cloneMaterial(mesh, materials);
      }
    });
    for (const mesh of removals) mesh.removeFromParent();

    // Head-bone accessories (baked into head-local space at build time).
    const headBone = root.getObjectByName('Head') ?? null;
    let eyeHandles: EyeHandles | null = null;
    if (headBone) {
      const headScale = HEAD_SHAPE_SCALE[appearance.headShape];
      headBone.scale.set(headScale[0], headScale[1], headScale[2]);
      if (hairAsset) {
        const accessory = hairGltf.scene.clone(true);
        accessory.traverse((child) => {
          if (!(child as Mesh).isMesh) return;
          const mesh = child as Mesh;
          mesh.castShadow = true;
          cloneMaterial(mesh, materials).color.copy(hairColor);
        });
        const transform = HAIR_TRANSFORMS[hairAsset];
        accessory.position.set(...transform.position);
        accessory.scale.set(...transform.scale);
        headBone.add(accessory);
      }
      eyeHandles = attachEyeDecals(headBone, materials, proceduralGeometries);
    }
    if (!headBone || !eyeHandles) throw new Error('body_toy.glb is missing the required Head bone');

    // Hand props: pre-attached, toggled per-frame from the merged perf.prop.
    // Prop materials are cloned into rig.materials too, so the scene's
    // ghost/fade opacity applies to a held laptop exactly like the body.
    const propHandles: Partial<Record<AccessoryKind, Object3D>> = {};
    const requiredProps = new Set<AccessoryKind>(Object.values(PERFORMANCE_PROP_ASSET));
    requiredProps.add(rolePresentation.accessory);
    for (const key of requiredProps) {
      const spec = PROP_ATTACH[key];
      const bone = root.getObjectByName(spec.bone);
      const source = propsGltf.scene.getObjectByName(spec.node);
      if (!bone || !source) continue;
      const prop = source.clone(true);
      prop.traverse((child) => {
        if (!(child as Mesh).isMesh) return;
        cloneMaterial(child as Mesh, materials);
      });
      prop.position.set(spec.position[0], spec.position[1], spec.position[2]);
      prop.rotation.set(spec.rotation[0], spec.rotation[1], spec.rotation[2]);
      prop.visible = false;
      bone.add(prop);
      propHandles[key] = prop;
    }

    // Procedural office garments bone-attached over the base tint (see
    // ./garments.ts). Their materials join `materials` (so the scene's fade
    // opacity + disposal cover them); their geometries are per-instance and
    // disposed alongside the clone. Guards internally, so a differently-built
    // body just yields fewer pieces.
    const garments = attachGarments(
      root,
      appearance,
      { clothing, accent, bottom },
      rolePresentation.color,
    );
    materials.push(...garments.materials);
    proceduralGeometries.push(...garments.geometries);

    rigInstanceSeq += 1;
    return {
      id: rigInstanceSeq,
      root,
      materials,
      skeletons: [...skeletonSet],
      proceduralGeometries,
      propHandles,
      eyeHandles,
      roleAccessory: rolePresentation.accessory,
      scale: TARGET_HEIGHT_UNITS / body.heightUnits,
      girth: BODY_TYPE_GIRTH[appearance.bodyType] ?? 1,
    };
  }, [
    bodyGltf.scene,
    hairGltf.scene,
    propsGltf.scene,
    appearanceKey,
    hairAsset,
    rolePresentation.accessory,
    rolePresentation.color,
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

  // Dispose per-clone GPU resources on rig rebuild AND on unmount: the cloned
  // materials and the clone's skeletons (bone textures). Loader-cache-shared
  // geometry/textures are intentionally NOT disposed — the cache owns them.
  useEffect(
    () => () => {
      for (const material of rig.materials) material.dispose();
      for (const skeleton of rig.skeletons) skeleton.dispose();
      for (const geometry of rig.proceduralGeometries) geometry.dispose();
    },
    [rig],
  );

  return (
    <group>
      <CharacterIndicators
        status={status}
        selected={selected}
        dragging={dragging}
        phase={phase}
        opacity={opacity}
        headY={
          (performance?.posture ?? (posture === 'sitting' ? 'sit' : 'stand')) === 'sit'
            ? DOTS_Y_SITTING
            : DOTS_Y_STANDING
        }
        reducedMotion={reducedMotion}
        hasTypedResourceMarker={hasTypedResourceMarker}
      />
      <RigView
        key={rig.id}
        rig={rig}
        animations={animationsGltf.animations}
        posture={posture}
        status={status}
        performance={performance}
        walkingRef={walkingRef}
        tempo={tempo}
        phase={phase}
        reducedMotion={reducedMotion}
      />
    </group>
  );
}
