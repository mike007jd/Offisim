## MODIFIED Requirements

### Requirement: No raw color / shadow / z-index / motion literals SHALL exist outside the SSOT

Source files under `apps/web/src/`, `packages/ui-office/src/`, `packages/ui-core/src/components/`, `packages/ui-core/src/lib/`, `packages/ui-core/src/hooks/`, and `packages/renderer/src/` SHALL NOT contain:

- A 3-, 4-, 6-, or 8-digit hex literal (`#[0-9a-fA-F]{3,8}\b`) except inside `// raw-hex-allowed`-tagged lines
- A Tailwind arbitrary z-index (`z-\[\d+\]`)
- A Tailwind arbitrary shadow (`shadow-\[`)
- An inline `zIndex: <digits>` style prop with a value not corresponding to a `Z_INDEX_SCALE` named layer
- A `transition: '...[\d.]+s'` or `animation: '...[\d.]+(s|ms)'` literal whose duration is not derived from `MOTION_DURATION`

Exempt locations: `packages/ui-core/src/tokens/**`, `apps/web/src/generated/**`, `catalog/provider-source-registry/**`, and any line tagged with the trailing comment `// raw-hex-allowed`.

The file-level escape hatch `// raw-hex-allowed-file: ...` SHALL be limited to files outside the 2D office canvas pipeline (per `scene-2d-theme-tokens` capability) AND outside the scene shell. Specifically, the 11 files listed in the `scene-2d-theme-tokens` capability AND `packages/ui-office/src/components/scene/SceneCanvas.tsx` SHALL NOT carry that header. The error-panel and fallback-badge surfaces of the scene shell are governed by the `scene-3d-performance-fallback` capability and consume `useSceneColors()` plus `@theme inline`-resolved Tailwind utilities.

Other files that today carry `// raw-hex-allowed-file:` (Studio canvas, ZoneCanvas, PrefabThumbnail, company-creation-wizard-preview, 3D mesh prefabs, `office3d-*.ts(x)`, `office3d-shared.ts`) keep the exemption pending separate scoped work.

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

#### Scenario: SceneCanvas.tsx is no longer file-level exempt

- **WHEN** grepping `packages/ui-office/src/components/scene/SceneCanvas.tsx` for `^// raw-hex-allowed-file:`
- **THEN** zero matches exist
- **AND** `pnpm tokens:lint-hex` runs the full per-line gate over that file
