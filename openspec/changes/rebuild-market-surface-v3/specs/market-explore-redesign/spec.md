## MODIFIED Requirements

### Requirement: Market listing card surfaces a cover hero, kind chip, install state, and creator identity

The Market Explore card SHALL be a dense V3 inventory chip (height `h-market-listing-card`, `--r-md` radius, `--line-soft` border, `--elev-1`). Its cover SHALL be an **88px band** that renders a kind-specific cover visualization keyed off `listing.kind` (always present) — `kv-employee` (gradient avatar + skill tags), `kv-skill` (permission risk strip + capability glyphs), `kv-sop` (DAG progress pips + role sequence), `kv-template` / `company_template` (role color ribbon), `kv-layout` / `office_layout` (floor-plan sketch), `kv-prefab` (isometric geometry line drawing), `kv-bundle` (overlapping contents stack). The band SHALL be tinted by the rarity surface alias (`--rcs`); the featured variant SHALL use a rarity radial-gradient cover. The card SHALL NOT render a full-bleed 16:9 SaaS image hero. When no kind visualization applies (legacy / spec-thumbnail state), the cover SHALL fall back to the icon-only tile (`48×48` kind icon on an `--accent-surface` / `--rcs` tile centered in the band) — never empty space and never a broken-image marker. A curated/featured listing whose preview is content-fit MAY additionally render a small thumb (`≤ 96×64`, not full-bleed) alongside the icon tile.

The card SHALL overlay the kind chip on the cover, and SHALL overlay an `Installed` badge when the active company has the listing installed (matched by either `listing_id` or `package_id::version`). The card SHALL show the creator handle + a verification dot when the creator is `verified` or `trusted`, and a stats row (stars in `--warn`, install count in mono, creator handle). A rarity accent (per the rarity CSS-var aliases, `var(--rc)`) SHALL render as a top stripe.

#### Scenario: Card renders a kind-specific cover visualization by default

- **WHEN** a listing is rendered in the Explore grid
- **THEN** the card cover SHALL render the per-kind cover visualization (`kv-<kind>`) keyed off `listing.kind` in an 88px band, tinted by the rarity surface alias
- **AND** the kind chip SHALL overlay the cover
- **AND** the card SHALL NOT render a full-bleed 16:9 image hero

#### Scenario: Cover falls back to icon-only tile when no kind visualization applies

- **WHEN** a listing has no applicable kind visualization (legacy / spec-thumbnail state)
- **THEN** the card SHALL render the icon-only fallback (`48×48` kind icon on an `--rcs` / `--accent-surface` tile centered in the 88px band)
- **AND** SHALL NOT show empty space or a broken-image marker

#### Scenario: Curated listing may show a small thumb

- **WHEN** a listing is curated/featured with a content-fit preview
- **THEN** the card MAY render an optional `≤ 96×64` thumb (not full-bleed) alongside the icon tile

#### Scenario: Installed badge survives catalog re-seed

- **WHEN** the active company has an `installed_packages` row matching the listing's `package_id` and `latest_version`
- **AND** the listing's `listing_id` has rotated since install (e.g. catalog re-seed)
- **THEN** the card SHALL still render the `Installed` badge

## ADDED Requirements

### Requirement: Market card grid SHALL use the V3 dense density

The card grid SHALL use `grid-template-columns: repeat(auto-fill, minmax(252px, 1fr))` with `14px` gap and `--sp-7` (16px) padding. A featured listing SHALL span two columns (`grid-column: span 2`) and its cover band SHALL use the rarity radial-gradient treatment. There SHALL be no full-bleed image hero strip ≥ 80px tall on routine cards (the 88px cover band carries the per-kind visualization, not a SaaS image hero).

#### Scenario: Grid is dense auto-fill

- **WHEN** the Explore grid renders
- **THEN** columns auto-fill at `minmax(252px, 1fr)` with 14px gap and `--sp-7` padding

#### Scenario: Featured card spans two columns

- **WHEN** a listing is marked featured
- **THEN** its card SHALL span two grid columns and render the rarity radial-gradient cover

### Requirement: Market filter bar SHALL use segmented chip-grammar without native select chrome

