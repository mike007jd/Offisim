# character-3d-rendering Specification

## Purpose
TBD - created by archiving change upgrade-3d-character-rendering-1.0. Update Purpose after archive.
## Requirements
### Requirement: `<BlockCharacter>` SSOT owns internal-employee 3D geometry

`packages/ui-office/src/components/scene/character-mesh-builder.ts` SHALL be the single source of truth for internal-employee 3D block-figure geometry. It SHALL export:

- `interface BlockCharacterParams { skinColor: string; hairColor: string; outfitColor: string; accentColor: string; bodyType: 'slim' | 'normal' | 'stocky'; gender: 'masculine' | 'feminine' | 'neutral'; hairStyle: 'short' | 'long' | 'ponytail' | 'curly' | 'bald' | 'bob' | 'spiky' | 'braids'; accentVariant?: 'vest' | 'jacket' | 'scarf'; state: string; isBlocked: boolean }`
- `<BlockCharacter params={...} variant='default' | 'shared-rig-only' limbRefs={...} children?={...} />` JSX-returning React component
- `STATE_TO_EYE_EMISSIVE` const mapping employee `state` strings to `{ color, intensity }` for eye material emissive
- `BODY_TYPE_FACTORS` and `GENDER_FACTORS` const tables driving width/aspect ratios

`DefaultBlockBody` in `packages/ui-office/src/components/scene/office3d-brand-variants.tsx` SHALL be a thin wrapper that delegates to `<BlockCharacter variant='default'>`. `HermesBody`, `OpenClawBody`, `CodexBody`, and `CustomBody` SHALL each render `<BlockCharacter variant='shared-rig-only' limbRefs={limbRefs}>` for the limb-ref-bearing meshes and provide their brand-specific torso / head / extras as children.

Internal employees SHALL render with `variant='default'`. External brand-keyed employees SHALL render with `variant='shared-rig-only'` plus brand-specific overrides.

#### Scenario: SSOT location and exports
- **WHEN** importing from `packages/ui-office/src/components/scene/character-mesh-builder.ts`
- **THEN** `BlockCharacterParams`, `BlockCharacter`, `STATE_TO_EYE_EMISSIVE`, `BODY_TYPE_FACTORS`, `GENDER_FACTORS` are all available

#### Scenario: DefaultBlockBody delegates to SSOT
- **WHEN** auditing `office3d-brand-variants.tsx::DefaultBlockBody`
- **THEN** the component returns a `<BlockCharacter params={...} variant='default'>` element
- **AND** does NOT contain any inline `<boxGeometry>` declarations for legs / torso / arms / head / hair / accent

#### Scenario: Brand variants share rig only
- **WHEN** auditing `HermesBody`, `OpenClawBody`, `CodexBody`, `CustomBody`
- **THEN** each component returns a `<BlockCharacter variant='shared-rig-only' limbRefs={limbRefs}>` wrapper with brand-authored torso/head meshes inside
- **AND** none of the four components renders eyes, mouth, schema-driven hair geometries, or the `clothingAccent` vest overlay

### Requirement: Eyes and mouth render on every internal-employee head

The `<BlockCharacter variant='default'>` rendering SHALL include 2 eye spheres and 1 mouth box on the head's `+z` face. The geometric placement SHALL be:

| Element | Position (world) | Geometry | Material |
|---------|------------------|----------|----------|
| Left eye | `(-0.07, 1.30, 0.16)` | `sphereGeometry args={[0.025, 8, 6]}` | `meshStandardMaterial` color `#222222`, emissive state-driven |
| Right eye | `(0.07, 1.30, 0.16)` | `sphereGeometry args={[0.025, 8, 6]}` | same as left |
| Mouth | `(0, 1.21, 0.155)` | `boxGeometry args={[0.06, 0.012, 0.005]}` | `meshStandardMaterial` color `#7a3a3a`, no emissive |

Eye and mouth SHALL NOT render for `variant='shared-rig-only'`.

The eye `meshStandardMaterial.emissive` and `emissiveIntensity` SHALL be derived from `STATE_TO_EYE_EMISSIVE[params.state]` when `params.isBlocked === false`, else from `STATE_TO_EYE_EMISSIVE['blocked']`.

