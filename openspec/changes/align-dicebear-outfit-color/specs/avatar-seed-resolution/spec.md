## ADDED Requirements

### Requirement: 2D DiceBear outfit color aligns with 3D seed-derived color

When a 2D avatar is rendered via DiceBear (`@dicebear/core` + `@dicebear/avataaars` style) for an employee, the DiceBear `clothingColor` option SHALL be set to a single-element array containing `outfitColorFromSeed(resolveAvatarSeed(employee))` (hex without leading `#`), so that the generated SVG's shirt color matches the 3D block-figure body color byte-for-byte for the same employee.

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
