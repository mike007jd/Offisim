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
3D employee rendering SHALL derive outfit color from `hashSeed(resolveAvatarSeed(employee)) % OUTFIT_COLORS.length`, not from iteration index.

#### Scenario: Same employee always gets same 3D color
- **WHEN** employee "Alex Chen" is rendered in 3D
- **THEN** outfit color is always the same regardless of employee list order

### Requirement: 2D avatar seed matches 3D seed source
2D employee rendering SHALL use `resolveAvatarSeed(employee)` as the DiceBear seed, matching the same seed used for 3D color derivation.

#### Scenario: Seed consistency across views
- **WHEN** employee "Alex Chen" is rendered in both 2D and 3D
- **THEN** both views use the same resolved seed for their respective appearance logic

### Requirement: Color arrays are single source of truth
`OUTFIT_COLORS` and `SKIN_TONES` arrays SHALL be defined in exactly one module (`avatar-seed.ts`) and imported by consumers.

#### Scenario: No duplicate color definitions
- **WHEN** searching codebase for OUTFIT_COLORS definition
- **THEN** exactly one `const OUTFIT_COLORS` declaration exists

### Requirement: 2D DiceBear outfit color aligns with 3D seed-derived color

When a 2D avatar is rendered via DiceBear (`@dicebear/core` + `@dicebear/avataaars` style) for an employee, the DiceBear `clothesColor` option (the actual avataaars 9.4.2 API name; common docs also call it "clothing color") SHALL be set to a single-element array containing `outfitColorFromSeed(resolveAvatarSeed(employee))` (hex without leading `#`), so that the generated SVG's shirt color matches the 3D block-figure body color byte-for-byte for the same employee.

#### Scenario: Same employee renders matching outfit color across 2D and 3D
- **WHEN** employee "Alex Chen" (seed `"Alex Chen"` resolving to `outfitColorFromSeed` output `#3b82f6`) is rendered in both the 2D DiceBear chat avatar and the 3D block-figure office scene
- **THEN** the DiceBear-generated SVG's shirt fill color equals `#3b82f6` and the 3D block-figure body mesh's `meshStandardMaterial.color` equals `#3b82f6`

#### Scenario: Avatar cache reuses same SVG per seed
- **WHEN** the same `seed` is requested twice from `getAvatarUri(seed, companyId)` in `office-2d-avatar-cache.ts`
- **THEN** the cache returns the identical data URI on the second call (cache hit) — since the seed-derived `clothingColor` is pure, the generated SVG is deterministic and safe to cache by `${companyId}:${seed}` alone

### Requirement: Manual-config palette survives alongside seed-derived palette

The `AvatarCustomizer` UI's clothing swatches SHALL source their color values from `OUTFIT_COLORS_NUMERIC` (derived from `OUTFIT_COLORS` in `avatar-seed.ts`), keeping the manual-config palette in sync with the seed-derived palette. Independent manual-only palettes (`SKIN_COLORS`, `HAIR_COLORS` in `AvatarCustomizer.tsx`) MAY remain distinct from seed-derived palettes (`SKIN_TONES` in `avatar-seed.ts`), but SHALL be documented as such.

#### Scenario: Customizer clothing swatches match seed-derived palette
- **WHEN** a user opens the `AvatarCustomizer` UI to pick a clothing color
- **THEN** the 8 swatches shown correspond exactly (hex-for-hex) to the 8 colors in `OUTFIT_COLORS`

#### Scenario: Manual skin/hair palettes are allowed to be independent
- **WHEN** a developer searches for `SKIN_COLORS` or `HAIR_COLORS` in the codebase
- **THEN** they find them declared in `AvatarCustomizer.tsx` with a comment noting they are manual-config palettes independent from seed-derived `SKIN_TONES`
