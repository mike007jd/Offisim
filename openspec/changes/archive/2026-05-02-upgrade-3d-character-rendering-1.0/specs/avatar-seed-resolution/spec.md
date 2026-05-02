## MODIFIED Requirements

### Requirement: Color arrays are single source of truth

`OUTFIT_COLORS`, `SKIN_TONES`, and `HAIR_COLORS_SEED_PALETTE` arrays SHALL each be defined in exactly one module (`packages/ui-office/src/lib/avatar-seed.ts`) and imported by consumers. The minimum cardinalities SHALL be:

- `OUTFIT_COLORS` SHALL have at least 16 entries
- `SKIN_TONES` SHALL have at least 18 entries
- `HAIR_COLORS_SEED_PALETTE` SHALL have at least 8 entries

REPLACES the prior cardinality-implicit requirement (which assumed 8 outfit / 7 skin / no hair palette).

#### Scenario: No duplicate color definitions
- **WHEN** searching codebase for OUTFIT_COLORS, SKIN_TONES, or HAIR_COLORS_SEED_PALETTE definitions
- **THEN** exactly one declaration of each exists, located in `packages/ui-office/src/lib/avatar-seed.ts`

#### Scenario: OUTFIT_COLORS has at least 16 entries
- **WHEN** auditing the `OUTFIT_PALETTE` tuple in `avatar-seed.ts`
- **THEN** the tuple length is at least 16
- **AND** `OUTFIT_COLORS.length === OUTFIT_PALETTE.length`

#### Scenario: SKIN_TONES has at least 18 entries
- **WHEN** auditing the `SKIN_TONES` const in `avatar-seed.ts`
- **THEN** the array length is at least 18
- **AND** the entries span perceptual lightness from very-light (`#fce7f3` or paler) to deep (perceptual `L*` ≤ 25 or equivalent)

#### Scenario: HAIR_COLORS_SEED_PALETTE has at least 8 entries
- **WHEN** auditing the `HAIR_COLORS_SEED_PALETTE` const in `avatar-seed.ts`
- **THEN** the array length is at least 8
- **AND** the first 6 entries are byte-equal to the 6 hex values of `AvatarCustomizer.tsx`'s `HAIR_COLORS` manual palette so 2D ↔ 3D byte-equality holds when seed-derived hair color is consumed

## ADDED Requirements

### Requirement: Hash distribution avoids modulo clustering on small populations

`avatar-seed.ts` SHALL NOT use `hashSeed(seed) % paletteLength` as the palette index. It SHALL multiply by the Knuth multiplicative-hash constant `KNUTH_PRIME = 2654435761` before modulo:

```ts
function paletteIndex(seed: string, paletteLength: number): number {
  return Math.abs((hashSeed(seed) * KNUTH_PRIME) >>> 0) % paletteLength;
}
```

The `paletteIndex` helper SHALL be the only path used by `outfitColorFromSeed`, `skinToneFromSeed`, and `hairColorFromSeed` for palette lookup. Direct `hashSeed % palette.length` calls in these helpers SHALL be removed.

The hash SHALL be tested empirically against the worst-case-clustering input pattern (sequential names `Employee 1` ... `Employee N`): at N = palette length, no two adjacent palette buckets SHALL each receive >2 sequential employees; at N = 100 against an 18-entry palette, no single bucket SHALL receive more than 8 employees.

#### Scenario: Knuth-prime multiplier present
- **WHEN** auditing `avatar-seed.ts` for the constant `2654435761` or named export `KNUTH_PRIME`
- **THEN** the constant exists and is used by the `paletteIndex` (or equivalent) helper

#### Scenario: paletteIndex consumed by all three from-seed helpers
- **WHEN** auditing `outfitColorFromSeed`, `skinToneFromSeed`, `hairColorFromSeed`
- **THEN** each of them calls `paletteIndex` (or directly performs the prime-multiply-then-modulo) for palette index lookup
- **AND** none of them performs a bare `hashSeed(seed) % palette.length`

#### Scenario: Sequential seeds distribute evenly
- **WHEN** computing `paletteIndex` for seeds `'Employee 1'` through `'Employee 16'` against a 16-entry `OUTFIT_COLORS`
- **THEN** the resulting bucket indices contain at most 2 collisions (≥14 distinct buckets out of 16)

### Requirement: `resolveHairColor` mirrors outfit and skin resolvers

`packages/ui-office/src/lib/avatar-seed.ts` SHALL export a `resolveHairColor(seed: string, appearance?: EmployeeAppearance | null): string` helper. When `appearance` is provided and `appearance.hairColor` is a number, the helper SHALL return `numericToHex(appearance.hairColor)`. Otherwise the helper SHALL return `hairColorFromSeed(seed)`.