#### Scenario: Default internal employee renders eyes and mouth
- **WHEN** rendering an internal employee via `<BlockCharacter variant='default' params={...}>`
- **THEN** the resulting scene graph contains 2 spheres at `(-0.07, 1.30, 0.16)` and `(0.07, 1.30, 0.16)`
- **AND** contains a box at `(0, 1.21, 0.155)` with dimensions `0.06 × 0.012 × 0.005`

#### Scenario: External brand employee does not gain eyes
- **WHEN** rendering a Hermes / OpenClaw / Codex / Custom employee via `<BlockCharacter variant='shared-rig-only'>`
- **THEN** the SSOT does NOT mount eye spheres or the mouth box
- **AND** the brand body's hand-authored head (or non-head, in OpenClaw's case) is the only head-region geometry

#### Scenario: Eye sphere segmentation
- **WHEN** auditing the eye sphere geometry args
- **THEN** the segments are `[0.025, 8, 6]` (radius 0.025, 8 width segments, 6 height segments) — kept low to bound triangle count at ~80 per eye

### Requirement: Eye emissive color signals employee state

The `STATE_TO_EYE_EMISSIVE` table SHALL include the following entries:

| State | `color` | `intensity` |
|-------|---------|-------------|
| `idle` | `#202020` | `0.05` |
| `executing` | `#1e88e5` | `0.4` |
| `reporting` | `#06b6d4` | `0.5` |
| `searching` | `#22c55e` | `0.35` |
| `assigned` | `#22c55e` | `0.35` |
| `gathering` | `#22c55e` | `0.35` |
| `analyzing` | `#22c55e` | `0.35` |
| `planning` | `#22c55e` | `0.35` |
| `dispatching` | `#22c55e` | `0.35` |
| `success` | `#22c55e` | `0.35` |
| `blocked` (when `isBlocked === true`, regardless of `state`) | `#ef4444` | `0.5` |

Unknown states SHALL fall back to the `idle` entry.

#### Scenario: Idle state shows dim grey eyes
- **WHEN** rendering with `params.state === 'idle'` and `params.isBlocked === false`
- **THEN** the eye material has `emissive: new Color('#202020')` and `emissiveIntensity: 0.05`

#### Scenario: Executing state shows blue eyes
- **WHEN** rendering with `params.state === 'executing'` and `params.isBlocked === false`
- **THEN** the eye material has `emissive: new Color('#1e88e5')` and `emissiveIntensity: 0.4`

#### Scenario: Reporting state shows cyan eyes
- **WHEN** rendering with `params.state === 'reporting'`
- **THEN** the eye material has `emissive: new Color('#06b6d4')` and `emissiveIntensity: 0.5`

#### Scenario: Blocked employee shows red eyes regardless of state
- **WHEN** rendering with `params.isBlocked === true` and `params.state === 'executing'`
- **THEN** the eye material has `emissive: new Color('#ef4444')` and `emissiveIntensity: 0.5` (blocked overrides state)

### Requirement: bodyType drives torso, arm, leg width factors

The `BODY_TYPE_FACTORS` table SHALL include:

| `bodyType` | `torso` | `arm` | `leg` | `head` |
|------------|---------|-------|-------|--------|
| `slim` | `0.85` | `0.85` | `0.92` | `1.00` |
| `normal` | `1.00` | `1.00` | `1.00` | `1.00` |
| `stocky` | `1.15` | `1.18` | `1.10` | `1.00` |

These factors SHALL multiply the **x-axis** (width) dimension of torso (upper and lower halves), arm boxes, and leg boxes. Y-axis (height) and z-axis (depth) SHALL remain unchanged across body types. The head x-dimension SHALL NOT scale with body type so eye and mouth positions remain valid.

Arm attach positions (`leftArm.position.x`, `rightArm.position.x`) SHALL scale proportionally with torso width: `±0.25 × bodyTypeFactor.torso × genderFactor.shoulder` so arms remain attached to torso edges across body types and genders.

