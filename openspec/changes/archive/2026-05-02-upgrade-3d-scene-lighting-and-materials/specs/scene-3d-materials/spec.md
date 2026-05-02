# scene-3d-materials Specification

## Purpose
Every PBR surface in the Office 3D scene SHALL declare a
`materialClass` from the closed enum
`'wood' | 'metal' | 'glass' | 'leather' | 'fabric' | 'plastic'`
and obtain its three.js material element through the
`useMaterial(materialClass, color, overrides?)` hook exported from
`packages/ui-office/src/theme/scene-materials.ts`. The hook returns
a memoized `<meshStandardMaterial>` or `<meshPhysicalMaterial>`
with PBR parameters drawn from `MATERIAL_PRESETS` — the SSOT table
defined here. Inline `roughness=` / `metalness=` / `transmission=`
numeric literals and inline hex color strings SHALL NOT appear
under `packages/ui-office/src/components/scene/prefabs/`. Color
SHALL come from `useSceneColors()` only. This capability owns the
material PBR parameter contract, the procedural normal-map
generation contract (glass dust scatter + wood grain), and the
LOD threshold contract for emissive grid prefabs (ServerRack
LED grid).

## ADDED Requirements

### Requirement: Six closed material classes drive PBR parameters

`MaterialClass` SHALL be the closed type union
`'wood' | 'metal' | 'glass' | 'leather' | 'fabric' | 'plastic'`.
`MATERIAL_PRESETS: Record<MaterialClass, MaterialPreset>` SHALL
populate exactly the following defaults:

- **wood** — `meshStandardMaterial`, `roughness=0.55`,
  `metalness=0.0`, `envMapIntensity=0.6`,
  `useProceduralNormal=true` (wood-grain texture),
  `normalScale=0.08`
- **metal** — `meshStandardMaterial`, `roughness=0.22`,
  `metalness=0.85`, `envMapIntensity=1.0`
- **glass** — `meshPhysicalMaterial`, `roughness=0.18`,
  `metalness=0.0`, `transmission=0.78`, `ior=1.5`, `opacity=1`,
  `transparent=true`, `useProceduralNormal=true` (dust-scatter
  texture), `normalScale=0.05`, `attenuationColor` defaulting
  to `useSceneColors().partition`, `attenuationDistance=2.0`
- **leather** — `meshPhysicalMaterial`, `roughness=0.78`,
  `metalness=0.05`, `clearcoat=0.25`, `clearcoatRoughness=0.6`,
  `envMapIntensity=0.7`
- **fabric** — `meshStandardMaterial`, `roughness=0.92`,
  `metalness=0.0`, `envMapIntensity=0.3`
- **plastic** — `meshStandardMaterial`, `roughness=0.45`,
  `metalness=0.0`, `envMapIntensity=0.5`

Per-instance variance within a class SHALL be supplied through
the third argument `overrides` of `useMaterial(materialClass,
color, overrides?)`. Overrides SHALL clamp roughness adjustments
to ±0.10 of the class default; metalness adjustments SHALL clamp
to ±0.10. Out-of-range overrides SHALL throw at module load time
in development builds and silently clamp in production.

#### Scenario: All six classes have explicit preset entries

- **WHEN** importing `MATERIAL_PRESETS`
- **THEN** `Object.keys(MATERIAL_PRESETS)` equals exactly
  `['wood', 'metal', 'glass', 'leather', 'fabric', 'plastic']`
  (any order)
- **AND** every preset has all of the required fields populated
  per the table above

#### Scenario: Glass produces meshPhysicalMaterial

- **WHEN** `useMaterial('glass', '#94a3b8')` is invoked
- **THEN** the returned JSX is a `<meshPhysicalMaterial>` element
- **AND** its `transmission` prop is `0.78`
- **AND** its `roughness` prop is `0.18`
- **AND** its `ior` prop is `1.5`

#### Scenario: Override variance clamps at ±0.10

