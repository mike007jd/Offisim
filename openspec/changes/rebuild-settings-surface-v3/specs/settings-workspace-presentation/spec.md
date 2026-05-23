## MODIFIED Requirements

### Requirement: Settings tab body has at most one visual container layer

The V3 model REVERSES the prior flat-divider IA. Each Settings tab body — Provider / Runtime / MCP / External — SHALL render every section as its own single-layer `.card-block` (border `--line-soft` + background `--surface-1` + `--r-md` radius + `--elev-1` + 16px internal padding; adjacent card-blocks separated by `--sp-3`). Sibling card-blocks within a tab body are the V3 norm (the prior "at most one visual container per tab" cap is retired in favor of per-section card-blocks). The Settings workspace shell itself counts as zero. `SettingsSection` (defined in this spec) is the primitive that produces the per-section card-block.

Nesting SHALL be forbidden: a `.card-block` or `SurfaceCard` SHALL NOT contain another visual container (no card-in-card, no `ui-core/Card` or hand-rolled `rounded-[20px]` inner card; no element chain producing 3 or more nested borders). The desktop-only `VaultDirectorySection` remains a permitted standalone `SurfaceCard` (an independent config entity) and SHALL NOT be wrapped inside another card-block.

#### Scenario: Provider tab sections are sibling card-blocks without nesting
- **WHEN** the user opens Settings → Provider tab at viewport `1440x900`
- **THEN** each section renders as its own single-layer `.card-block` (`--line-soft` border + `--surface-1` + `--r-md` + `--elev-1`)
- **AND** no `.card-block`/`SurfaceCard` contains another visual container (no 3-deep nested borders)
- **AND** the previously inline `div.rounded-[20px]` "Resolved product" inner card SHALL NOT exist

#### Scenario: Runtime tab keeps VaultDirectorySection as a standalone entity
- **WHEN** the user opens Settings → Runtime tab at viewport `1440x900`
- **THEN** the desktop-only `VaultDirectorySection` renders as a standalone `SurfaceCard` not nested inside another card-block
- **AND** the other Runtime sections render as sibling card-blocks

#### Scenario: MCP tab has no nested cards
- **WHEN** the user opens Settings → MCP tab at viewport `1440x900`
- **THEN** configured-server groups render within card-blocks with no nested `ui-core/Card`
- **AND** there SHALL be no element chain producing 3 or more nested borders inside the MCP tab

#### Scenario: External tab body uses flat list rows
- **WHEN** the user opens Settings → External Employees tab
- **THEN** individual external-employee row containers SHALL use `rounded-lg` flat list rows (not `SurfaceCard` per row)

### Requirement: SettingsSection primitive is the canonical row separator

A `SettingsSection` primitive SHALL be exported from `packages/ui-office/src/components/settings/settings-primitives.tsx` with the signature `SettingsSection({ title, description?, action?, children })`. Under the V3 model `SettingsSection` is no longer a bare top-divider; it produces a per-section card-block. The rendered DOM SHALL be a `<section>` that:

- Renders `title` as a V3 caps label (`--fs-micro`, uppercase, `--ls-caps` tracking, weight ~680, `--ink-3`)
- Renders `description` (when provided) as a muted line under the label
- Renders `action` (when provided) right-aligned in the header row (e.g., a "Connect agent" button)
- Wraps `children` in a single `.card-block` (border `--line-soft`, background `--surface-1`, `--r-md` radius, `--elev-1`, 16px padding)

`SettingsSection` SHALL use light tokens only. The implementation currently uses the resolved light token `border-border-default` for borders (NOT the dark-theme literal `border-white/5`); the V3 card-block border SHALL map to `--line-soft`. The card-block is the section's single container layer; `SettingsSection` SHALL NOT introduce a second nested container.

#### Scenario: SettingsSection exports the documented signature
- **WHEN** auditing `packages/ui-office/src/components/settings/settings-primitives.tsx`
- **THEN** the file SHALL export `SettingsSection` with props `{ title: string; description?: string; action?: React.ReactNode; children: React.ReactNode }`