#### Scenario: Slim body type narrows torso
- **WHEN** rendering with `params.bodyType === 'slim'` and `params.gender === 'neutral'`
- **THEN** the upper torso `boxGeometry` x-arg equals `0.36 × 0.85 × 1.00 = 0.306`
- **AND** the lower torso `boxGeometry` x-arg equals `0.36 × 0.85 × 1.00 = 0.306`

#### Scenario: Stocky body type widens arms
- **WHEN** rendering with `params.bodyType === 'stocky'` and `params.gender === 'neutral'`
- **THEN** the arm `boxGeometry` x-arg equals `0.10 × 1.18 = 0.118`
- **AND** the arm position x equals `±0.25 × 1.15 × 1.00 = ±0.2875`

#### Scenario: Head width invariant across body types
- **WHEN** comparing `params.bodyType` `slim` vs `stocky` rendered scenes
- **THEN** the head `boxGeometry args[0]` equals `0.30` in both cases

### Requirement: gender drives shoulder vs hip width independently of bodyType

The `GENDER_FACTORS` table SHALL include:

| `gender` | `shoulder` | `hip` | `aspect` |
|----------|------------|-------|----------|
| `masculine` | `1.05` | `0.95` | `1.00` |
| `feminine` | `0.85` | `1.10` | `0.95` |
| `neutral` | `1.00` | `1.00` | `1.00` |

The torso SHALL be split into an upper half (y from 0.62 to 0.87, height 0.25) scaled by `shoulder`, and a lower half (y from 0.50 to 0.75, height 0.25) scaled by `hip`. The upper half height (`y` dimension) SHALL be multiplied by `aspect`.

The final upper torso width SHALL equal `0.36 × bodyTypeFactor.torso × genderFactor.shoulder`. The final lower torso width SHALL equal `0.36 × bodyTypeFactor.torso × genderFactor.hip`.

`gender === 'neutral'` SHALL produce the same silhouette as today's pre-1.0 default body geometry so existing employees do not visually shift on first render after this change.

#### Scenario: Feminine gender narrows shoulders and widens hips
- **WHEN** rendering with `params.gender === 'feminine'` and `params.bodyType === 'normal'`
- **THEN** the upper torso x-arg equals `0.36 × 1.00 × 0.85 = 0.306`
- **AND** the lower torso x-arg equals `0.36 × 1.00 × 1.10 = 0.396`

#### Scenario: Masculine gender widens shoulders and narrows hips
- **WHEN** rendering with `params.gender === 'masculine'` and `params.bodyType === 'normal'`
- **THEN** the upper torso x-arg equals `0.36 × 1.00 × 1.05 = 0.378`
- **AND** the lower torso x-arg equals `0.36 × 1.00 × 0.95 = 0.342`

#### Scenario: Neutral gender preserves legacy silhouette
- **WHEN** rendering with `params.gender === 'neutral'` and `params.bodyType === 'normal'`
- **THEN** the resulting torso silhouette (combined upper + lower) matches the legacy single-box torso `0.36 × 0.50 × 0.20`

### Requirement: hairStyle renders 8 distinct geometries

For `variant='default'`, the `<BlockCharacter>` SHALL render hair geometry per `params.hairStyle` per the following table. All hair meshes SHALL share one `meshStandardMaterial` with color = `params.hairColor`.

| `hairStyle` | Composition |
|-------------|-------------|
| `bald` | No hair mesh — head box's skin color shows through. |
| `short` | One `boxGeometry args={[0.32, 0.16, 0.32]}` at `(0, 1.48, 0)` |
| `long` | One `boxGeometry args={[0.32, 0.40, 0.32]}` at `(0, 1.40, 0)` |
| `ponytail` | Cap `boxGeometry args={[0.32, 0.16, 0.32]}` at `(0, 1.48, 0)` + `cylinderGeometry args={[0.04, 0.04, 0.30, 8]}` at `(0, 1.20, -0.20)` rotation `(Math.PI/2, 0, 0)` |
| `curly` | Cap `boxGeometry args={[0.32, 0.16, 0.32]}` at `(0, 1.48, 0)` + 4 `sphereGeometry args={[0.07, 8, 6]}` at `(±0.10, 1.55, ±0.10)` |
| `bob` | One `boxGeometry args={[0.36, 0.22, 0.34]}` at `(0, 1.45, 0)` |
| `spiky` | Cap `boxGeometry args={[0.32, 0.16, 0.32]}` at `(0, 1.48, 0)` + 5 `coneGeometry args={[0.04, 0.10, 6]}` at `(0, 1.58, 0)`, `(±0.10, 1.56, ±0.06)` |
| `braids` | Cap `boxGeometry args={[0.32, 0.16, 0.32]}` at `(0, 1.48, 0)` + 2 `cylinderGeometry args={[0.035, 0.035, 0.32, 8]}` at `(±0.18, 1.20, 0)` |

