## MODIFIED Requirements

### Requirement: `colors-3d.ts` SHALL define complete light and dark variants for every 3D scene color

`Scene3DColors` SHALL include the following fields:

**3D and shared scene fields**: `floor`, `desk`, `deskEdge`, `furniture`, `furnitureDark`, `furnitureLight`, `partition`, `screen`, `metal`, `serverBody`, `ledCyan`, `ledGreen`, `ledBlue`, `ledAmber`, `potBase`, `leafPrimary`, `leafSecondary`, `leafTertiary`, `text`, `textMuted`, `selectionRing`, `sceneBackground`, `wallShell`, `bookSpine`, `cableChannel`, `vendingScreen`, `tableReading`, `whiteboardSurface`, `whiteboardMarker`, `accentWarm`, `accentCool`, `floorTile`, `floorTileAlt`, `floorGrid`, `floorBorder`, `wallPanel`, `wallTrim`, `wallShadow`, `zoneRug`, `zoneLabelBg`, `zoneLabelText`, `labelGlow`, `workMat`, `cableAccent`, `characterShoe`, `characterHand`, and `brandNeutral`.

**2D canvas-only fields** (added by the `scene-2d-theme-tokens` capability): `canvasBackground`, `canvasGrid`, `deskSurface`, `deskScreen`, `deskBezel`, `pillBg`, `pillBgStroke`, `pillText`, `dotRing`, `nameLabelMuted`, `meetingBubbleBg`, `meetingBubbleStroke`, `meetingBubbleTitle`, `meetingBubbleParticipantText`, `meetingBubbleWaitingText`, `meetingBubbleExtraText`, `managerMarkerFill`, `managerMarkerStroke`, `managerMarkerLabel`, `selectionRing2D`, `dragGhostShadow`, `prefabSilhouetteDegraded`, `stateBadgeBg`, `stateBadgeStroke`, `stateBadgeText`, `stateBadgeBgBlocked`, `stateBadgeStrokeBlocked`, `stateBadgeTextBlocked`, `stateBadgeBgSuccess`, `stateBadgeStrokeSuccess`, `stateBadgeTextSuccess`.

Both `LIGHT_SCENE_3D` and `DARK_SCENE_3D` SHALL be complete `Record<keyof Scene3DColors, string>` objects covering both groups.

`STATE_COLORS_LIGHT` and `STATE_COLORS_DARK` SHALL each be a `Record<EmployeeState, number>` (numeric hex form — `0xRRGGBB`) covering all 12 employee states defined in `@offisim/shared-types`.

Legacy `DARK_SCENE_3D` fields that existed before the 3D art-direction pass SHALL remain byte-equivalent to today's `DARK_SCENE` constant in `packages/ui-office/src/theme/use-scene-colors.ts`; added art-direction fields and the new 2D-canvas-only fields SHALL be explicit token values in both light and dark variants.

The new 2D-canvas-only `DARK_SCENE_3D` field values SHALL be byte-equivalent to today's hard-coded literals in `packages/ui-office/src/components/scene/Office2DCanvasView.tsx`, `packages/ui-office/src/components/scene/canvas-primitives.ts`, and `packages/ui-office/src/components/scene/canvas-layers/*.ts`, preserving dark-mode visual continuity (e.g., `canvasBackground = '#020617'`, `pillBg = '#1e293b'`, `managerMarkerStroke = '#a855f7'`).

`STATE_COLORS_DARK` SHALL be byte-equivalent to today's `STATE_COLORS` in `packages/renderer/src/tokens/colors.ts` — no field values change in dark mode.

`CATEGORY_COLORS_LIGHT` and `CATEGORY_COLORS_DARK` SHALL each be a `Record<'workspace'|'compute'|'knowledge'|'collaboration'|'infrastructure'|'decorative', string>`. `CATEGORY_COLORS_DARK` SHALL be byte-equivalent to today's `STUDIO_COLORS.cat*` fields.

#### Scenario: Dark scene legacy byte-equivalence

- **WHEN** comparing `DARK_SCENE_3D.floor` to today's `DARK_SCENE.floor` value `#253347`
- **THEN** the values are identical
- **AND** the same byte equivalence holds for every legacy `Scene3DColors` field