The filter bar (48px main row) SHALL render the kind and sort controls as segmented controls in the V3 container-grammar (`--line` border, `--r-md`, inner 28–30px segments with `--surface-sunken` hover), replacing the `ui-core` `Select` triggers that currently expose native `<select>` arrow chrome. The mode control and the manage-tab control are ALREADY `EntityDropdown` (not native `<select>`); they SHALL be restyled to the same V3 chip-grammar (custom 12×12 chev-down SVG, no native arrow), and SHALL keep their `EntityDropdown` semantics. No native `<select>` arrow chrome SHALL appear anywhere in the filter bar.

#### Scenario: No native select arrow

- **WHEN** auditing the filter bar
- **THEN** kind/sort/mode/manage-tab SHALL render as segmented chips with no native `<select>` arrow; any disclosure uses the custom chev SVG

#### Scenario: Mode and manage-tab keep EntityDropdown semantics

- **WHEN** the mode control or the manage-tab control is restyled to V3 chip-grammar
- **THEN** it SHALL continue to use `EntityDropdown` (already non-native) with its existing `onSelect` / `onModeChange` / `onManageTabChange` contract intact

### Requirement: Market detail SHALL open as a right side-panel at 440px

In the desktop/tablet tier, selecting a listing SHALL open `MarketDetailView` as a right side-panel fixed at 440px (detail head 48px) sliding in over the retained listing grid. This replaces the current two-column fr split (`grid-market-detail-desktop` = `minmax(0, 3fr) minmax(23.75rem, 2fr)`, `grid-market-detail-tablet` = `minmax(0, 3fr) minmax(21.25rem, 2fr)`) rendered by the `MarketPage` detail-open branch. The detail content (carousel / changelog / requirements / lineage) is unchanged. The narrow tier retains full-screen drill-in.

#### Scenario: Detail slides in as a 440px right panel

- **WHEN** the user selects a listing at desktop/tablet width
- **THEN** the detail SHALL open as a fixed 440px right side-panel; the listing grid SHALL remain on the left
- **AND** the detail SHALL NOT use the two-column fr split

### Requirement: Market rarity SHALL be expressed via CSS-var aliases

Rarity SHALL be expressed via CSS-var aliases keyed by kind: employee → accent, skill → violet, sop/prefab → warn, company_template → violet, office_layout → danger, bundle → ink-3 (fallback ink-3). Each alias SHALL carry a paired surface alias (`--r-<kind>-s` → the kind's surface token, e.g. `--accent-surface`, `--violet-surface`, fallback `--surface-sunken`). The card SHALL consume the resolved rarity color (`var(--rc)`) for its top stripe and badge, and the rarity surface (`var(--rcs)`) for the cover-band tint.

#### Scenario: Rarity color maps by kind

- **WHEN** a card of a given kind renders
- **THEN** its rarity stripe/badge color SHALL resolve through the `--r-<kind>` alias (e.g. employee → accent, skill → violet, bundle → ink-3)
- **AND** its cover-band tint SHALL resolve through the paired `--r-<kind>-s` surface alias

### Requirement: V3 Market redo SHALL preserve install singularity and dual installed-identity matching

The V3 redo SHALL NOT change install behavior: `INSTALLABLE_KINDS` remains `['employee','skill']`; the detail install CTA stays gated on `INSTALLABLE_KINDS.has(detail.kind)`; `useInstalledListings` and the `market.listing-installed` event remain the installed-state SSOT; and `MarketplaceDetailOverlay` (deep-link `offisim://install`) is retained unchanged. The single install entry continues to route through `useInstallFlow().startRegistryInstall` (Market detail CTA + deep-link) and `startFileImport` (file sideload).

Because the V3 redo touches install-badge wiring, the `MarketPage` detail-open branch SHALL pass BOTH `installedListingIds` AND `installedPackageKeys` to its `MarketCardGrid` (the no-detail branch already passes both), so the `Installed` badge survives catalog re-seed while the detail panel is open.

#### Scenario: Install entry unchanged

- **WHEN** viewing a non-installable kind's detail (e.g. office_layout)
- **THEN** no install CTA renders, consistent with `INSTALLABLE_KINDS`
- **AND** the deep-link install overlay continues to function

#### Scenario: Installed badge survives re-seed with detail panel open

- **WHEN** the detail side-panel is open and the listing grid is rendered on the left
- **THEN** `MarketCardGrid` SHALL receive both `installedListingIds` and `installedPackageKeys`
- **AND** a card whose `listing_id` rotated since install (re-seed) SHALL still render `Installed` via the `package_id::version` match
