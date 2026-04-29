## ADDED Requirements

### Requirement: WorkspacePageShell loading skeleton SHALL match ready-state floor per workspace

`WorkspacePageShell.LoadingSkeleton` SHALL reserve a `min-height` equal to the active workspace's known ready-state floor. The reservation SHALL be expressed via the CSS custom property `--workspace-min-content-height` declared in `workspace-shell.css` keyed off the `data-workspace` attribute.

Per-workspace floors:

- `office`: `540px`
- `personnel`: `600px`
- `sops`: `540px`
- `market`: `480px`
- `activity-log`: `600px`
- `settings`: `480px`
- Default fallback (any workspace not yet listed): `480px`

The skeleton's outer block SHALL apply class `workspace-shell-loading-region` whose CSS resolves to `min-height: var(--workspace-min-content-height)`.

#### Scenario: Personnel loading reserves 600 px

- **WHEN** Personnel workspace renders with `loading=true` at 1440x900
- **THEN** `getComputedStyle(skeletonOuterBlock).minHeight` SHALL be `'600px'`
- **AND** the loading→ready transition SHALL NOT shift the page

#### Scenario: Office loading reserves 540 px

- **WHEN** Office workspace renders with `loading=true` at 1440x900
- **THEN** `getComputedStyle(skeletonOuterBlock).minHeight` SHALL be `'540px'`

#### Scenario: Default fallback applies to unknown workspace

- **WHEN** a workspace renders with `data-workspace` not yet declared in `workspace-shell.css`
- **THEN** the skeleton SHALL apply `min-height: 480px` via the `.workspace-shell` default
- **AND** loading SHALL NOT collapse to zero or unreserve space

### Requirement: Web shell SHALL preload custom fonts with font-display: swap

`apps/web/index.html` SHALL contain `<link rel="preload" as="font" type="font/woff2" crossorigin>` tags for every custom font referenced by `apps/web/src/index.css` `@font-face` declarations. Each font SHALL be served from a same-origin path under `/fonts/` so the Tauri release `.app` running from `tauri://localhost` can load it without CSP allowlist changes.

Each `@font-face` block SHALL declare `font-display: swap` so first-paint uses system fallback and the swap to the custom font is non-blocking.

After this change the web shell SHALL preload:

- `Inter` variable woff2 (`/fonts/inter-var.woff2`), weight `100 900`, Latin + Latin Extended subset, ≤ 110 KB.
- `JetBrains Mono` variable woff2 (`/fonts/jetbrains-mono-var.woff2`), weight `100 800`, Latin subset, ≤ 80 KB.

Combined preload payload SHALL be ≤ 200 KB.

#### Scenario: Web index.html preloads both fonts

- **WHEN** loading `apps/web/dist/index.html` after build
- **THEN** the document `<head>` SHALL contain `<link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin>`
- **AND** SHALL contain `<link rel="preload" href="/fonts/jetbrains-mono-var.woff2" as="font" type="font/woff2" crossorigin>`

#### Scenario: Both @font-face blocks declare font-display: swap

- **WHEN** auditing `apps/web/src/index.css` `@font-face` blocks
- **THEN** both Inter and JetBrains Mono blocks SHALL declare `font-display: swap`
- **AND** `src` URLs SHALL resolve to same-origin `/fonts/*.woff2` paths (no third-party CDN)

#### Scenario: First-paint FOUT is bounded

- **WHEN** loading the web shell at 1440x900 with cache disabled and Slow 3G throttle
- **THEN** the cumulative layout shift attributable to font swap SHALL be ≤ 0.10 measured by Chrome DevTools Performance trace
- **AND** the first contentful paint SHALL render text in system fallback within 100 ms after navigation start
- **AND** the font preload requests SHALL initiate ≤ 50 ms after navigation start

### Requirement: Responsive break SHALL preserve same height budget on both sides

When a workspace surface uses a responsive grid that swaps between layouts at the `lg` (1280 px) break, the surface SHALL maintain the same `min-height` budget for any tabbed content region on both sides of the break. Resizing the window across the break SHALL NOT cause the tabbed content's height to change.

This applies specifically to:

- Personnel page (`PersonnelPage.tsx:129`): the inspector's `min-h-[560px]` SHALL apply in both narrow (flex column) and desktop (3-column grid) tiers.

Future surfaces with responsive grids holding tabbed content SHALL document and preserve their height budget similarly.

#### Scenario: Personnel inspector keeps 560 px floor across 1280 px resize

- **WHEN** the user resizes the Personnel page window between 1270 px and 1290 px
- **THEN** the inspector tabs region SHALL maintain `min-height: 560px` on both sides of the break
- **AND** the page layout SHALL NOT change the inspector's height budget

#### Scenario: Narrow tier preserves height budget

- **WHEN** the viewport is < 1280 px and Personnel is open with an employee selected
- **THEN** the inspector pane in the stacked (flex column) layout SHALL apply `min-h-[560px]`
- **AND** the inspector SHALL NOT collapse below 560 px even if its current tab content is shorter