- **WHEN** in development mode `useMaterial('wood', '#fff',
  { roughness: 0.95 })` is invoked
- **THEN** the call throws an error referencing the ±0.10 clamp
  rule
- **WHEN** in production mode the same call is invoked
- **THEN** the resulting material has `roughness === 0.65`
  (wood default 0.55 plus the +0.10 cap)

### Requirement: All prefab materials SHALL route through useMaterial

Every JSX `<meshStandardMaterial>` or `<meshPhysicalMaterial>` under `packages/ui-office/src/components/scene/prefabs/` SHALL be produced by the `useMaterial(...)` hook. Direct JSX
instantiation of these material types SHALL NOT appear in
prefab files. `meshBasicMaterial` (unlit, used for emissive LEDs
and screens) is exempt — it's not a PBR surface.

`useMaterial` SHALL return a stable element across renders for
the same `(materialClass, color, overrides)` triple, using
`useMemo` keyed on a JSON-stringified key. Re-renders of a
prefab SHALL NOT cause material churn or three.js material
disposal/recreation.

#### Scenario: No raw meshStandardMaterial in prefabs

- **WHEN** running `grep -rn "meshStandardMaterial\|meshPhysicalMaterial"
  packages/ui-office/src/components/scene/prefabs/`
- **THEN** zero matches outside of import statements

#### Scenario: useMaterial output is stable across renders

- **WHEN** a prefab renders twice with identical
  `(materialClass, color, overrides)` props
- **THEN** the returned material element is the same React
  reference (memoized)
- **AND** the underlying three.js material is reused (no
  `dispose()` between renders)

### Requirement: Prefab files SHALL NOT contain inline numeric PBR literals or hex color literals

Files under `packages/ui-office/src/components/scene/prefabs/` SHALL NOT contain inline hex color literals or inline PBR numeric prop literals. Specifically:

- `roughness={<number>}` outside `useMaterial(...)` is forbidden
- `metalness={<number>}` outside `useMaterial(...)` is forbidden
- `transmission={<number>}` outside `useMaterial(...)` is forbidden
- `ior={<number>}`, `opacity={<number>}`, `clearcoat={<number>}`
  outside `useMaterial(...)` are forbidden
- `color="#<hex>"` and `color='#<hex>'` and string literals
  matching `#[0-9a-fA-F]{3,6}` are forbidden

The `useSceneColors()` SSOT exported from
`packages/ui-office/src/theme/use-scene-colors.ts` SHALL be the
ONLY color source. Any color a prefab uses MUST appear as a
field on the `SceneColors` type and be referenced as
`sc.<field>`.

`Html`-styled tooltip / label inline CSS strings (under
`office3d-scene-primitives.tsx`) and unlit `meshBasicMaterial`
emissive colors SHALL retain their existing color references but
are encouraged to migrate to tokens. They are not required by
this requirement to migrate.

#### Scenario: Zero hex literals in prefab files

- **WHEN** running `grep -nE "#[0-9a-fA-F]{3,6}" packages/ui-office/src/components/scene/prefabs/*.tsx`
- **THEN** zero matches

#### Scenario: Zero inline roughness/metalness/transmission in prefab files

- **WHEN** running `grep -nE "(roughness|metalness|transmission)=\{?[0-9]"
  packages/ui-office/src/components/scene/prefabs/*.tsx`
- **THEN** zero matches

#### Scenario: useSceneColors exposes every prefab-required token

- **WHEN** inspecting `SceneColors` after the change applies
- **THEN** the type contains the new fields: `sceneBackground`,
  `wallShell`, `bookSpine: readonly string[5]`, `cableChannel`,
  `vendingScreen`, `tableReading`, `whiteboardSurface`,
  `whiteboardMarker: readonly string[3]`, `accentWarm`,
  `accentCool`
- **AND** the existing fields (`floor`, `desk`, `furniture`, etc.)
  are unchanged

### Requirement: Glass material uses tinted transmission with attenuation

