import type { ResolvedAppearance } from '@/lib/avatar.js';
import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from 'three';

/**
 * Procedural office garments for the GltfCharacter rig.
 *
 * The shipped Quaternius bodies have NO garment geometry — `Body_Top` /
 * `Body_Bottom` are just flat-retintable skin regions, so a flat two-tone tint
 * reads as a color-coded skin-tight bodysuit. This module builds believable
 * clothing (blazer / shirt / sweater / dress) from three.js primitives and
 * bone-attaches it so it follows the animation.
 *
 * How it follows the rig (rigid bone attachment, not a new SkinnedMesh):
 *  - Each garment piece is authored in the rig's own MODEL space using the
 *    LIVE bind-pose bone world positions (read after `root.updateMatrixWorld`),
 *    so proportions match the real skeleton regardless of the armature's baked
 *    scale/orientation.
 *  - A piece's world placement `M` is converted to a bone-local matrix
 *    `bone.matrixWorld⁻¹ · M` and the piece is parented to that bone with
 *    `matrixAutoUpdate = false` (the exact matrix is preserved even if the bone
 *    chain carries non-uniform scale). When the bone animates, the piece rides
 *    with it rigidly — a sleeve on `upperarm_l` swings when the arm swings, a
 *    trouser on `thigh_r` folds when the actor sits. Limb segments split at the
 *    joints (upper/fore arm, thigh/calf) so the elbow/knee bend reads.
 *  - No new rig bones are introduced and no clip is touched, so the RigView
 *    clip state machine, crossfades, reduced-motion freeze, and the seated
 *    offset are all unaffected. Silhouette girth (bodyType) is a separate XZ
 *    scale on the body wrapper (see GltfCharacter), which these pieces inherit.
 *
 * Everything is derived from actual bone geometry and every piece guards its
 * bones, so a missing bone (or a differently-built body) degrades to fewer
 * pieces instead of throwing. Colors come from the resolved appearance; the
 * caller passes the same clothing/accent/bottom Colors it tints the body with
 * so the garments stay in palette (no raw hex here).
 */

const UP_Y = new Vector3(0, 1, 0);
const UNIT_SCALE = new Vector3(1, 1, 1);
const GARMENT_ROUGHNESS = 0.74;

export interface GarmentColors {
  /** Torso / sleeve base (matches Body_Top tint). */
  clothing: Color;
  /** Lapel / placket / belt trim (the "clothing accent" swatch). */
  accent: Color;
  /** Trouser / lower-outfit tone (matches the darkened Body_Bottom tint). */
  bottom: Color;
}

export interface GarmentBuild {
  materials: MeshStandardMaterial[];
  geometries: BufferGeometry[];
}

/**
 * Build + bone-attach the procedural garment set for `appearance.outfit`.
 * Returns the created materials (so the caller can fade them with the body and
 * dispose them on rebuild) and geometries (disposed on rebuild). Mutates `root`
 * by adding child meshes to its bones.
 */