Hair geometries SHALL NOT vary per employee within the same hairStyle — the geometry is determined entirely by the enum value, not by seed or other appearance fields.

#### Scenario: Bald renders no hair mesh
- **WHEN** `params.hairStyle === 'bald'`
- **THEN** the rendered scene graph has no hair mesh group attached to the head
- **AND** the head box's skin color is the only color visible above the eyes

#### Scenario: Braids renders cap plus two side cylinders
- **WHEN** `params.hairStyle === 'braids'`
- **THEN** the scene graph contains the cap box at `(0, 1.48, 0)` plus exactly 2 cylinders at `(-0.18, 1.20, 0)` and `(0.18, 1.20, 0)`
- **AND** each cylinder has `cylinderGeometry args={[0.035, 0.035, 0.32, 8]}`

#### Scenario: Spiky renders cap plus five cones
- **WHEN** `params.hairStyle === 'spiky'`
- **THEN** the scene graph contains the cap box plus exactly 5 cones at `(0, 1.58, 0)`, `(0.10, 1.56, 0.06)`, `(-0.10, 1.56, 0.06)`, `(0.10, 1.56, -0.06)`, `(-0.10, 1.56, -0.06)`

#### Scenario: Curly renders cap plus four spheres
- **WHEN** `params.hairStyle === 'curly'`
- **THEN** the scene graph contains the cap box plus exactly 4 spheres at the four `(±0.10, 1.55, ±0.10)` corner positions

#### Scenario: Hair color is byte-equal to params.hairColor
- **WHEN** rendering any hairStyle other than `bald` with `params.hairColor === '#3d6bce'`
- **THEN** every hair sub-mesh's `meshStandardMaterial.color` equals `new Color('#3d6bce')`

### Requirement: clothingAccent renders as vest overlay (1.0 ships `vest` only)

For `variant='default'`, the `<BlockCharacter>` SHALL render a vest accent overlay when `params.accentColor !== params.outfitColor`. Geometry:

`boxGeometry args={[0.32 × bodyTypeFactor.torso × genderFactor.shoulder, 0.40, 0.005]}` at position `(0, 0.78, 0.105)` with `meshStandardMaterial` color `params.accentColor` and `roughness: 0.7`.

When `params.accentColor === params.outfitColor`, the vest mesh SHALL NOT render.

`params.accentVariant` SHALL accept `'vest' | 'jacket' | 'scarf'` and default to `'vest'`. The 1.0 release SHALL implement only `'vest'`. `'jacket'` and `'scarf'` SHALL be reserved for future expansion and SHALL render as `'vest'` if requested in 1.0 (forward-compatible default).

#### Scenario: Distinct accent renders vest
- **WHEN** rendering with `params.outfitColor === '#3b82f6'` and `params.accentColor === '#22c55e'`
- **THEN** the scene graph contains a vest box at `(0, 0.78, 0.105)` with material color `'#22c55e'`

#### Scenario: Matching accent hides vest
- **WHEN** rendering with `params.outfitColor === '#3b82f6'` and `params.accentColor === '#3b82f6'`
- **THEN** the scene graph does NOT contain a vest box

#### Scenario: Vest width follows body type and gender
- **WHEN** rendering with `params.bodyType === 'stocky'` and `params.gender === 'masculine'` and a distinct accent color
- **THEN** the vest `boxGeometry args[0]` equals `0.32 × 1.15 × 1.05 = 0.38640...`

#### Scenario: Unimplemented variants fall back to vest in 1.0
- **WHEN** rendering with `params.accentVariant === 'jacket'` (1.0 reserved value)
- **THEN** the rendered geometry equals the `'vest'` geometry above