The `glass` material class SHALL produce a `meshPhysicalMaterial`
with `transmission=0.78` (not 0.9), `roughness=0.18` (not 0.1),
`attenuationColor` defaulting to `useSceneColors().partition`,
and `attenuationDistance=2.0`. A procedural dust-scatter normal
map (`getDustNormalTexture()` from
`packages/ui-office/src/lib/scene-procedural-textures.ts`) SHALL
be applied with `normalScale=0.05` so glass reads as glass with
visible dust speckles, not as missing geometry.

#### Scenario: Glass divider visibly tints surfaces behind it

- **WHEN** rendering a `WorkstationMesh3D` glass divider in front
  of a contrasting employee body
- **THEN** the body color visible through the glass is shifted
  toward the partition color (cool grey)
- **AND** the perceived transmission is < 100% (glass is visible
  as a surface, not invisible)

#### Scenario: Glass roughness produces blurred reflections

- **WHEN** the camera tilts past a glass divider
- **THEN** the glass surface shows a slight environment-map
  reflection that is softer than a perfect mirror
- **AND** the reflection brightness comes from `envMapIntensity`
  (default per glass preset, not from `Environment` direct sample)

#### Scenario: attenuationDistance defaults to 2.0

- **WHEN** `useMaterial('glass', sc.partition)` is invoked with
  no override on attenuation
- **THEN** the returned material has `attenuationDistance === 2.0`
- **AND** `attenuationColor.getHex()` matches `sc.partition` parsed

### Requirement: Procedural normal textures SHALL be shared and runtime-generated

The module `packages/ui-office/src/lib/scene-procedural-textures.ts` SHALL export `getDustNormalTexture(): THREE.Texture` and
`getWoodGrainNormalTexture(): THREE.Texture`. Each function SHALL
generate the texture lazily on first call and SHALL cache the
result at module level so repeated calls return the same
`THREE.Texture` instance. The textures SHALL be 256×256 pixels,
generated via `OffscreenCanvas` when available with fallback to
`HTMLCanvasElement` and final fallback to direct
`Uint8Array` construction.

The dust texture SHALL be a hashed-gradient noise map (random
high-frequency speckle). The wood grain texture SHALL be a
sinusoidal noise streaked along the U axis to produce visible
grain lines.

Both textures SHALL set `wrapS = wrapT = THREE.RepeatWrapping`
and `needsUpdate = true`. No external file fetch SHALL occur for
either texture.

#### Scenario: Dust texture is cached after first call

- **WHEN** `getDustNormalTexture()` is called twice in the same
  process
- **THEN** both calls return the same `THREE.Texture` reference
- **AND** the underlying GPU upload occurs only once

#### Scenario: Textures are 256×256 with RepeatWrapping

- **WHEN** `getWoodGrainNormalTexture()` is invoked
- **THEN** the returned texture has
  `image.width === 256` and `image.height === 256`
- **AND** `wrapS === THREE.RepeatWrapping`
- **AND** `wrapT === THREE.RepeatWrapping`

#### Scenario: No external texture file is fetched

- **WHEN** the prefab tree mounts and the textures are
  generated
- **THEN** no network request is issued for image resources
- **AND** no `THREE.TextureLoader.load` calls reference a path

### Requirement: ServerRack uses distance-driven LOD with hysteresis

`ServerRackMesh3D` SHALL render the live LED grid + ventilation
slat geometry only when the camera distance from the rack center
is `< 16` units (after a recent live → baked transition) or `< 20`
units (after a recent baked → live transition). Otherwise it
SHALL render a baked emissive front-panel texture.

The hysteresis thresholds (16 / 20) SHALL prevent the live ↔
baked swap from oscillating when the camera sits at a stable
distance near 18 units. The component SHALL track its current
LOD level (`'live'` | `'baked'`) in component state.