#### Scenario: SettingsSection wraps children in a light card-block
- **WHEN** inspecting the rendered DOM of any `SettingsSection`
- **THEN** the children are wrapped in a `.card-block` with `--line-soft` border, `--surface-1` background, `--r-md` radius, `--elev-1`, and 16px padding
- **AND** no dark-theme token (e.g. `border-white/5`) is used

#### Scenario: SettingsSection used as the dominant Settings layout primitive
- **WHEN** grepping `packages/ui-office/src/components/settings/Settings{Provider,Runtime}Tab.tsx` and `McpConfigPanel.tsx` for `<SettingsSection`
- **THEN** there SHALL be at least 2 `<SettingsSection>` usages in `SettingsRuntimeTab.tsx`
- **AND** at least 1 `<SettingsSection>` usage in `SettingsProviderTab.tsx`
- **AND** at least 2 `<SettingsSection>` usages in `McpConfigPanel.tsx`

### Requirement: Provider tab uses single resolved-product summary line

`SettingsProviderTab.tsx` SHALL render the currently selected product as a single inline summary row at the top of the right column, NOT as a hand-written `div.rounded-[20px]` inner card nested inside its section's card-block. The summary row SHALL include the product display name and a tone chip (using the canonical `Badge` primitive from `@offisim/ui-core`) indicating access mode. The "Advanced routing" SettingsSection SHALL appear exactly once at the bottom of the right column.

Under the V3 model the summary row lives inside a section card-block alongside its sibling sections; this requirement only forbids a *second* nested visual container (the old `rounded-[20px]` inner card) within that card-block — it does NOT forbid the section card-block itself.

#### Scenario: Resolved product is inline summary, not a nested card
- **WHEN** auditing `SettingsProviderTab.tsx` at the location formerly housing the `div.rounded-[20px]` inner card
- **THEN** the resolved-product display SHALL be a single `<div>` with text + `<Badge>` tone chip
- **AND** SHALL NOT introduce a second border + background + `border-radius >= 12px` container nested inside the section card-block

#### Scenario: Advanced routing renders exactly once
- **WHEN** auditing `SettingsProviderTab.tsx` for the literal string "Advanced routing" (case-insensitive)
- **THEN** the string SHALL appear exactly once as a `SettingsSection` title

#### Scenario: Provider double-column layout density
- **WHEN** the user opens Settings → Provider at viewport `1440x900`
- **THEN** all Provider configuration fields (product picker + access mode + API key + endpoint override + default model + default headers + execution lane + Advanced routing) SHALL be visible without vertical scroll inside the tab body
- **AND** the `xl:grid-cols-[340px_minmax(0,1fr)]` two-column layout (Tailwind v4 underscore arbitrary syntax) SHALL be active at viewport ≥ 1280, fitting within the 720px content column

### Requirement: Runtime tab merges defaults and memory groups

`SettingsRuntimeTab.tsx` SHALL render the runtime configuration as `SettingsSection` rows (plus the standalone `VaultDirectorySection` on desktop), each row being its own card-block:

- `SettingsSection "Runtime defaults"` SHALL contain: execution mode, tool search, git auto-commit, display density, and employee runtime default (`RuntimeBindingControl scope="company"`). Fields SHALL use a dense grid layout (`md:grid-cols-2 xl:grid-cols-3`).
- `SettingsSection "Conversation memory & summarization"` SHALL contain: memory configuration and summarization configuration, with H4 sub-headings to differentiate sub-groups but no additional `SurfaceCard` border nested inside the section card-block.

Under the V3 model these `SettingsSection` rows render as sibling card-blocks (the prior "exactly two rows with no additional `SurfaceCard` borders" intent is preserved as "no nested card-in-card inside a section"; sibling card-blocks are the V3 norm and are not a violation). The display-density toggle SHALL use the canonical `SegmentedControl` primitive from `@offisim/ui-core`. Repeated boolean Selects SHALL be expressed via a shared `BooleanSelect` helper; repeated numeric inputs SHALL be expressed via a shared `NumberField` helper.