### Requirement: 2D ↔ 3D visual consistency contract

The rendered identity for the same `(seed, appearance)` SHALL be recognizable as the same employee across the 2D DiceBear avatar (`createOffisimAvatar`) and the 3D `<BlockCharacter variant='default'>` figure. The following four axes SHALL be byte-equal:

1. **skinColor**: `resolveSkinTone(seed, appearance)` SHALL produce the same `#RRGGBB` consumed by both the 2D `avataaars` `skinColor` config and the 3D head/arm `meshStandardMaterial.color`.
2. **hairColor**: `resolveHairColor(seed, appearance)` SHALL produce the same `#RRGGBB` consumed by both the 2D `avataaars` `hairColor` config and the 3D hair-style `meshStandardMaterial.color`.
3. **clothingColor**: `resolveOutfitColor(seed, appearance)` SHALL produce the same `#RRGGBB` consumed by both the 2D `avataaars` `clothesColor` config and the 3D upper+lower torso `meshStandardMaterial.color`.
4. **eye-axis symmetry**: 2D DiceBear renders eyes symmetric about the head's vertical centerline. The 3D figure SHALL place its 2 eyes symmetric about `x = 0` (i.e. at `±0.07`).

Hair *style* MAY differ between 2D (DiceBear `top` token) and 3D (block-figure geometry) since they are structurally different rendering primitives. The mapping is via `HAIR_STYLE_TO_AVATAARS_TOP` (existing, not modified by this change).

#### Scenario: Skin color byte-equal across 2D and 3D
- **WHEN** an employee has `appearance.skinColor === 0xfdbcb4`
- **THEN** the 2D DiceBear avatar `skinColor` config receives `'fdbcb4'`
- **AND** the 3D head box `meshStandardMaterial.color` is `new Color('#fdbcb4')`

#### Scenario: Hair color byte-equal across 2D and 3D
- **WHEN** an employee has `appearance.hairColor === 0x6b3f1e`
- **THEN** the 2D DiceBear avatar `hairColor` config receives `'6b3f1e'`
- **AND** the 3D hair-style sub-meshes' `meshStandardMaterial.color` is `new Color('#6b3f1e')`

#### Scenario: Outfit color byte-equal across 2D and 3D
- **WHEN** an employee has `appearance.clothingColor === 0x22c55e`
- **THEN** the 2D DiceBear avatar `clothesColor` config receives `'22c55e'`
- **AND** the 3D upper torso AND lower torso `meshStandardMaterial.color` are both `new Color('#22c55e')`

#### Scenario: Eye axis symmetric in 3D
- **WHEN** auditing the eye sphere positions in `<BlockCharacter variant='default'>`
- **THEN** the left eye `position.x` equals `-0.07` and the right eye `position.x` equals `+0.07`
- **AND** their y and z positions are equal

### Requirement: HTML overlay LOD gate

`packages/ui-office/src/hooks/useCharacterLod.ts` SHALL export `useCharacterLod(worldPos: [number, number, number], threshold?: number): { isFar: boolean }`. Default threshold SHALL be `20` world units. The hook SHALL:

- Read the active R3F camera via `useThree`
- Compute `camera.position.distanceTo(worldPos)` per frame inside `useFrame`
- Set `isFar = true` when distance exceeds threshold; `isFar = false` otherwise
- Avoid `setState` calls on every frame: SHALL only call `setIsFar` when the distance crosses the threshold (transition gating via ref-tracked previous state)

`packages/ui-office/src/components/scene/office3d-employees.tsx::EmployeeMarker` SHALL gate its three `<Html>` overlays (selection name pill, badge, status bubble) on `!isFar` from `useCharacterLod(emp.position)`. When `isFar === true`, the overlays SHALL NOT mount in the DOM.

#### Scenario: Hook signature
- **WHEN** importing `useCharacterLod` from the hooks module
- **THEN** the function signature is `(worldPos: [number, number, number], threshold?: number) => { isFar: boolean }`
- **AND** the default threshold is `20`

