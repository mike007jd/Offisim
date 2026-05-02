# avatar-seed-resolution

## Purpose

Employee avatars (both 2D DiceBear heads and 3D block-figure outfits) derive from a single source of truth — `resolveAvatarSeed(employee)` in `packages/ui-office/src/lib/avatar-seed.ts`. That seed also drives `OUTFIT_COLORS` / `SKIN_TONES` lookups, so the same employee always renders consistently across surfaces.
## Requirements
### Requirement: Deterministic avatar seed resolution
`resolveAvatarSeed` SHALL return `persona_json.avatarSeed` when present, otherwise fall back to employee `name`.

#### Scenario: Employee with avatarSeed
- **WHEN** an employee has `persona_json` containing `"avatarSeed": "atlas"`
- **THEN** `resolveAvatarSeed` returns `"atlas"`

#### Scenario: Employee without avatarSeed
- **WHEN** an employee has no `avatarSeed` in persona_json (or no persona_json)
- **THEN** `resolveAvatarSeed` returns the employee's `name`

### Requirement: 3D outfit color derived from seed

3D employee rendering SHALL derive outfit color via `resolveOutfitColor(employee, appearance)`. When `appearance.clothingColor` is set on the employee, that color wins; otherwise the result equals `hashSeed(resolveAvatarSeed(employee)) % OUTFIT_COLORS.length`.

#### Scenario: Same employee always gets same 3D color (seed fallback path)
- **WHEN** employee "Alex Chen" with no `appearance` saved is rendered in 3D
- **THEN** outfit color is always the same regardless of employee list order

#### Scenario: Saved appearance.clothingColor wins over seed in 3D
- **WHEN** employee "Alex Chen" has `appearance.clothingColor === 0xef4444` saved
- **THEN** the 3D `LowPolyCharacter` body mesh's `meshStandardMaterial.color` equals `#ef4444`
- **AND** the value does NOT depend on the seed

### Requirement: 2D avatar seed matches 3D seed source

2D employee rendering SHALL use `resolveAvatarSeed(employee)` as the DiceBear seed even when `appearance` is provided. The seed continues to drive any DiceBear axis we don't explicitly override (e.g. eye shape, mouth, accessories) so the same employee remains visually consistent across the parts that aren't user-customized.

