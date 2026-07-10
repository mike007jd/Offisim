import type { BodyType, HairStyle, HeadShape } from '@/lib/avatar.js';
import contractJson from '@/lib/toy-character-contract.json';
import type { Expression, Prop, RoleSlug } from '@offisim/shared-types';

type HairAsset = `hair_0${1 | 2 | 3 | 4 | 5 | 6}`;
export type EyeStyle = 'neutral' | 'happy' | 'worried' | 'focus';
export type AccessoryKind =
  | 'laptop'
  | 'clipboard'
  | 'tablet'
  | 'terminal'
  | 'pointer'
  | 'headset'
  | 'swatch'
  | 'checklist'
  | 'keycard';
export type RoleFamily =
  | 'engineering'
  | 'design'
  | 'product'
  | 'qa'
  | 'research'
  | 'operations'
  | 'identity'
  | 'unknown';

interface Vec3Spec {
  readonly position: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
}

interface AttachSpec {
  readonly node: string;
  readonly bone: string;
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
}

const contract = contractJson as unknown as {
  readonly bodyTypeGirth: Record<BodyType, number>;
  readonly headShapeScale: Record<HeadShape, readonly [number, number, number]>;
  readonly hairStyleToAsset: Record<HairStyle, HairAsset | null>;
  readonly hairTransforms: Record<HairAsset, Vec3Spec>;
  readonly eye: {
    readonly expressionMap: Record<Expression, EyeStyle>;
    readonly blinkMinSeconds: number;
    readonly blinkMaxSeconds: number;
    readonly blinkDurationSeconds: number;
    readonly planeZ: number;
  };
  readonly performancePropAsset: Record<Prop, AccessoryKind>;
  readonly propAttach: Record<AccessoryKind, AttachSpec>;
  readonly roleFamilies: Record<
    RoleFamily,
    { readonly color: string; readonly accessory: AccessoryKind }
  >;
  readonly roleFamilyBySlug: Record<RoleSlug, RoleFamily>;
};

export const BODY_TYPE_GIRTH = contract.bodyTypeGirth;
export const HEAD_SHAPE_SCALE = contract.headShapeScale;
export const HAIR_STYLE_TO_ASSET = contract.hairStyleToAsset;
export const HAIR_TRANSFORMS = contract.hairTransforms;
export const PERFORMANCE_PROP_ASSET = contract.performancePropAsset;
export const PROP_ATTACH = contract.propAttach;
export const EYE_SPEC = contract.eye;

export function accessoryForPerformance(
  prop: Prop | undefined,
  roleAccessory: AccessoryKind,
  useRoleDefault: boolean,
): AccessoryKind | null {
  return prop ? PERFORMANCE_PROP_ASSET[prop] : useRoleDefault ? roleAccessory : null;
}

export function eyeStyleForExpression(expression: Expression): EyeStyle {
  return contract.eye.expressionMap[expression];
}

function fraction(value: number): number {
  return value - Math.floor(value);
}

function seededUnit(phase: number, salt: number): number {
  return fraction(Math.sin((phase + salt) * 12.9898) * 43_758.5453);
}

export interface BlinkSchedule {
  readonly gapA: number;
  readonly gapB: number;
  readonly cycle: number;
  readonly offset: number;
  readonly duration: number;
}

/**
 * Deterministic two-gap blink schedule. Both alternating gaps are independently
 * seeded inside [2, 6] seconds, so employees stay desynchronised without a
 * per-frame random source. Identity never enters this calculation; callers pass
 * the animation-only phase already used by the clip mixer.
 */
export function blinkScheduleForPhase(phase: number): BlinkSchedule {
  const span = contract.eye.blinkMaxSeconds - contract.eye.blinkMinSeconds;
  const gapA = contract.eye.blinkMinSeconds + seededUnit(phase, 1.17) * span;
  const gapB = contract.eye.blinkMinSeconds + seededUnit(phase, 8.41) * span;
  const cycle = gapA + gapB;
  const offset = seededUnit(phase, 4.73) * cycle;
  return { gapA, gapB, cycle, offset, duration: contract.eye.blinkDurationSeconds };
}

export function isBlinking(
  elapsedSeconds: number,
  schedule: BlinkSchedule,
  reducedMotion: boolean,
): boolean {
  if (reducedMotion) return false;
  const local =
    (((elapsedSeconds + schedule.offset) % schedule.cycle) + schedule.cycle) % schedule.cycle;
  return (
    local < schedule.duration ||
    (local >= schedule.gapA && local < schedule.gapA + schedule.duration)
  );
}

function normalizeRole(role: string | undefined): string {
  return (role ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function roleFamilyFor(role: string | undefined): RoleFamily {
  const slug = normalizeRole(role);
  const exact = contract.roleFamilyBySlug[slug as RoleSlug];
  if (exact) return exact;
  if (/design|artist|creative|visual|(^|_)(ux|ui)(_|$)/.test(slug)) return 'design';
  if (/quality|test|(^|_)qa(_|$)/.test(slug)) return 'qa';
  if (/research|analyst|seo|insight/.test(slug)) return 'research';
  if (/devops|operation|support|infrastructure/.test(slug)) return 'operations';
  if (/engineer|developer|backend|frontend|fullstack|(^|_)dev(_|$)/.test(slug)) {
    return 'engineering';
  }
  if (/product|project|manager|writer|boss|(^|_)pm(_|$)/.test(slug)) return 'product';
  return 'unknown';
}

export function rolePresentationFor(role: string | undefined): {
  readonly family: RoleFamily;
  readonly color: string;
  readonly accessory: AccessoryKind;
} {
  const family = roleFamilyFor(role);
  return { family, ...contract.roleFamilies[family] };
}