export function attachGarments(
  root: Object3D,
  appearance: ResolvedAppearance,
  colors: GarmentColors,
  roleBadgeColor: string,
): GarmentBuild {
  const materials: MeshStandardMaterial[] = [];
  const materialByColor = new Map<string, MeshStandardMaterial>();
  const geometries: BufferGeometry[] = [];
  const result = { materials, geometries };

  root.updateMatrixWorld(true);

  const bone = (name: string): Object3D | null => root.getObjectByName(name) ?? null;
  const posOf = (b: Object3D): Vector3 => new Vector3().setFromMatrixPosition(b.matrixWorld);

  const spine2 = bone('spine_02');
  const spine3 = bone('spine_03') ?? spine2;
  const pelvis = bone('pelvis');
  const neck = bone('neck_01');
  const upperArmL = bone('upperarm_l');
  const upperArmR = bone('upperarm_r');

  // A torso frame needs the spine anchor, the pelvis, and both shoulders.
  if (!spine2 || !spine3 || !pelvis || !upperArmL || !upperArmR) return result;

  const pPelvis = posOf(pelvis);
  const pShoulderL = posOf(upperArmL);
  const pShoulderR = posOf(upperArmR);
  const pShoulderMid = pShoulderL.clone().add(pShoulderR).multiplyScalar(0.5);
  const pTop = neck ? posOf(neck) : pShoulderMid;

  const shoulderW = pShoulderL.distanceTo(pShoulderR) || 1;

  // Orthonormal body frame, fully derived from bone positions.
  const up = pTop.clone().sub(pPelvis).normalize();
  const shoulderRight = pShoulderL.clone().sub(pShoulderR).normalize();
  let forward = new Vector3().crossVectors(shoulderRight, up).normalize();
  const ballL = bone('ball_l');
  const footL = bone('foot_l');
  if (ballL && footL) {
    // Point "forward" the way the toes point.
    const toe = posOf(ballL).sub(posOf(footL));
    if (forward.dot(toe) < 0) forward.negate();
  }
  const right = new Vector3().crossVectors(up, forward).normalize();
  forward = new Vector3().crossVectors(right, up).normalize();

  const basis = (pos: Vector3): Matrix4 =>
    new Matrix4().makeBasis(right, up, forward).setPosition(pos);

  const materialFor = (color: Color): MeshStandardMaterial => {
    const key = color.toArray().join(',');
    const existing = materialByColor.get(key);
    if (existing) return existing;
    const material = new MeshStandardMaterial({
      color: color.clone(),
      roughness: GARMENT_ROUGHNESS,
      metalness: 0,
    });
    materialByColor.set(key, material);
    materials.push(material);
    return material;
  };

  const attach = (
    geometry: BufferGeometry,
    color: Color,
    driveBone: Object3D,
    world: Matrix4,
    name?: string,
  ) => {
    const mesh = new Mesh(geometry, materialFor(color));
    if (name) mesh.name = name;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    // Preserve the exact bone-local matrix (bone chains can carry scale).
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(driveBone.matrixWorld).invert().multiply(world);
    mesh.matrixWorldNeedsUpdate = true;
    driveBone.add(mesh);
    geometries.push(geometry);
  };

  /** Tapered segment spanning bone `a` → bone `b`, riding on `drive`. */
  const segment = (
    a: Object3D | null,
    b: Object3D | null,
    drive: Object3D | null,
    radiusA: number,
    radiusB: number,
    color: Color,
  ) => {
    if (!a || !b || !drive) return;
    const pA = posOf(a);
    const pB = posOf(b);
    const length = pA.distanceTo(pB);
    if (length < 1e-4) return;
    const dir = pB.clone().sub(pA).normalize();
    // Cylinder axis is +Y; radiusTop is the +Y (dir/b) end.
    const geometry = new CylinderGeometry(radiusB, radiusA, length, 12, 1);
    const quat = new Quaternion().setFromUnitVectors(UP_Y, dir);
    const center = pA.clone().add(pB).multiplyScalar(0.5);
    attach(geometry, color, drive, new Matrix4().compose(center, quat, UNIT_SCALE));
  };

  const outfit = appearance.outfit;
  const isDress = outfit === 'dress';
  const collarShade = colors.clothing.clone().multiplyScalar(0.82);
  const crewneckShade = colors.clothing.clone().multiplyScalar(0.9);
  const beltShade = colors.accent.clone().multiplyScalar(0.7);

  // ── Torso shell (all outfits) — oval cylinder covering the bodysuit torso.
  const torsoBottom = pPelvis.clone();
  const torsoCenter = pTop.clone().add(torsoBottom).multiplyScalar(0.5);
  const torsoLen = pTop.distanceTo(torsoBottom) * 1.04;
  let widthR = shoulderW * 0.33;
  let depthR = shoulderW * 0.23;
  if (outfit === 'sweater') {
    widthR *= 1.08;
    depthR *= 1.22;
  } else if (outfit === 'shirt') {
    widthR *= 0.98;
    depthR *= 0.92;
  } else if (isDress) {
    widthR *= 0.95;
    depthR *= 0.9;
  }
  {
    const geometry = new CylinderGeometry(widthR, widthR, torsoLen, 16, 1);
    geometry.scale(1, 1, depthR / widthR); // flatten front-to-back into an oval
    attach(geometry, colors.clothing, spine2, basis(torsoCenter), 'garmentTorso');
  }

  // ── Sleeves (all outfits) — upper + fore arm on both sides.
  const lowerArmL = bone('lowerarm_l');
  const lowerArmR = bone('lowerarm_r');
  const handL = bone('hand_l');
  const handR = bone('hand_r');
  segment(upperArmL, lowerArmL, upperArmL, shoulderW * 0.115, shoulderW * 0.094, colors.clothing);
  segment(upperArmR, lowerArmR, upperArmR, shoulderW * 0.115, shoulderW * 0.094, colors.clothing);
  segment(lowerArmL, handL, lowerArmL, shoulderW * 0.09, shoulderW * 0.07, colors.clothing);
  segment(lowerArmR, handR, lowerArmR, shoulderW * 0.09, shoulderW * 0.07, colors.clothing);

  // Small always-on role badge: a rounded, matte chest cue whose color comes
  // from the art-bible role family. It never inherits or encodes skin tone.
  {
    const badge = new CylinderGeometry(shoulderW * 0.11, shoulderW * 0.11, shoulderW * 0.025, 16);
    badge.rotateX(Math.PI / 2);
    badge.scale(1.2, 0.72, 1);
    const badgePos = pTop
      .clone()
      .lerp(torsoCenter, 0.46)
      .add(forward.clone().multiplyScalar(depthR * 1.07))
      .add(right.clone().multiplyScalar(shoulderW * 0.16));
    attach(badge, new Color(roleBadgeColor), spine3, basis(badgePos), 'roleBadge');
  }

  // ── Neckline / front detail (outfit-specific).
  if (outfit === 'blazer' || outfit === 'shirt') {
    // Collar band ringing the neck base.
    const collar = new CylinderGeometry(
      widthR * 0.52,
      widthR * 0.46,
      shoulderW * 0.07,
      14,
      1,
      true,
    );
    collar.scale(1, 1, depthR / widthR);
    attach(collar, collarShade, spine3, basis(pTop.clone()));
  }
  if (outfit === 'blazer') {
    // Two lapels splayed into a V on the upper chest.
    const chest = pTop.clone().lerp(torsoCenter, 0.4);
    for (const side of [1, -1] as const) {
      const w = shoulderW * 0.1;
      const h = torsoLen * 0.46;
      const d = shoulderW * 0.035;
      const geometry = new BoxGeometry(w, h, d);
      geometry.rotateZ(side * 0.3);
      const pos = chest
        .clone()
        .add(forward.clone().multiplyScalar(depthR * 0.95))
        .add(right.clone().multiplyScalar(side * shoulderW * 0.07))
        .add(up.clone().multiplyScalar(-h * 0.15));
      attach(
        geometry,
        colors.accent,
        spine3,
        basis(pos),
        side > 0 ? 'blazerLapelLeft' : 'blazerLapelRight',
      );
    }
  }
  if (outfit === 'shirt') {
    // Button placket down the center front.
    const geometry = new BoxGeometry(shoulderW * 0.04, torsoLen * 0.7, shoulderW * 0.02);
    const pos = torsoCenter.clone().add(forward.clone().multiplyScalar(depthR * 0.98));
    attach(geometry, colors.accent, spine2, basis(pos), 'shirtPlacket');
  }
  if (outfit === 'sweater') {
    // Crewneck ring.
    const geometry = new CylinderGeometry(
      widthR * 0.5,
      widthR * 0.5,
      shoulderW * 0.06,
      16,
      1,
      true,
    );
    geometry.scale(1, 1, depthR / widthR);
    attach(geometry, crewneckShade, spine3, basis(pTop.clone()), 'sweaterCrewneck');
  }
  if (outfit === 'blazer' || outfit === 'shirt') {
    // Waist belt just above the pelvis.
    const beltPos = pPelvis.clone().add(up.clone().multiplyScalar(shoulderW * 0.05));
    const geometry = new CylinderGeometry(
      widthR * 0.98,
      widthR * 0.98,
      shoulderW * 0.05,
      16,
      1,
      true,
    );
    geometry.scale(1, 1, (depthR / widthR) * 1.02);
    attach(geometry, beltShade, spine2, basis(beltPos));
  }

  // ── Lower body: skirt (dress) OR trousers (everything else).
  const thighL = bone('thigh_l');
  const thighR = bone('thigh_r');
  const calfL = bone('calf_l');
  const calfR = bone('calf_r');
  if (isDress) {
    const kneeL = calfL ? posOf(calfL) : null;
    const kneeR = calfR ? posOf(calfR) : null;
    const kneeMid =
      kneeL && kneeR
        ? kneeL.clone().add(kneeR).multiplyScalar(0.5)
        : pPelvis.clone().add(up.clone().multiplyScalar(-shoulderW * 0.95));
    const skirtTop = pPelvis.clone().add(up.clone().multiplyScalar(shoulderW * 0.03));
    const skirtCenter = skirtTop.clone().add(kneeMid).multiplyScalar(0.5);
    const skirtLen = skirtTop.distanceTo(kneeMid);
    const hipW = thighL && thighR ? posOf(thighL).distanceTo(posOf(thighR)) : shoulderW * 0.5;
    const waistR = widthR * 0.82;
    const hemR = hipW * 0.6 + widthR * 0.55;
    const geometry = new CylinderGeometry(waistR, hemR, skirtLen, 18, 1, true);
    geometry.scale(1, 1, depthR / widthR);
    attach(geometry, colors.clothing, pelvis, basis(skirtCenter), 'dressSkirt');
  } else {
    const legHipR = shoulderW * 0.13;
    const legKneeR = shoulderW * 0.1;
    const legAnkleR = shoulderW * 0.078;
    const footR = bone('foot_r');
    segment(thighL, calfL, thighL, legHipR, legKneeR, colors.bottom);
    segment(thighR, calfR, thighR, legHipR, legKneeR, colors.bottom);
    segment(calfL, footL, calfL, legKneeR * 0.98, legAnkleR, colors.bottom);
    segment(calfR, footR, calfR, legKneeR * 0.98, legAnkleR, colors.bottom);
  }

  return result;
}