`hairColorFromSeed(seed: string): string` SHALL apply the prefix `'hair:'` to the seed before hashing (mirroring `skinToneFromSeed`'s `'skin:'` prefix) so the hair-color hash bucket is independent from the skin and outfit hash buckets.

`resolveHairColor` SHALL be the only path 3D rendering consumes for hair color — direct `'#1a1a1a'` literal or other hardcoded fallbacks SHALL be removed from `office3d-brand-variants.tsx::DefaultBlockBody` and from any `<BlockCharacter>` consumer.

#### Scenario: Helper signature
- **WHEN** importing `resolveHairColor` from `avatar-seed.ts`
- **THEN** the function signature is `(seed: string, appearance?: EmployeeAppearance | null) => string`

#### Scenario: appearance.hairColor wins over seed
- **WHEN** an employee has `appearance.hairColor === 0xb03020` (red)
- **THEN** `resolveHairColor(seed, appearance)` returns `'#b03020'`

#### Scenario: appearance absent falls back to seed-derived hair color
- **WHEN** appearance is undefined and the seed is `'Alex Chen'`
- **THEN** `resolveHairColor('Alex Chen', undefined)` returns `hairColorFromSeed('Alex Chen')`

#### Scenario: Seed prefix isolates hair bucket from skin/outfit
- **WHEN** computing `hairColorFromSeed('Alex Chen')` and `outfitColorFromSeed('Alex Chen')`
- **THEN** the two helpers internally hash `'hair:Alex Chen'` and `'Alex Chen'` (or `outfitColorFromSeed`'s no-prefix path) respectively, producing independent palette indices

#### Scenario: 3D consumes resolveHairColor exclusively
- **WHEN** auditing `office3d-brand-variants.tsx::DefaultBlockBody` and `character-mesh-builder.ts::BlockCharacter`
- **THEN** neither file contains a hardcoded `'#1a1a1a'` (or any other hex literal) for hair material color
- **AND** every hair `meshStandardMaterial.color` ultimately derives from `resolveHairColor(seed, appearance)`

### Requirement: `resolveAccentColor` provides clothingAccent fallback

`packages/ui-office/src/lib/avatar-seed.ts` SHALL export a `resolveAccentColor(seed: string, appearance?: EmployeeAppearance | null): string` helper. When `appearance.clothingAccent` is a number, the helper SHALL return `numericToHex(appearance.clothingAccent)`. Otherwise the helper SHALL return `outfitColorFromSeed('accent:' + seed)` so the seed-derived accent uses an independent hash bucket from the seed-derived outfit (giving unedited employees a deliberate non-matching accent that is visible).

This helper SHALL be the only path 3D rendering consumes for accent color — direct hex literals SHALL be removed.

#### Scenario: Helper signature
- **WHEN** importing `resolveAccentColor` from `avatar-seed.ts`
- **THEN** the function signature is `(seed: string, appearance?: EmployeeAppearance | null) => string`

#### Scenario: appearance.clothingAccent wins over seed
- **WHEN** an employee has `appearance.clothingAccent === 0xec4899` (pink)
- **THEN** `resolveAccentColor(seed, appearance)` returns `'#ec4899'`

#### Scenario: appearance absent falls back to seeded independent bucket
- **WHEN** appearance is undefined and the seed is `'Alex Chen'`
- **THEN** `resolveAccentColor('Alex Chen', undefined)` equals `outfitColorFromSeed('accent:Alex Chen')`
- **AND** the result is not always equal to `outfitColorFromSeed('Alex Chen')` (different bucket)

### Requirement: hairStyle enum mapping unchanged but documented

The `HAIR_STYLE_TO_AVATAARS_TOP` table (existing) SHALL remain the 2D ↔ 3D hair *style* bridge. The 3D figure's hair geometry per style is defined by the `character-3d-rendering` capability; the 2D DiceBear `top` token per style is defined here. Style is an enum bridge (different rendering primitives may produce different visual representations of the same conceptual style); style is NOT subject to the byte-equality contract that color fields obey.

#### Scenario: Mapping table covers all 8 styles
- **WHEN** auditing `HAIR_STYLE_TO_AVATAARS_TOP`
- **THEN** the table contains entries for `short`, `long`, `ponytail`, `curly`, `bald`, `bob`, `spiky`, `braids` (all 8 enum values)

#### Scenario: 2D and 3D produce thematically matching but not byte-equal hair
- **WHEN** an employee has `appearance.hairStyle === 'braids'`
- **THEN** the 2D DiceBear avatar uses the `top: 'fro'` token (from current `HAIR_STYLE_TO_AVATAARS_TOP`)
- **AND** the 3D figure renders the cap-plus-2-cylinder braids composition (per `character-3d-rendering`)
- **AND** the two visualizations are recognizably the same conceptual style despite differing geometry
