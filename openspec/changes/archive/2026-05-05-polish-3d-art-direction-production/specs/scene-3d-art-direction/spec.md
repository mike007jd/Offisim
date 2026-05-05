# scene-3d-art-direction Specification

## ADDED Requirements

### Requirement: Office 3D SHALL use production scene art tokens

The 3D scene SHALL use color tokens from `Scene3DColors` for floor tiles, alternate floor bands, floor grid, wall panels, wall trim, zone rugs, zone labels, work mats, cable accents, character shoes/hands, and brand-neutral surfaces. Scene components SHALL NOT invent one-off art colors when a token exists.

#### Scenario: Scene art tokens exist
- **WHEN** importing `Scene3DColors`
- **THEN** it exposes `floorTile`, `floorTileAlt`, `floorGrid`, `floorBorder`, `wallPanel`, `wallTrim`, `wallShadow`, `zoneRug`, `zoneLabelBg`, `zoneLabelText`, `labelGlow`, `workMat`, `cableAccent`, `characterShoe`, `characterHand`, and `brandNeutral`

### Requirement: RoomShell SHALL render a layered office shell

The Office 3D scene SHALL render the room shell through `scene-room-shell.tsx`. The shell SHALL include a base floor, subtle tile grid, floor bands, back wall panels, side wall depth, and base trim. The scene SHALL NOT rely on a single high-contrast `gridHelper` as the main visual structure.

#### Scenario: Office3DView uses production RoomShell
- **WHEN** auditing `Office3DView.tsx`
- **THEN** it imports `RoomShell` from `scene-room-shell`
- **AND** the Canvas contains one `RoomShell` instance

### Requirement: Zones SHALL read as operational rugs, not debug rectangles

Zone surfaces SHALL use the art-direction opacity policy from `scene-art-direction.ts`. Drag, hover, source, and active states SHALL be visually distinct without overwhelming furniture or employees.

#### Scenario: Hovered drop zone has stronger treatment
- **WHEN** an employee is being dragged over a valid target zone
- **THEN** the zone rug opacity is stronger than idle
- **AND** the border opacity is stronger than non-hover drag targets

#### Scenario: Compact zone labels avoid constrained-view overlap
- **WHEN** the Office 3D Canvas is rendered in a narrow mobile viewport or a panel-constrained desktop viewport
- **THEN** long system zone labels use compact display text where needed
- **AND** the visible zone label rectangles do not overlap

### Requirement: Prefab templates SHALL have visible production differences

Prefab rendering SHALL not collapse every prefab in a category into an identical visible object. At minimum, `workstation-compact`, `workstation-dual`, `server-rack-4u`, `gpu-cluster`, and `meeting-table-4` SHALL render visibly different scale or composition from their default category peer.

#### Scenario: GPU cluster is not a single server rack
- **WHEN** rendering a compute prefab with template `gpu-cluster`
- **THEN** the 3D renderer composes multiple rack units instead of returning the same single rack used for `server-rack-2u`

### Requirement: Employee and brand bodies SHALL use the scene material system

Internal employee geometry and brand-managed external employee geometry SHALL use `SceneMaterial` for standard PBR-like surfaces. `meshBasicMaterial` remains allowed for invisible placeholders and deliberately unlit emissive screens or LEDs.

#### Scenario: Default BlockCharacter has material-system surfaces
- **WHEN** auditing `character-mesh-builder.tsx`
- **THEN** legs, shoes, torso, arms, hands, head, hair, vest, eyes, and mouth use `SceneMaterial`

#### Scenario: Brand variants use material-system surfaces
- **WHEN** auditing `office3d-brand-variants.tsx`
- **THEN** Hermes, OpenClaw, Codex, and Custom visible body surfaces use `SceneMaterial`

### Requirement: Office and Appearance preview SHALL use stable PCF shadows

Office 3D Canvas and Appearance preview Canvas SHALL set `THREE.PCFShadowMap` on the renderer. They SHALL NOT use the deprecated `THREE.PCFSoftShadowMap` for the production 3D art surface.

#### Scenario: Office Canvas sets PCF shadows
- **WHEN** `Office3DView` Canvas is created
- **THEN** `gl.shadowMap.type === THREE.PCFShadowMap`

#### Scenario: Appearance preview Canvas sets PCF shadows
- **WHEN** `AppearanceTab` 3D preview Canvas is created
- **THEN** `gl.shadowMap.type === THREE.PCFShadowMap`
