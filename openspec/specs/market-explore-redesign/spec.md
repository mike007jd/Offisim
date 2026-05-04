# market-explore-redesign Specification

## Purpose

Define the visual + data contract for the Market Explore card grid, the Market detail panel, the Manage workspace `Published` tab, and the cross-surface installed-state lookup. Covers card cover/preview rendering, kind chip + installed badge overlays, creator identity, detail carousel / changelog / requirements / lineage sections, live publish-draft listing with auth gating, install identity matching by `(package_id, version)` (not just `listing_id`), and platform-side preview-kind normalisation at the HTTP boundary so seed enum values render correctly client-side.

## Requirements

### Requirement: Market listing card surfaces a cover hero, kind chip, install state, and creator identity

The Market Explore card SHALL render a 16:9 cover hero from the
listing's first preview when `listing.preview` resolves to a normalised
`image` or `icon` kind. When no cover is present, the card SHALL
render the kind icon as a visual fallback, never empty space. The card
SHALL overlay the kind chip on the cover, and SHALL overlay an
`Installed` badge when the active company has the listing installed
(matched by either `listing_id` or `package_id::version`). Below the
cover, the card SHALL show the creator handle and a verification dot
when the creator is `verified` or `trusted`.

#### Scenario: Cover renders for a listing with image preview

- **WHEN** the search response carries `listing.preview = { kind: 'image', url: '…' }`
- **THEN** the card SHALL render the image as the 16:9 cover hero
- **AND** the kind chip SHALL overlay the cover top-left

#### Scenario: Card without preview falls back to kind icon

- **WHEN** the search response carries `listing.preview = null`
- **THEN** the card SHALL render the kind icon centred on the cover band
- **AND** SHALL NOT show empty space or a broken-image marker

#### Scenario: Installed badge survives catalog re-seed

- **WHEN** the active company has an `installed_packages` row matching the listing's `package_id` and `latest_version`
- **AND** the listing's `listing_id` has rotated since install (e.g. catalog re-seed)
- **THEN** the card SHALL still render the `Installed` badge

### Requirement: Market detail surfaces carousel / changelog / requirements / lineage when data is present

The Market detail panel SHALL render a screenshot carousel when
`detail.previews[]` contains at least one entry of normalised kind
`image` or `icon`. When ≥2 such entries exist, the carousel SHALL
expose previous / next controls and dot navigation. The detail panel
SHALL render a Changelog section when `detail.version.changelog` is a
non-empty string, a Requirements section when at least one of
`required_capabilities` / `required_mcps` / `recommended_models` is
non-empty, and a Lineage section when `lineage.origin_package_id` /
`forked_from_version` / `derivative_of` carries data. Each section
SHALL be null-safe — the section component returns null when its data
is empty, never renders a stub header.

#### Scenario: Carousel navigates between three screenshots

- **WHEN** `detail.previews[]` has 3 image-kind entries
- **THEN** the carousel SHALL show prev / next arrows and 3 navigation dots
- **AND** clicking next SHALL advance the active dot by one position

#### Scenario: Changelog section hidden when absent

- **WHEN** `detail.version.changelog` is `null` or empty
- **THEN** no Changelog section SHALL render
- **AND** the visual layout SHALL not show a stub header

#### Scenario: Requirements chip strips render only present rows

- **WHEN** `requirements.required_capabilities` has entries but `required_mcps` is empty
- **THEN** the Requirements section SHALL render the Capabilities row only
- **AND** SHALL NOT render an empty MCPs row

### Requirement: Manage 'Published' tab is wired to live publish drafts with auth gating

The Manage workspace's `Published` sub-tab SHALL replace the previous
empty placeholder with a list backed by
`RegistryClient.listMyDrafts()`. The component SHALL gate on
`client.hasAuthToken`: when no auth token is available, the unauth
state SHALL show a "Sign in to view your drafts" hint with a brief
explanation, NOT a generic empty state. While loading, the component
SHALL render a skeleton; on error it SHALL render an `EmptyState` with
the failure message; on empty success it SHALL direct the user to the
Publish toolbar action. Each draft row SHALL show title + summary +
kind + updated date + a status chip, with tone tokens covering
`draft / validated / submitted / approved / rejected`.

#### Scenario: Unauth state renders sign-in hint

- **WHEN** the active session has no marketplace auth token
- **THEN** the Published tab SHALL render `Sign in to view your drafts`
- **AND** SHALL NOT render an empty list or a generic placeholder

#### Scenario: Authenticated state shows real drafts

- **WHEN** the user has 5 drafts in `draft / validated / submitted / approved / rejected` statuses
- **THEN** the tab SHALL render 5 rows
- **AND** each row's status chip SHALL use the matching tone token

### Requirement: Install identity matches by package_id+version, not just listing_id

The Market UI's installed-state surface SHALL match a listing as
installed when **either** the listing's `listing_id` is in the active
company's `installedListingIds` set **or** the
`(listing.package_id, listing.latest_version)` pair is in the
`installedPackageKeys` set. This is required because catalog re-seeds
rotate `listing_id` UUIDs while the `(package_id, version)` pair
remains stable (matching the `installed_packages_company_pkg_ver`
unique index). The `useInstalledListings` hook SHALL return both
sets; downstream consumers (`MarketListingCard`,
`MarketDetailView`, `MarketplaceDetailOverlay`) SHALL check both.

#### Scenario: Installed badge persists after catalog re-seed

- **WHEN** an official listing was installed yesterday (origin_listing_id = OLD-UUID)
- **AND** today the platform creator was deleted and re-seeded (new listing_id = NEW-UUID, same package_id + version)
- **THEN** the Market card for the same package SHALL render `Installed`
- **AND** the Detail Install CTA SHALL render disabled `Installed`
- **AND** clicking install SHALL NOT trigger a UNIQUE constraint failure on `(company_id, package_id, version)`

### Requirement: Platform preview kind is normalised at the API boundary

The market HTTP routes SHALL normalise `listing_previews.kind` to the
registry-client API contract (`'icon' | 'image' | 'video' | 'readme'`)
before serialising responses. The platform DB stores an internal
seed-side enum `{'hero', 'screenshot', 'icon'}`; routes SHALL map
`'hero'` and `'screenshot'` to `'image'`, SHALL pass `'icon'` through,
and SHALL map unknown values to `'image'`. Both search and detail
endpoints SHALL apply this normalisation so client-side filters
(`p.kind === 'image' || p.kind === 'icon'`) correctly select seeded
preview rows.

#### Scenario: Seed hero rendered as image client-side

- **WHEN** the platform has a `listing_previews` row with `kind = 'hero'`
- **THEN** `/v1/market/search` and `/v1/market/listings/:id` SHALL return that preview with `kind: 'image'`
- **AND** the detail carousel filter `image|icon` SHALL match it