#### Scenario: Far camera hides overlays
- **WHEN** the active camera is positioned at `[0, 18, 25]` (default office overview) and an employee is at `[2, 0, 2]` (distance ≈ 28)
- **THEN** `useCharacterLod` returns `{ isFar: true }`
- **AND** `EmployeeMarker` does NOT mount its `<Html>` overlays
- **AND** the DOM does NOT contain the corresponding HTML pill / bubble nodes

#### Scenario: Near camera shows overlays
- **WHEN** the active camera is positioned at `[2, 1.5, 5]` and an employee is at `[2, 0, 2]` (distance ≈ 3.4)
- **THEN** `useCharacterLod` returns `{ isFar: false }`
- **AND** `EmployeeMarker` mounts its `<Html>` overlays per their other gates (e.g. status bubble when `state !== 'idle'`)

#### Scenario: SetState gated on transition
- **WHEN** the camera moves from distance 25 → 26 (still far) over 60 frames
- **THEN** `setIsFar(true)` is called at most once across those 60 frames (or zero times if already true)

### Requirement: AppearanceTab live preview consumes full appearance

`packages/ui-office/src/components/employees/personnel-tabs/AppearanceTab.tsx::Preview3DCanvas` SHALL accept the full `AvatarAppearance` record as a prop and SHALL pass it to `<BlockCharacter variant='default'>` for internal employees. Every appearance field change in the customizer (skin, hair, clothing color; hairStyle, bodyType, gender, clothingAccent) SHALL flip the 3D preview within one render frame.

The preview canvas size SHALL be at least `280 × 220` to accommodate stocky body types without clipping.

#### Scenario: Preview updates on skinColor swatch click
- **WHEN** the user clicks a different "Skin tone" swatch in the customizer
- **THEN** the 3D preview's head, arm, eye-base, and mouth-base materials update to the new skin color in the next frame
- **AND** the 2D preview also updates (per `personnel-appearance-live-preview` capability)

#### Scenario: Preview updates on bodyType change
- **WHEN** the user changes "Body type" from `normal` to `stocky`
- **THEN** the 3D preview's torso, arm, leg widths scale by their `BODY_TYPE_FACTORS['stocky']` factors in the next frame

#### Scenario: Preview updates on hairStyle change
- **WHEN** the user changes "Hair style" from `short` to `braids`
- **THEN** the 3D preview's hair geometry transitions from the short cap box to the cap-plus-2-cylinders composition in the next frame

#### Scenario: Preview updates on clothingAccent change
- **WHEN** the user clicks a "Clothing accent" swatch with a color different from the current `clothingColor`
- **THEN** the 3D preview's vest overlay mesh appears (or updates color) in the next frame

#### Scenario: Preview canvas size accommodates stocky
- **WHEN** auditing the `<Canvas>` style on `Preview3DCanvas`
- **THEN** the `width` is at least `280` and `height` is at least `220`

### Requirement: Brand variants do not gain customizer schema

External brand-keyed employees (Hermes, OpenClaw, Codex, Custom) SHALL NOT consume `params.bodyType`, `params.gender`, `params.hairStyle`, `params.clothingAccent`, or eye/mouth meshes. Their `<BlockCharacter variant='shared-rig-only'>` invocation SHALL provide only the `limbRefs` and brand-managed children. The `EmployeeMarker` SHALL NOT pass `appearance` fields to brand-variant rendering paths.

External employees SHALL render with their hand-authored brand silhouette per existing `HermesBody` / `OpenClawBody` / `CodexBody` / `CustomBody` definitions, modulo the rewrite to use `<BlockCharacter variant='shared-rig-only'>` for the limb-ref-bearing meshes.

#### Scenario: Hermes body renders without eyes or mouth
- **WHEN** rendering an employee with `is_external === 1` and `brandKey === 'hermes'`
- **THEN** the scene graph contains no eye spheres at `(±0.07, 1.30, 0.16)`
- **AND** contains no mouth box at `(0, 1.21, 0.155)`
- **AND** contains the brand-authored hood, halo, and emblem meshes

#### Scenario: External employee unaffected by clothingAccent
- **WHEN** an external employee has `appearance.clothingAccent === 0xff00ff` (vivid magenta) saved
- **THEN** the rendered scene graph contains no vest mesh
- **AND** the brand body's existing torso/emblem colors are unchanged

