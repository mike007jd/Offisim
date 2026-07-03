import { avataaars } from '@dicebear/collection';
import { createAvatar } from '@dicebear/core';

/**
 * Offisim employee avatars — DiceBear `avataaars` rendered from an employee seed,
 * with optional appearance overrides. Mirrors the legacy avatar-seed logic: a
 * stable seed picks skin / hair / outfit from curated palettes, and an explicit
 * appearance (set in Personnel) overrides those choices.
 */

export type BodyType = 'slim' | 'normal' | 'stocky';
export type Gender = 'masculine' | 'feminine' | 'neutral';
type AccentVariant = 'vest' | 'jacket' | 'scarf';
/** Procedural office-garment set driving the 3D character's overlay clothing. */
export type Outfit = 'blazer' | 'shirt' | 'sweater' | 'dress';

export interface EmployeeAppearance {
  hairStyle?: HairStyle;
  /** Colors are `#rrggbb`/`rrggbb` strings (adapters normalize legacy packed
   *  ints at the data boundary; the helpers below stay tolerant at runtime). */
  skinColor?: string;
  hairColor?: string;
  clothingColor?: string;
  accentColor?: string;
  accentVariant?: AccentVariant;
  bodyType?: BodyType;
  gender?: Gender;
  outfit?: Outfit;
}

export type HairStyle =
  | 'short'
  | 'long'
  | 'ponytail'
  | 'curly'
  | 'bald'
  | 'bob'
  | 'spiky'
  | 'braids';

const HAIR_STYLE_TO_TOP = {
  short: 'shortFlat',
  long: 'straight01',
  ponytail: 'bun',
  curly: 'shortCurly',
  bald: 'shortFlat',
  bob: 'bob',
  spiky: 'frizzle',
  braids: 'fro',
} as const satisfies Record<HairStyle, string>;

const OUTFIT_COLORS = [
  '2f6bff',
  '7c4ddb',
  '1aa46a',
  'c98410',
  'd6453d',
  '3c4a60',
  '0f7a4d',
  '5b2fb0',
  '1f54d8',
  '8a5a0c',
];
const SKIN_TONES = ['f8d9c4', 'edb98a', 'd08b5b', 'ae5d29', '614335', 'fd9841'];
const HAIR_COLORS = [
  '2c1b18',
  '4a312c',
  '724133',
  'a55728',
  'b58143',
  'd6b370',
  'e8e1e1',
  '724133',
];
const TOP_CYCLE = [
  'shortFlat',
  'shortCurly',
  'straight01',
  'bob',
  'bun',
  'frizzle',
  'fro',
  'shortWaved',
] as const;

/**
 * Knuth multiplicative hash — THE deterministic string hash for appearance
 * identity (palette picks here, the 3D character's neutral-gender body pick).
 * Stable across sessions/locales: pure charCode arithmetic, uint32 output.
 */
