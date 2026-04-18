# external-employee-brand-avatars Specification

## Purpose
TBD - created by archiving change add-external-employee-brand-avatars. Update Purpose after archive.

## Requirements

### Requirement: BrandRegistry is the single source of truth for supported external employee brands

`packages/ui-office/src/lib/brand-registry.ts` SHALL export a constant registry keyed by `brand_key` string, containing at minimum these four entries at the first release of this change: `hermes`, `openclaw`, `codex`, `custom`. Each entry SHALL carry `{ brandKey: string; displayName: string; asset2dUri: string; asset3dVariant: BrandVariant; accentColor: string }` where `asset2dUri` resolves to a bundled SVG (imported via Vite's `?url` loader) and `asset3dVariant` is the string token `LowPolyCharacter` uses to switch geometry.

The module SHALL export a resolver function `resolveBrand(employee: { is_external: number; brand_key: string | null }): { kind: 'internal' } | { kind: 'external'; entry: BrandEntry }`:
- `is_external !== 1` → `{ kind: 'internal' }`.
- `is_external === 1 && brand_key in registry` → `{ kind: 'external', entry: registry[brand_key] }`.
- `is_external === 1 && (brand_key is null OR not in registry)` → `{ kind: 'external', entry: registry['custom'] }`.

The module SHALL NOT fetch anything at runtime, SHALL NOT accept runtime registration of new brands, and SHALL NOT depend on `@offisim/core` or `@offisim/shared-types` beyond `EmployeeRow` field types.

#### Scenario: Internal employee resolves as internal
- **WHEN** `resolveBrand({ is_external: 0, brand_key: null })` is called
- **THEN** the return is `{ kind: 'internal' }`

#### Scenario: Known external brand resolves to its entry
- **WHEN** `resolveBrand({ is_external: 1, brand_key: 'hermes' })` is called
- **THEN** the return is `{ kind: 'external', entry }` where `entry.brandKey === 'hermes'`, `entry.asset2dUri` is a non-empty string, and `entry.asset3dVariant === 'hermes'`

#### Scenario: Unknown external brand resolves to custom fallback
- **WHEN** `resolveBrand({ is_external: 1, brand_key: 'totally-unknown-brand' })` is called
- **THEN** the return is `{ kind: 'external', entry }` where `entry.brandKey === 'custom'`

#### Scenario: External employee with null brand_key resolves to custom fallback
- **WHEN** `resolveBrand({ is_external: 1, brand_key: null })` is called
- **THEN** the return is `{ kind: 'external', entry }` where `entry.brandKey === 'custom'`

### Requirement: First release ships four brand 2D SVG assets

`packages/ui-office/src/assets/brands/` SHALL contain at least four SVG files at first release of this change: `hermes.svg`, `openclaw.svg`, `codex.svg`, `custom.svg`. Each SVG SHALL:
1. Use a square `viewBox` (e.g., `0 0 100 100`).
2. Keep the central subject within a ~80% inner region so that `drawAvatarCircle` clips to a circle without cropping the subject.
3. Be ≤ 50 KB file size.
4. Be visually distinguishable from internal DiceBear avataaars avatars at 40 px rendering size.

#### Scenario: Assets exist on disk
- **WHEN** running `ls packages/ui-office/src/assets/brands/`
- **THEN** the directory contains `hermes.svg`, `openclaw.svg`, `codex.svg`, `custom.svg`

#### Scenario: Each asset is under size budget
- **WHEN** checking each brand SVG's byte size
- **THEN** no file exceeds 50 KB

#### Scenario: Registry URIs point at the ships-with assets
- **WHEN** reading each entry in the BrandRegistry
- **THEN** `entry.asset2dUri` for `hermes` / `openclaw` / `codex` / `custom` resolves to a URL derived from the matching `.svg` file in `assets/brands/`

### Requirement: 2D canvas scene branches render by is_external

`packages/ui-office/src/components/scene/canvas-layers/draw-employees.ts` SHALL invoke `resolveBrand(employee)` inside `drawEmployeeNode` (or equivalent point) and route rendering:
- `kind === 'internal'` → existing `drawAvatarCircle(ctx, x, y, r, { avatarImage: <decoded DiceBear image>, ... })` path, byte-identical to pre-change.
- `kind === 'external'` → new path that draws the brand 2D SVG asset as the avatar circle's image fill.

`packages/ui-office/src/components/scene/office-2d-avatar-cache.ts` cache key SHALL be extended to differentiate internal vs external avatars: format `${companyId}:${isExternal ? 'brand:' + brandKey : 'dicebear:' + seed}`. The cache SHALL preserve the existing LRU max size and image decoding semantics.

`packages/ui-office/src/components/scene/office-2d-canvas-renderer.ts` `EmployeeRenderData` type SHALL carry `isExternal: boolean` and `brandKey: string | null` so that `drawEmployees` receives both fields in the snapshot.

#### Scenario: Internal employee render path preserved
- **WHEN** `drawEmployees` is called with an `EmployeeRenderData` where `isExternal === false`
- **THEN** the avatar circle is filled with the DiceBear avataaars image keyed on `seed` via the existing code path, with zero behavioral change vs pre-refactor

#### Scenario: External employee renders brand SVG as avatar
- **WHEN** `drawEmployees` is called with an `EmployeeRenderData` where `isExternal === true` and `brandKey === 'hermes'`
- **THEN** the avatar circle image is the decoded `hermes.svg`, not a DiceBear-rendered image

#### Scenario: Unknown brand renders custom fallback SVG
- **WHEN** `drawEmployees` is called with `isExternal === true` and `brandKey === 'totally-unknown'`
- **THEN** the avatar image is the decoded `custom.svg`

#### Scenario: Avatar cache does not cross-contaminate internal vs external
- **WHEN** an external employee with `brandKey='hermes'` and an internal employee both use seed `"Hermes External v3"` in the same company
- **THEN** the two avatars cache separately (different keys), and the external employee shows `hermes.svg` while the internal employee shows DiceBear avataaars

### Requirement: 3D scene branches character rendering by is_external and brand variant

`packages/ui-office/src/components/scene/office3d-employees.tsx` `EmployeeMarker` SHALL call `resolveBrand(emp.agent)` and render the character by the result:
- `kind === 'internal'` → `<LowPolyCharacter variant='default' outfitColor={outfitColorFromSeed(seed)} skinTone={skinToneFromSeed(seed)} state={...} limbRefs={limbRefs} />`, byte-identical to pre-change.
- `kind === 'external'` → `<LowPolyCharacter variant={entry.asset3dVariant} state={...} limbRefs={limbRefs} />` (outfit / skin are NOT passed from seed; the variant component hardcodes its brand colors and geometry).

`LowPolyCharacter` SHALL accept a `variant?: BrandVariant` prop (default `'default'`). For `'default'`, behavior SHALL be byte-identical to pre-change. For `'hermes'` / `'openclaw'` / `'codex'` / `'custom'`, the component SHALL render the respective brand-distinctive geometry.

All variants SHALL expose the same `limbRefs` contract (`leftLeg` / `rightLeg` / `leftArm` / `rightArm`) so that `useAgentAnimation` / `useCharacterMovement` continue to drive ceremony animation unchanged. If a variant's brand does not have literal limbs (e.g. openclaw lobster), it SHALL still expose an invisible-but-positioned mesh at the limb ref slot so animation targets remain valid.

#### Scenario: Internal employee 3D path preserved
- **WHEN** `EmployeeMarker` renders with an internal employee (`emp.agent.isExternal === false`)
- **THEN** the `<LowPolyCharacter>` invocation has `variant='default'` and the `outfitColor` / `skinTone` props derive from `outfitColorFromSeed` / `skinToneFromSeed` using `emp.seed`, matching pre-change

#### Scenario: External employee renders brand 3D variant
- **WHEN** `EmployeeMarker` renders with `emp.agent.isExternal === true` and `emp.agent.brandKey === 'hermes'`
- **THEN** the `<LowPolyCharacter>` invocation has `variant='hermes'` and `outfitColor` / `skinTone` are NOT forwarded from seed

#### Scenario: Ceremony animation survives brand variant
- **WHEN** an external brand employee (any `variant`) is in the `executing` state and walks between zones
- **THEN** `useCharacterMovement` continues to move the group and `useAgentAnimation` continues to drive limb swing on the limb refs, identical to internal employees

### Requirement: List UI components render external employees via BrandAvatar2D

`packages/ui-office/src/components/shared/` SHALL contain a new `BrandAvatar2D.tsx` component with signature `({ brandKey, size, className }) => JSX.Element` that wraps `<img src={resolveBrand({is_external:1, brand_key:brandKey}).entry.asset2dUri}>`. The component SHALL fall back to `custom.svg` when `brandKey` is null or not in the registry.

The five existing `<DicebearAvatar>` call sites SHALL be updated to branch on `is_external`:
- `AgentCard.tsx`
- `EmployeeInspector.tsx`
- `DeliverableCard.tsx` (ContributorStack — contributors with `sourceKind:'employee'` but whose source employee is external; only applicable once contributor metadata carries `isExternal` — scope: do not block if contributor metadata does not plumb is_external in this change, leave DeliverableCard on DicebearAvatar until Phase 2b contributor-metadata follow-up)
- `TeamHealthCard.tsx`
- `EmployeeCreatorOverlay.tsx` (preview tile — only for editing an existing external employee; new employee creation in the overlay remains DiceBear because wizard target is internal-only per non-goals)

Each call site that needs branching SHALL first resolve `is_external` from the employee being rendered; if unavailable (e.g. the data source does not carry `EmployeeRow`), the call site SHALL default to `<DicebearAvatar>` and document the gap as a known follow-up.

#### Scenario: Internal employee shows DiceBear
- **WHEN** `AgentCard` renders with an agent whose backing `EmployeeRow.is_external === 0`
- **THEN** the avatar is `<DicebearAvatar seed={...}>` as before

#### Scenario: External employee shows brand SVG
- **WHEN** `AgentCard` renders with an agent whose backing `EmployeeRow.is_external === 1` and `brand_key === 'openclaw'`
- **THEN** the avatar is `<BrandAvatar2D brandKey='openclaw'>` which renders an `<img>` with `src` pointing at `openclaw.svg`

### Requirement: AvatarCustomizer is disabled for external employees

The avatar clothing / color customization UI invoked from `EmployeeInspector` SHALL detect `employee.is_external === 1` and replace the customizer contents with a short read-only banner (e.g. "This employee uses its brand's built-in avatar and cannot be customized."). Attempting to mutate `persona.avatarSeed` / outfit color for an external employee SHALL be impossible via the UI.

Internal employees' customizer SHALL remain byte-identical to pre-change.

#### Scenario: Customizer disabled for external
- **WHEN** the user opens `EmployeeInspector` for an external employee and triggers the avatar customize action
- **THEN** the customizer panel shows the read-only banner and does NOT expose outfit / skin pickers

#### Scenario: Customizer preserved for internal
- **WHEN** the user opens `EmployeeInspector` for an internal employee and triggers the avatar customize action
- **THEN** the customizer panel shows the full outfit / skin pickers as before

### Requirement: AgentState and PlacedEmployee carry is_external + brand_key

`AgentState` (in `packages/ui-office/src/runtime/use-agent-states.ts`) SHALL gain `isExternal?: boolean` and `brandKey?: string | null` populated from `EmployeeRow.is_external === 1` and `EmployeeRow.brand_key`.

`PlacedEmployee` and the 2D snapshot's `EmployeeRenderData` SHALL carry the same two fields (derived or passed through). No other `AgentState` consumer behavior SHALL change.

#### Scenario: AgentState reflects EmployeeRow external fields
- **WHEN** `use-agent-states` ingests an employee whose `EmployeeRow.is_external === 1` and `brand_key === 'codex'`
- **THEN** the corresponding `AgentState` has `isExternal === true` and `brandKey === 'codex'`

#### Scenario: AgentState defaults for internal employee
- **WHEN** `use-agent-states` ingests an employee whose `EmployeeRow.is_external === 0`
- **THEN** the corresponding `AgentState` has `isExternal === false` (or undefined) and `brandKey === null` (or undefined)

### Requirement: Bundle size increase is bounded

The web production build's total size increase attributable to this change SHALL be at most 500 KB (measured via the existing `pnpm --filter @offisim/web build` output). This budget covers all four SVG assets, the new `BrandAvatar2D` component, the `LowPolyCharacter` variant expansion, and `brand-registry.ts`.

#### Scenario: Bundle budget
- **WHEN** comparing the total `apps/web/dist/assets/*` byte size before and after this change
- **THEN** the net increase is ≤ 500 KB
