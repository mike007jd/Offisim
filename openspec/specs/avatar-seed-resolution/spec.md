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