#### Scenario: Light scene completeness

- **WHEN** iterating over `LIGHT_SCENE_3D`
- **THEN** every contracted field (3D, shared, and 2D-canvas-only) is present with a non-empty color string

#### Scenario: 2D canvas-only dark byte-equivalence

- **WHEN** comparing `DARK_SCENE_3D.canvasBackground` to today's `BACKGROUND_COLOR` literal `#020617` in `canvas-layers/draw-background.ts`
- **THEN** the values are identical
- **AND** the same byte equivalence holds for every other 2D-canvas-only field's pre-tokenization literal

#### Scenario: STATE_COLORS_DARK preserves existing 3D ring colors

- **WHEN** comparing `STATE_COLORS_DARK.idle` to today's `STATE_COLORS.idle` value `0x94a3b8`
- **THEN** the values are identical
- **AND** the same byte equivalence holds for every other `EmployeeState`

### Requirement: No raw color / shadow / z-index / motion literals SHALL exist outside the SSOT

Source files under `apps/web/src/`, `packages/ui-office/src/`, `packages/ui-core/src/components/`, `packages/ui-core/src/lib/`, `packages/ui-core/src/hooks/`, and `packages/renderer/src/` SHALL NOT contain:

- A 3-, 4-, 6-, or 8-digit hex literal (`#[0-9a-fA-F]{3,8}\b`) except inside `// raw-hex-allowed`-tagged lines
- A Tailwind arbitrary z-index (`z-\[\d+\]`)
- A Tailwind arbitrary shadow (`shadow-\[`)
- An inline `zIndex: <digits>` style prop with a value not corresponding to a `Z_INDEX_SCALE` named layer
- A `transition: '...[\d.]+s'` or `animation: '...[\d.]+(s|ms)'` literal whose duration is not derived from `MOTION_DURATION`

Exempt locations: `packages/ui-core/src/tokens/**`, `apps/web/src/generated/**`, `catalog/provider-source-registry/**`, and any line tagged with the trailing comment `// raw-hex-allowed`.

The file-level escape hatch `// raw-hex-allowed-file: ...` SHALL be limited to files outside the 2D office canvas pipeline. Specifically, the 11 files listed in the `scene-2d-theme-tokens` capability — `Office2DCanvasView.tsx`, `office-2d-canvas-renderer.ts`, `office-2d-render-registry.ts`, `canvas-primitives.ts`, and `canvas-layers/draw-{background,zones,prefabs,employees,ceremony,interactions,drag-overlay}.ts` — SHALL NOT carry that header. Other files that today carry `// raw-hex-allowed-file:` (Studio canvas, ZoneCanvas, PrefabThumbnail, company-creation-wizard-preview, 3D mesh prefabs, `office3d-*.ts(x)`, `office3d-shared.ts`) keep the exemption pending separate scoped work.

The CI gate `pnpm tokens:lint-hex` SHALL enforce this rule. The gate SHALL print every offending file path, line, and matched literal, and SHALL exit non-zero on any match.

#### Scenario: Lint gate exits clean on a compliant tree

- **WHEN** running `pnpm tokens:lint-hex` on the post-migration codebase
- **THEN** the script exits with code 0 and prints a brief "no violations found" summary

#### Scenario: Lint gate catches a regression

- **WHEN** a developer adds `style={{ color: '#ff0000' }}` to any file under `packages/ui-office/src/` without the `// raw-hex-allowed` comment
- **THEN** `pnpm tokens:lint-hex` exits non-zero and the offending location appears in stdout

#### Scenario: Lint gate respects the line-level escape hatch

- **WHEN** a line reads `const PLACEHOLDER = '#abcdef'; // raw-hex-allowed`
- **THEN** the gate skips that line and does not report a violation

#### Scenario: 2D office canvas files are no longer file-level exempt

- **WHEN** grepping the 11 files listed in the `scene-2d-theme-tokens` capability for `^// raw-hex-allowed-file:`
- **THEN** zero matches exist, and `pnpm tokens:lint-hex` runs the full per-line gate over those files
