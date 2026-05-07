# scene-3d-art-direction Specification

## Purpose
Defines the production art direction contract for the Office 3D scene: scene shell, zones, employees, prefab furniture, utility rooms, and default system-zone layout SHALL read as a polished procedural office diorama without relying on external 3D assets.
## Requirements
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

Prefab rendering SHALL not collapse every prefab in a category into an identical visible object. The 3D dispatcher SHALL prefer exact `prefabId` matches before category fallback so semantic furniture is not misrendered by broad category. At minimum, `workstation-compact`, `workstation-dual`, `server-rack-4u`, `gpu-cluster`, `meeting-table-4`, `sofa-set`, `coffee-table`, `vending-machine`, `water-cooler`, `chair-standalone`, and `reading-table` SHALL render visibly different scale or composition from their default category peer.

#### Scenario: GPU cluster is not a single server rack
- **WHEN** rendering a compute prefab with template `gpu-cluster`
- **THEN** the 3D renderer composes multiple rack units instead of returning the same single rack used for `server-rack-2u`

#### Scenario: Rest area prefabs keep rest semantics
- **WHEN** rendering a prefab with `prefabId === 'sofa-set'`
- **THEN** the 3D dispatcher SHALL render a lounge sofa composition
- **AND** it SHALL NOT fall through to the collaboration meeting-table renderer

#### Scenario: Rest-area single furniture has dedicated geometry
- **WHEN** rendering `coffee-table`, `vending-machine`, `water-cooler`, or `chair-standalone`
- **THEN** each prefab SHALL render a dedicated procedural 3D model matching its product meaning
- **AND** the renderer SHALL NOT collapse them into a generic decorative placeholder

#### Scenario: Library reading furniture has dedicated geometry
- **WHEN** rendering `reading-table`
- **THEN** the 3D renderer SHALL show a reading table with reading-room affordances
- **AND** nearby standalone chairs SHALL face the table by default

### Requirement: System default zones SHALL use polished functional layouts

System default zones SHALL use a versioned prefab layout shared by company creation, prefab materialization, renderer defaults, and existing-company repair. The layout SHALL make each zone's purpose legible at the default camera view: development/product/design workspaces show oriented workstations and planning furniture; library shows bookshelves and reading tables; rest area shows sofa, coffee table, vending/water, and plants; meeting room shows meeting table and whiteboard; server room shows racks, switch/patch hardware, and cable trays.

#### Scenario: Existing companies receive one system-zone reflow
- **WHEN** a company has no current `systemPrefabLayoutVersion` equal to the production layout version
- **THEN** system-zone prefab instances SHALL be replaced with the current production default layout
- **AND** employees, roles, SOPs, chat/runtime data, and non-system zones SHALL remain untouched
- **AND** the company policy SHALL record the applied layout version after the repair

#### Scenario: New companies use the same layout as repaired companies
- **WHEN** a company is created from a template without explicit zone-level `defaultPrefabs`
- **THEN** its system-zone prefab instances SHALL be generated from the shared production layout
- **AND** workspace seat counts SHALL account for the employees assigned to each workspace zone

### Requirement: Whiteboards SHALL render as aligned physical objects

Whiteboard and board-like scene objects SHALL render a single coherent panel assembly. The visible board surface, frame, tray, markers, and stand/wall-mount structure SHALL share the same rotation so the frame cannot visually drift away from the panel.

#### Scenario: Meeting room whiteboard has aligned frame and board
- **WHEN** rendering the meeting-room `whiteboard` prefab at any supported rotation
- **THEN** the board panel, frame bars, tray, and marker details SHALL rotate together
- **AND** the user SHALL see a bordered board rather than a disconnected frame/panel pair

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