#### Scenario: Runtime tab renders SettingsSection rows as card-blocks
- **WHEN** the user opens Settings → Runtime tab
- **THEN** runtime configuration renders as `SettingsSection` rows, each as its own card-block
- **AND** `RuntimeBindingControl scope="company"` SHALL be inside the "Runtime defaults" SettingsSection

#### Scenario: Runtime defaults uses dense grid
- **WHEN** the "Runtime defaults" SettingsSection renders at viewport `1440x900`
- **THEN** its inner field grid SHALL apply `xl:grid-cols-3` (or denser)

#### Scenario: Memory and summarization share one SettingsSection
- **WHEN** auditing `SettingsRuntimeTab.tsx`
- **THEN** memory fields and summarization fields SHALL be inside the same `SettingsSection` card-block, differentiated only by H4 sub-headings, NOT by a separate `SurfaceCard` container nested inside it

### Requirement: Settings Provider and Runtime use workspace width in release

This requirement is REVERSED by the V3 model and SHALL adopt a centered content column. Phase 8 (commit `dbb2bde9`) dropped the `max-w-5xl` centered wrapper so Provider/Runtime would fill workspace width; the V3 design re-introduces a centered content column, but as a wider, intentional reading measure rather than the old narrow clamp.

Settings tabs SHALL render with the outer content area filling the available Settings workspace width (no large unused right gutter caused by an *outer* wrapper), while the inner content column SHALL be centered and capped at `720px` (see "Settings left nav SHALL be 244px and content SHALL cap at 720px"). The argument for the reversal: the V3 surface is a focused configuration form, not a data grid; a centered 720px reading column reads as deliberate composition, and the Provider two-column grid (`xl:grid-cols-[340px_minmax(0,1fr)]`) still fits within 720px at ≥1280. The `720px` cap therefore SHALL coexist with full-width outer chrome (full-width outer save-bar footer, full-width scroll region) and SHALL NOT reproduce the old narrow `max-w-5xl` (1024px) centered clamp around the entire surface.

#### Scenario: Provider tab outer fills, inner column centered at 720
- **WHEN** Settings → Provider is opened in release `.app` at desktop width
- **THEN** the outer content scroll region and save-bar footer span the available workspace width (no `max-w-5xl` outer clamp)
- **AND** the inner configuration column is centered and capped at 720px

#### Scenario: Runtime grids span the 720 column
- **WHEN** Settings → Runtime is opened in release `.app` at desktop width
- **THEN** Runtime defaults and Conversation memory & summarization controls use responsive multi-column grids within the centered 720px column
- **AND** the layout does not reproduce the old narrow `max-w-5xl` centered clamp

#### Scenario: Section density remains professional
- **WHEN** the user scans Provider or Runtime in release `.app`
- **THEN** vertical section gaps remain compact enough for repeated operational use (adjacent card-blocks separated by `--sp-3`)
- **AND** Settings sections do not nest cards inside cards

## ADDED Requirements

### Requirement: Settings left nav SHALL be 244px and content SHALL cap at 720px

The Settings left nav SHALL be 244px wide. The Settings content area SHALL constrain its inner column to a max-width of 720px (centered within the available content width, so wide viewports do not sprawl); the nav width is excluded from this cap. The sticky save bar SHALL remain in `SettingsContentArea` (hidden on External), and the content scroll area SHALL keep reserving bottom padding for it. To match the V3 prototype (`.save-bar-inner { max-width: 720px; margin: 0 auto }`), the save bar's outer chrome (border-top + background + footer padding) SHALL span the full workspace width while its inner control column SHALL be centered and capped at 720px so the Save button aligns with the centered content column above it.

#### Scenario: Nav width and content cap
- **WHEN** Settings renders at a wide viewport
- **THEN** the left nav is 244px and the content inner column is capped at 720px (centered), not full-bleed
- **AND** the sticky save bar's outer chrome spans full width while its inner control column is centered at 720px, aligned with the content column
- **AND** the sticky save bar remains visible without covering the last control