#### Scenario: Seed consistency across views with appearance
- **WHEN** employee "Alex Chen" with saved `appearance` is rendered in both 2D and 3D
- **THEN** both views use the same resolved seed for the non-customized parts of the avatar (DiceBear's deterministic non-overridden axes in 2D, ring / pose seed in 3D)

#### Scenario: createOffisimAvatar accepts optional appearance
- **WHEN** auditing the `createOffisimAvatar` export signature in `avatar-seed.ts`
- **THEN** the signature is `createOffisimAvatar(seed: string, size: number, appearance?: AvatarAppearance): string`
- **AND** when `appearance` is omitted, the generated SVG is byte-equivalent to the previous (seed-only) implementation

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

### Requirement: 2D DiceBear outfit color aligns with 3D seed-derived color

When a 2D avatar is rendered via DiceBear (`@dicebear/core` + `@dicebear/avataaars` style) for an internal employee, the DiceBear `clothesColor` option SHALL be set to a single-element array containing `resolveOutfitColor(employee, appearance).slice(1)` (hex without leading `#`). When the employee has no `appearance.clothingColor`, this falls back to `outfitColorFromSeed(resolveAvatarSeed(employee))`, preserving the byte-equivalence between 2D shirt and 3D body for legacy employees.

#### Scenario: Same employee renders matching outfit color across 2D and 3D (legacy / seed fallback path)
- **WHEN** employee "Alex Chen" with no saved `appearance` is rendered in both the 2D DiceBear chat avatar and the 3D office scene
- **THEN** the DiceBear shirt fill color and the 3D body mesh color are byte-equal (both seed-derived)

#### Scenario: Same employee renders matching outfit color across 2D and 3D (appearance path)
- **WHEN** employee "Alex Chen" has `appearance.clothingColor === 0xef4444` saved
- **THEN** the DiceBear shirt fill color equals `#ef4444`
- **AND** the 3D body mesh color equals `#ef4444`

#### Scenario: Avatar cache reuses same SVG per appearance fingerprint
- **WHEN** the same employee with the same appearance bytes is requested twice from `getAvatarUri(seed, companyId, appearance?)` in `office-2d-avatar-cache.ts`
- **THEN** the cache returns the identical data URI on the second call (cache hit)
- **AND** the cache key SHALL include both the seed and a deterministic fingerprint of the consumed appearance fields (skinColor, hairColor, clothingColor, hairStyle), so changing any of those fields invalidates exactly that one entry

### Requirement: Manual-config palette survives alongside seed-derived palette

The `AvatarCustomizer` UI's clothing swatches SHALL source their color values from `OUTFIT_COLORS_NUMERIC` (derived from `OUTFIT_COLORS` in `avatar-seed.ts`), keeping the manual-config palette in sync with the seed-derived palette. Independent manual-only palettes (`SKIN_COLORS`, `HAIR_COLORS` in `AvatarCustomizer.tsx`) MAY remain distinct from seed-derived palettes (`SKIN_TONES` in `avatar-seed.ts`), but SHALL be documented as such. The `Clothing accent` swatch row SHALL remain in the customizer in this change but SHALL NOT be consumed by 2D or 3D renderers; its UI copy SHALL note the trim is applied in a future art pass.

#### Scenario: Customizer clothing swatches match seed-derived palette
- **WHEN** a user opens the `AvatarCustomizer` UI to pick a clothing color
- **THEN** the 8 swatches shown correspond exactly (hex-for-hex) to the 8 colors in `OUTFIT_COLORS`

#### Scenario: Manual skin/hair palettes are allowed to be independent
- **WHEN** a developer searches for `SKIN_COLORS` or `HAIR_COLORS` in the codebase
- **THEN** they find them declared in `AvatarCustomizer.tsx` with a comment noting they are manual-config palettes independent from seed-derived `SKIN_TONES`

#### Scenario: Clothing accent row carries deferred-art note
- **WHEN** auditing `AvatarCustomizer.tsx`
- **THEN** the `Clothing accent` `SwatchRow` is followed by inline copy informing the user the trim color is applied in an upcoming art pass and is currently saved but not visualised

### Requirement: Appearance fields resolve via dedicated helpers with seed fallback

`packages/ui-office/src/lib/avatar-seed.ts` SHALL export `resolveOutfitColor(employee, appearance?)` and `resolveSkinTone(employee, appearance?)` helpers. When `appearance` is provided and the corresponding field is non-null, the helper SHALL return the appearance value (formatted as a `#RRGGBB` hex string from the stored numeric color). Otherwise the helper SHALL return the seed-derived value (`outfitColorFromSeed` / `skinToneFromSeed` of `resolveAvatarSeed(employee)`).

#### Scenario: Appearance present wins over seed
- **WHEN** an employee has `persona_json.appearance.clothingColor === 0xef4444` and seed `"Alex Chen"` (whose seed-derived outfit is `#3b82f6`)
- **THEN** `resolveOutfitColor(employee, appearance)` returns `"#ef4444"`

#### Scenario: Appearance absent falls back to seed-derived color
- **WHEN** an employee has no `appearance` key in `persona_json` and seed `"Alex Chen"`
- **THEN** `resolveOutfitColor(employee, undefined)` returns the same value as `outfitColorFromSeed("Alex Chen")`

#### Scenario: Skin tone resolver mirrors the same fallback rule
- **WHEN** `resolveSkinTone(employee, appearance)` is called with `appearance.skinColor === 0xfdbcb4`
- **THEN** the helper returns `"#fdbcb4"`
- **WHEN** called with `appearance` undefined
- **THEN** the helper returns `skinToneFromSeed(resolveAvatarSeed(employee))`

### Requirement: hairStyle enum maps to avataaars top token

`avatar-seed.ts` SHALL export a `HAIR_STYLE_TO_AVATAARS_TOP` table mapping each Offisim `hairStyle` value to a `@dicebear/avataaars` v9 `top` enum token. The mapping SHALL cover all 8 Offisim values. Because v9 has no `noHair` token, the `bald` row SHALL pair its mapped token with `topProbability: 0` at config-build time so the figure renders bald.

#### Scenario: Canonical mapping table is present
- **WHEN** `HAIR_STYLE_TO_AVATAARS_TOP['short']` is read
- **THEN** the value is `'shortFlat'`
- **WHEN** `HAIR_STYLE_TO_AVATAARS_TOP['bob']` is read
- **THEN** the value is `'bob'`
- **WHEN** `HAIR_STYLE_TO_AVATAARS_TOP['ponytail']` is read
- **THEN** the value is `'bun'`

#### Scenario: Bald uses topProbability=0 in builder
- **WHEN** `createOffisimAvatar(seed, size, appearance)` is called with `appearance.hairStyle === 'bald'`
- **THEN** the `avataaars` config SHALL include `topProbability: 0`
- **AND** the rendered SVG SHALL not contain a hair `<g>` group

### Requirement: skinColor and hairColor numeric pass through as hex

`avatar-seed.ts` SHALL export a `numericToHex(n)` helper that returns the zero-padded `#RRGGBB` form of a numeric color. The 2D config builder SHALL feed `skinColor` and `hairColor` to `avataaars` v9 as 6-char hex strings (no leading `#`), the same shape `clothesColor` already uses. The avataaars v9 schema accepts a hex pattern for all three fields, so no enum-bucket mapping is required.

#### Scenario: Numeric color converts to zero-padded hex
- **WHEN** `numericToHex(0xfdbcb4)` is called
- **THEN** it returns `'#fdbcb4'`
- **WHEN** `numericToHex(0x000000)` is called
- **THEN** it returns `'#000000'` (six hex digits, lower-case)

#### Scenario: appearance.skinColor reaches DiceBear as hex
- **WHEN** `createOffisimAvatar(seed, size, appearance)` is called with `appearance.skinColor === 0xfdbcb4`
- **THEN** the `avataaars` config SHALL include `skinColor: ['fdbcb4']`

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

