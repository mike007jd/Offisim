# market-listing-installed-state Specification

## Purpose
The Market workspace surfaces, per active company, whether each listing of an installable kind (`employee` / `skill`) has been installed locally on this device. The signal is derived from local persistence (`installedPackages.origin_listing_id` for employees; `skills.source_kind = 'marketplace'` AND `source_ref` for skills) and is orthogonal to the platform-global `install_count` popularity indicator. The Market UI reflects the installed state on the detail-view install button, on the listing card via an `Installed` badge, and refreshes event-driven when an install pipeline reaches its terminal state — without requiring a route navigation, page reload, or workspace re-mount. Active company switches re-derive the set against the new company so stale state from the previous company never leaks into the new view.

## Requirements
### Requirement: Market UI SHALL surface per-company local installed state

The Market workspace UI SHALL surface, for every listing of an `INSTALLABLE_KINDS` kind (`employee` / `skill`), whether that listing has been installed into the **currently active company** on the local device. This signal SHALL be computed from the local persistence sources (`installedPackages.origin_listing_id` for `employee`; `skills` rows where `source_kind = 'marketplace'` AND `source_ref = listingId` for `skill`) and SHALL be independent of the platform-global `install_count` indicator.

The signal SHALL be expressed as:

- **Detail view button**: when installed, button label SHALL be `Installed` and SHALL be visually disabled (no further click action wired in this Requirement). When not installed, button SHALL render the existing `Install` label.
- **Listing card badge**: when installed, the card SHALL render an `Installed` badge alongside the existing `formatInstallCount(install_count)` line. Both signals coexist; the platform-global `install_count` SHALL NOT be replaced or hidden.
- **Detail view metadata row `Installs`**: SHALL continue to display the platform-global `detail.install_count`. This Requirement explicitly preserves that signal as a global popularity indicator distinct from local installed state.

#### Scenario: Detail view button reflects locally installed employee
- **WHEN** the active company has an `installedPackages` row whose `origin_listing_id === listing.listing_id` and `kind === 'employee'`
- **THEN** the Market detail view for that listing SHALL render the install button with label `Installed` and disabled visual state
- **AND** SHALL NOT permit a re-install click from this surface

#### Scenario: Detail view button reflects locally installed skill
- **WHEN** the active company has a `skills` row where `source_kind = 'marketplace'` AND `source_ref = listing.listing_id`
- **THEN** the Market detail view SHALL render the install button as `Installed` and disabled

#### Scenario: Detail view button shows Install when not installed locally
- **WHEN** the active company has neither an `installedPackages` row matching `origin_listing_id` nor a `skills` row matching `source_ref` for the given listing
- **THEN** the Market detail view SHALL render the existing `Install` button

#### Scenario: Listing card badge surfaces installed state in grid
- **WHEN** the Market grid renders any listing for which the active company has the corresponding installed row
- **THEN** the card SHALL render an `Installed` badge
- **AND** SHALL continue to render the platform-global `formatInstallCount(install_count)` line unchanged

#### Scenario: install_count remains a platform-global popularity signal
- **WHEN** the Market detail view renders the metadata row labeled `Installs`
- **THEN** that row SHALL display `formatInstallCount(detail.install_count)` from the platform listing payload
- **AND** SHALL NOT be substituted by, or conflated with, the local installed state

### Requirement: Market UI SHALL refresh installed state on install completion

When a Market install pipeline reaches the installed terminal state for either supported kind, the Market workspace UI SHALL update the per-company installed-state set without requiring a manual page refresh, route navigation, or workspace re-mount. The refresh SHALL be event-driven, not polling.

The two install pipelines SHALL emit a `market.listing-installed` event when (and only when) the install was sourced from a Market listing:

- **Employee pipeline** (`packages/install-core/src/install-service.ts`): SHALL emit `market.listing-installed` when the install state machine reaches the `installed` terminal state AND the install transaction's recovered listing id is non-null.
- **Skill pipeline** (`packages/core/src/skills/skill-loader.ts` `installSkill`): SHALL emit `market.listing-installed` when the install completes with `source.kind === 'marketplace'`.

Event payload shape (added to `packages/shared-types/src/events/`):

```ts
type MarketListingInstalledEvent = {
  companyId: string;
  listingId: string;
  kind: 'employee' | 'skill';
  installedPackageId?: string; // employee path
  skillId?: string;            // skill path
};
```

The Market workspace hook (`useMarketplace.ts` or sibling) SHALL subscribe to this event once and incrementally update its `installedListingIds: Set<string>` for matching `companyId === activeCompanyId`. Out-of-band updates (events arriving while a different company is active) SHALL NOT mutate the active set.

#### Scenario: Detail view button flips after employee install completes
- **WHEN** the user clicks `Install` on a Market detail view for an `employee` listing AND the install pipeline reaches `installed` terminal state
- **THEN** the install pipeline SHALL emit `market.listing-installed` with `kind: 'employee'` and the listing's `listing_id`
- **AND** the Market detail view (still mounted) SHALL transition the button to `Installed` + disabled within the same UI tick that processes the event
- **AND** SHALL NOT require a route navigation or page reload

#### Scenario: Detail view button flips after skill install completes
- **WHEN** the user clicks `Install` on a Market detail view for a `skill` listing AND `installSkill` completes with `source.kind === 'marketplace'`
- **THEN** `installSkill` SHALL emit `market.listing-installed` with `kind: 'skill'` and the listing's `listing_id`
- **AND** the Market detail view button SHALL transition to `Installed` + disabled without manual refresh

#### Scenario: Card badge appears after install completes
- **WHEN** an install completes (either pipeline) for a listing currently rendered in the Market grid
- **THEN** the card for that listing SHALL render the `Installed` badge in response to the same `market.listing-installed` event

#### Scenario: Event for non-active company does not mutate active set
- **WHEN** a `market.listing-installed` event arrives whose `companyId` does not match the currently active company
- **THEN** the active `installedListingIds` set SHALL NOT change
- **AND** no UI re-render SHALL be triggered for the active Market view

### Requirement: Skill marketplace install SHALL NOT emit the event for non-marketplace sources

`installSkill` accepts multiple source kinds (`marketplace` / `git` / `upload` / `fork` / `self-authored`). Only the `marketplace` source SHALL emit `market.listing-installed`. Non-marketplace skill installs SHALL NOT trigger any Market UI state change, since they have no listing to map to.

#### Scenario: Git skill install does not emit market event
- **WHEN** `installSkill` completes with `source.kind === 'git'`
- **THEN** no `market.listing-installed` event SHALL be emitted

#### Scenario: Forked skill install does not emit market event
- **WHEN** `installSkill` completes with `source.kind === 'fork'`
- **THEN** no `market.listing-installed` event SHALL be emitted

### Requirement: Active company switch SHALL re-derive installed state

When the active company changes, the Market workspace UI SHALL re-derive the `installedListingIds` set against the new company. Stale state from the previous company SHALL NOT persist into the new company's view.

#### Scenario: Switching company resets installed-state set
- **WHEN** the user switches from company A (with installed listing X) to company B (without X installed)
- **THEN** the Market detail view for listing X SHALL render the `Install` button (not `Installed`)
- **AND** the card grid SHALL NOT render the `Installed` badge on listing X

#### Scenario: Initial company load populates installed-state set
- **WHEN** the Market workspace mounts under an active company
- **THEN** `installedListingIds` SHALL be populated by querying both local persistence sources (`installedPackages.listByCompany` for `employee`, skills repo for marketplace-sourced rows) before any `market.listing-installed` event arrives
- **AND** any listing already installed prior to this session SHALL show the correct `Installed` state on first render