The baked texture SHALL be produced by
`buildServerRackBakedTexture(sc: SceneColors)` exported from
`packages/ui-office/src/components/scene/server-rack-lod-texture.ts`.
The texture SHALL be 256×128 pixels, drawn once per rack instance
mount via `OffscreenCanvas`, and SHALL paint the same LED color
pattern (`(rowIndex + ledIndex) % 3` mapping to cyan/green/blue)
as the live mesh grid. The baked variant SHALL be applied as
`meshBasicMaterial` (unlit) so the emissive look survives without
direct lighting cost.

#### Scenario: Live LED grid renders at close camera

- **WHEN** the camera distance to a ServerRack center is 10 units
  (close)
- **THEN** the rack renders 8 × 5 = 40 individual LED meshes plus
  the 18 ventilation slat meshes
- **AND** the front-panel baked-texture mesh is NOT rendered

#### Scenario: Baked texture renders at far camera

- **WHEN** the camera distance is 25 units
- **THEN** the rack renders zero individual LED meshes and zero
  ventilation slat meshes
- **AND** the front-panel mesh renders with the baked
  `meshBasicMaterial` texture

#### Scenario: Hysteresis prevents oscillation at 18 units

- **WHEN** the camera dollies smoothly through the 18-unit
  boundary in one direction (live → baked transition triggers
  at 20)
- **AND** then reverses direction without crossing 16
- **THEN** the rack LOD level remains `'baked'` (no flicker
  back to live until the camera passes 16)

### Requirement: Wood material uses procedural grain at low normalScale

The `wood` material class SHALL apply
`getWoodGrainNormalTexture()` with `normalScale=0.08`. The grain
SHALL be subtle — visible at close camera (≤ 5 unit distance) but
not distracting at default camera (~ 28 unit distance). Wood
surfaces (desks, conference table, bookshelves, reading tables)
SHALL all share the same wood material preset; per-instance
variation comes through color (`sc.desk` vs `sc.tableReading` vs
`sc.furniture`).

#### Scenario: Wood normal map is shared across instances

- **WHEN** rendering both `WorkstationMesh3D` (desk) and
  `MeetingTableMesh3D` (conference table)
- **THEN** both consume `getWoodGrainNormalTexture()` and
  receive the same `THREE.Texture` reference
- **AND** the texture is uploaded to the GPU once

#### Scenario: Wood color varies per surface but preset is shared

- **WHEN** comparing the desk surface and the reading table top
  (both wood)
- **THEN** both use `useMaterial('wood', <color>)`
- **AND** the desk color is `sc.desk` and the reading table
  color is `sc.tableReading`
- **AND** both surfaces share the same `roughness=0.55`
  default

### Requirement: Material system supports overrides for per-surface variance

`useMaterial(materialClass, color, overrides?)` SHALL accept an
`overrides` argument of partial shape extending the
`MaterialPreset` type. Common overrides include `roughness` (±0.10
within class), `metalness` (±0.10 within class), `thickness` (for
glass), `clearcoat` and `clearcoatRoughness` (for leather), and
`envMapIntensity`. Overrides SHALL NOT change the material
component type — `useMaterial('wood', color, { transmission: 0.5 })`
SHALL ignore `transmission` (or throw in dev) because wood is
`meshStandardMaterial`, not `meshPhysicalMaterial`.

#### Scenario: Glass thickness override applies

- **WHEN** `useMaterial('glass', sc.partition, { thickness: 0.05 })`
  is invoked
- **THEN** the returned material has `thickness === 0.05`
- **AND** all other glass defaults remain (transmission=0.78,
  roughness=0.18, ior=1.5)

#### Scenario: Wood with transmission override is ignored or throws

- **WHEN** in development mode `useMaterial('wood', sc.desk,
  { transmission: 0.5 })` is invoked
- **THEN** the call throws an error referencing the
  meshStandardMaterial does not support transmission
- **WHEN** in production mode the same call is invoked
- **THEN** the override is silently ignored and the resulting
  material has no transmission property
