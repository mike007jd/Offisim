# market-explore-redesign

## Why

桶 9 of the UX/IA 9-bucket queue (2026-05-02 live verify batch). Closes
issue #8 (Market重做) and the install-CTA half of #18 carried over from
桶 5 (`workspace-thread-architecture`). Previous Market surface was a
flat card grid + bare detail panel — no cover hero, no screenshot
carousel, no changelog / requirements / lineage; Manage 'published'
sub-tab was an empty placeholder. Live verify also surfaced a real
product bug: `useInstalledListings` matched by `origin_listing_id`
only, so a catalog re-seed (which rotates listing UUIDs) made
already-installed packages render as "Install", and the click hit a
backend `UNIQUE constraint failed (company_id, package_id, version)`.

## What Changes

UI:

- **MarketListingCard** — 16:9 cover hero from `listing.preview` (kind
  normalised to `image|icon`), kind chip + Installed badge overlay on
  the cover, creator handle + verification dot under the cover.
- **MarketDetailView** — screenshot carousel (prev / next + dot
  navigation when ≥2 image previews), Changelog section, Requirements
  section (capabilities + MCPs + recommended models with chip strips),
  Lineage section (origin / forked-from / derivative-of), Creator row
  with display_name + handle + verification dot, Published date row.
- **Manage Published tab** — new `<PublishedDraftsList>` wires
  `RegistryClient.listMyDrafts()` with auth gating (unauth → "Sign in
  to view your drafts"; loading skeleton; error EmptyState; rows show
  title + summary + kind + status chip with tone tokens).

Platform / API:

- **Search route** now batch-fetches first preview per listing
  alongside versions and tags; `ListingSummary` gains optional
  `package_id` from the joined latestVersion row.
- **Detail / Search routes** normalise preview kind from the platform
  seed enum (`'hero' | 'screenshot' | 'icon'`) to the registry-client
  contract (`'icon' | 'image' | 'video' | 'readme'`) — `hero /
  screenshot → image`, others passthrough.
- **OfficialSeedPayload** type gains optional `changelog` /
  `requirements` (capabilities + MCPs + recommended_models) /
  `lineage` (origin_package_id / forked_from_version / derivative_of).
  package-builder threads them into manifest; official-seed.ts
  threads `changelog` into `package_versions.changelog`.
- **Sample Marketing Strategist seed** enriched with 3 previews (1
  hero SVG + 2 screenshot SVGs), changelog, 3 required_capabilities,
  2 recommended_models, and lineage so all rich-detail branches have
  exercising data without requiring per-listing custom code.

Install identity (archive blocker):

- **`MarketListingInstalledPayload`** gains optional `packageId` +
  `version`. `marketListingInstalled` factory + `install-service`
  (employee path) + `skill-loader` (skill marketplace path) emit them
  on the same `market.listing-installed` event.
- **`useInstalledListings`** returns BOTH `installedListingIds`
  (back-compat) AND `installedPackageKeys` (`package_id::version`
  set). Card / DetailView / DetailOverlay match on either. Survives
  catalog re-seed where `listing_id` rotates but `package_id` does
  not.

Verify-infra:

- **`scripts/run-clean-release.mjs`** boots platform :4100 BEFORE web
  :5176 and the release `.app` open, with `kill+sweep` + `/health`
  poll. Was previously skipping platform → release `.app` showed
  Market = "Load failed".
- **`apps/platform/package.json`** dev script prebuilds
  `@offisim/db-platform` so post-`pnpm clean` runs don't fail on
  missing dist.

## Impact

- Affected capabilities: new `market-explore-redesign` capability with
  contract Requirements over Card / Detail / Manage Published surfaces
  + the install-state matching invariant.
- Affected code: `packages/ui-office/src/components/marketplace/*` +
  `packages/ui-office/src/hooks/useInstalledListings.ts` +
  `packages/registry-client/src/types.ts` +
  `packages/shared-types/src/events/install.ts` +
  `packages/core/src/events/install-events.ts` +
  `packages/core/src/skills/skill-loader.ts` +
  `packages/install-core/src/{install-service,types}.ts` +
  `apps/platform/src/{routes/market.ts, seed/*}.ts` +
  `scripts/run-clean-release.mjs` + `apps/platform/package.json`.
- Migration: none — single-baseline schema unchanged. Force
  catalog re-seed only required for verifiers who want fresh seed
  data (`psql -d offisim_platform -c "DELETE FROM creators WHERE
  handle='offisim';"` then restart platform).

## Out of Scope (deferred)

- Featured / curated collections (needs server catalog model).
- Categories filter (needs listing categorization).
- Version history surface (needs `/v1/listings/<id>/versions` UI
  binding via a `useListingVersions` hook).
- Search facet panel (kind / category / sort multi-facet expansion).
- PublishDialog UX overhaul (per queue's pending decision; tracked as
  separate change candidate).
- Backend idempotent install (graceful UNIQUE handling). The matcher
  fix means UI never offers Install for an already-installed package
  in normal use, so the hard error path is unreachable from the
  natural flow; if it ever surfaces, dedicated change.