export function hashString(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 2654435761 + seed.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Knuth hash → stable index into a palette. */
function paletteIndex(seed: string, length: number): number {
  return hashString(seed) % length;
}

function pick<T extends string>(seed: string, palette: readonly T[], salt: string): T {
  return palette[paletteIndex(`${seed}:${salt}`, palette.length)] ?? (palette[0] as T);
}

/** Normalize a stored color (string `#rrggbb`/`rrggbb`, or a legacy packed
 *  int like 9262372) to bare `rrggbb` hex. */
function toHexColor(value: string | number): string {
  if (typeof value === 'number') {
    return Math.max(0, Math.min(0xffffff, Math.trunc(value)))
      .toString(16)
      .padStart(6, '0');
  }
  return value.replace(/^#/, '');
}

const HAIR_STYLES: readonly HairStyle[] = [
  'short',
  'long',
  'ponytail',
  'curly',
  'bob',
  'spiky',
  'braids',
];
const BODY_TYPES: readonly BodyType[] = ['slim', 'normal', 'stocky'];
const GENDERS: readonly Gender[] = ['masculine', 'feminine', 'neutral'];
const ACCENT_VARIANTS: readonly AccentVariant[] = ['vest', 'jacket', 'scarf'];
const OUTFITS: readonly Outfit[] = ['blazer', 'shirt', 'sweater', 'dress'];

export interface ResolvedAppearance {
  skin: string;
  hair: string;
  clothing: string;
  accent: string;
  hairStyle: HairStyle;
  bodyType: BodyType;
  gender: Gender;
  accentVariant: AccentVariant;
  outfit: Outfit;
}

/** Resolve concrete colors + body params for an employee — shared by the DiceBear
 *  avatar and the 3D block character so both read identically. Returns `#rrggbb`. */
export function resolveAppearance(
  seed: string,
  appearance?: EmployeeAppearance,
): ResolvedAppearance {
  const withHash = (hex: string | number) => `#${toHexColor(hex)}`;
  const clothing = withHash(appearance?.clothingColor ?? pick(seed, OUTFIT_COLORS, 'outfit'));
  let accent = withHash(appearance?.accentColor ?? pick(seed, OUTFIT_COLORS, 'accent'));
  if (accent.toLowerCase() === clothing.toLowerCase()) {
    const next = OUTFIT_COLORS[(OUTFIT_COLORS.indexOf(accent.slice(1)) + 3) % OUTFIT_COLORS.length];
    accent = withHash(next ?? '2f6bff');
  }
  return {
    skin: withHash(appearance?.skinColor ?? pick(seed, SKIN_TONES, 'skin')),
    hair: withHash(appearance?.hairColor ?? pick(seed, HAIR_COLORS, 'hair')),
    clothing,
    accent,
    hairStyle: oneOf(appearance?.hairStyle, HAIR_STYLES, seed, 'hairstyle'),
    bodyType: oneOf(appearance?.bodyType, BODY_TYPES, seed, 'body'),
    gender: oneOf(appearance?.gender, GENDERS, seed, 'gender'),
    accentVariant: oneOf(appearance?.accentVariant, ACCENT_VARIANTS, seed, 'accentvar'),
    outfit: oneOf(appearance?.outfit, OUTFITS, seed, 'outfitstyle'),
  };
}

/** Return `value` when it is a member of the enum `set`, else a stable seed pick.
 *  Guards against an out-of-set value from untyped persona_json (e.g. an imported
 *  bodyType "average") reaching a lookup table and producing NaN / a dropped
 *  garment — the resolver always yields a valid ResolvedAppearance enum. */
function oneOf<T extends string>(
  value: T | undefined,
  set: readonly T[],
  seed: string,
  salt: string,
): T {
  return value !== undefined && set.includes(value) ? value : pick(seed, set, salt);
}

const cache = new Map<string, string>();
const CACHE_MAX_ENTRIES = 256;

export function employeeAvatarUri(seed: string, appearance?: EmployeeAppearance): string {
  const key = `${seed}|${appearance ? JSON.stringify(appearance) : ''}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const hairStyle = appearance?.hairStyle;
  const top = hairStyle ? HAIR_STYLE_TO_TOP[hairStyle] : pick(seed, TOP_CYCLE, 'top');
  const isBald = hairStyle === 'bald';

  const uri = createAvatar(avataaars, {
    seed,
    radius: 0,
    backgroundColor: ['transparent'],
    skinColor: [toHexColor(appearance?.skinColor ?? pick(seed, SKIN_TONES, 'skin'))],
    hairColor: [toHexColor(appearance?.hairColor ?? pick(seed, HAIR_COLORS, 'hair'))],
    clothesColor: [toHexColor(appearance?.clothingColor ?? pick(seed, OUTFIT_COLORS, 'outfit'))],
    top: [top],
    // Friendly expressions only — DiceBear still samples per-seed within these
    // sets, so the same seed keeps the same face. Without this constraint the
    // full avataaars pool includes concerned/sad/screamOpen/angry variants.
    eyebrows: ['default', 'defaultNatural', 'raisedExcited'],
    eyes: ['default', 'happy', 'wink'],
    mouth: ['default', 'smile', 'twinkle'],
    ...(isBald ? { topProbability: 0 } : {}),
  }).toDataUri();

  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, uri);
  return uri;
}
