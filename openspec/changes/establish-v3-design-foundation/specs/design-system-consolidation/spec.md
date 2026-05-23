## MODIFIED Requirements

### Requirement: Visual tokens are constrained on touched surfaces

Touched surfaces SHALL use the design system spacing, radius, border, typography, color, shadow, z-index, and motion tokens from `@offisim/ui-core/tokens` (the canonical SSOT defined by the `design-token-foundation` capability). Tokens SHALL NOT be re-authored locally as JS objects, CSS custom properties, or arbitrary Tailwind values on touched surfaces.

Large all-caps labels, monospaced text, heavy glass effects, and accent (cyan / blue) highlights SHALL be reserved for metadata, active states, or high-priority status rather than applied uniformly across an entire screen.

Touched surfaces SHALL NOT contain raw hex literals (`#xxxxxx` outside the SSOT or catalog), arbitrary Tailwind shadow values (`shadow-[...]`), arbitrary Tailwind z-index values (`z-[...]`), or hard-coded transition/animation timings that do not reference `MOTION_DURATION` / `MOTION_EASING`. The `pnpm tokens:lint-hex` CI gate SHALL enforce this on the entire `apps/desktop/renderer/src/`, `packages/ui-office/src/`, `packages/ui-core/src/components/`, `packages/ui-core/src/lib/`, `packages/ui-core/src/hooks/`, and `packages/renderer/src/` source trees.

The V3 app is light-only (per `theme-light-dark-switching` and `design-token-foundation`). Touched surfaces SHALL render correctly in the single resolved `light` theme. When a touched component uses a semantic token (e.g. `bg-surface`, `text-text-primary`), the value SHALL resolve to its V3 light value without any per-component `dark:` variant authoring. Intentional-dark surfaces (Studio, and — once Phase 8 migrates them — the lifecycle wizard surfaces) are explicit exceptions that render dark via dedicated tokens (`DARK_SEMANTIC_COLORS` / `--wiz-*`) that do not depend on a `.dark` CSS class; they are not required to also render in light.

#### Scenario: Primary content is not all metadata styling

- **WHEN** a touched workspace renders primary headings, form labels, or action text
- **THEN** the text uses normal readable casing and standard typography unless it is metadata

#### Scenario: Accent color indicates priority

- **WHEN** an accent color appears on a touched screen
- **THEN** it is sourced from `accent` / `accentMuted` / `accentText` / `accentHover` semantic tokens (not from a literal hex or a Tailwind palette literal like `cyan-400`) AND it indicates active selection, primary action, status, or focused control rather than decorating every card equally

#### Scenario: Touched surface tokens come from the SSOT

- **WHEN** auditing the source files of any touched surface for design token consumption
- **THEN** colors / shadows / spacing / radius / typography / motion / z-index values are imported from `@offisim/ui-core/tokens` or applied via Tailwind utility classes whose variables are defined in `apps/desktop/renderer/src/generated/tailwind-theme.css`

#### Scenario: Touched surface renders correctly in the light-only theme

- **WHEN** a touched surface renders in the light-only app
- **THEN** every visible element repaints with the V3 light variant — no element stays at a previous theme's color, no element becomes unreadable due to a missing variant — and no `:root.dark` scope is required for it to be legible

#### Scenario: Intentional-dark exception surfaces

- **WHEN** an intentional-dark surface (Studio, or the lifecycle wizard surfaces after Phase 8) renders under the light-only app
- **THEN** it resolves its palette from `DARK_SEMANTIC_COLORS` / `--wiz-*` tokens that do not depend on a `.dark` CSS class, and it is exempt from the "renders in the light theme" requirement

#### Scenario: No raw hex on touched surfaces

- **WHEN** running `pnpm tokens:lint-hex` after a touched surface change is committed
- **THEN** the gate exits with code 0 — no raw hex literal exists in the touched files outside `// raw-hex-allowed` escape hatches

#### Scenario: No arbitrary z-index or shadow on touched surfaces

- **WHEN** grepping touched surface files for `z-\[\d+\]` or `shadow-\[`
- **THEN** zero matches — touched surfaces use named `z-base` / `z-elevated` / `z-sticky` / `z-dropdown` / `z-modal` / `z-top` and `shadow-resting` / `shadow-hover` / `shadow-popover` / `shadow-overlay` / `shadow-modal` / `shadow-glow-{accent,success,warning,error}` Tailwind utilities
