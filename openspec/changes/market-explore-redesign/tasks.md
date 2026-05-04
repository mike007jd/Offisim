# Tasks — market-explore-redesign

## 1. UI Card / Detail / Manage Published

- [x] 1.1 `<MarketListingCard>` — 16:9 cover hero from `listing.preview` (image|icon kind, kind icon fallback when no cover); kind chip + Installed badge overlay on cover; creator + verification dot below cover. Card height grew 220 → 260 to fit cover.
- [x] 1.2 `<MarketDetailView>` — screenshot carousel from `detail.previews[]` filtered to image|icon, prev/next + dot navigation when ≥2 images. Section helper for repeated border-top + uppercase label block.
- [x] 1.3 Detail Changelog section from `detail.version.changelog` when present; null-safe.
- [x] 1.4 Detail Requirements section: capabilities + MCPs + recommended_models chip strips; null-safe.
- [x] 1.5 Detail Lineage section: origin_package_id / forked_from_version / derivative_of; null-safe.
- [x] 1.6 Detail Creator: `display_name @handle` + verification dot; Published date row from `version.published_at`.
- [x] 1.7 New `<PublishedDraftsList>` wires `RegistryClient.listMyDrafts()` with auth gating (unauth / loading / error / empty / list states + tone-tokened status chips for draft / validated / submitted / approved / rejected).

## 2. Platform catalog API

- [x] 2.1 Search route (`/v1/market/search`) batch-fetches first preview per listing (sort_order ASC) alongside versions + tags. Returns `preview` on each `ListingSummary`.
- [x] 2.2 Search route emits `package_id` on `ListingSummary` from joined latestVersion row.
- [x] 2.3 Detail + search routes normalise preview kind from platform seed enum (`'hero' | 'screenshot' | 'icon'`) to client contract (`'icon' | 'image' | 'video' | 'readme'`). `hero / screenshot → image`, others passthrough.
- [x] 2.4 `OfficialSeedPayload` type gains optional `changelog` / `requirements` / `lineage`. package-builder threads `requirements.recommended_models` + `lineage` into manifest; official-seed.ts threads `changelog` into `package_versions.changelog` column.
- [x] 2.5 Sample Marketing Strategist seed enriched: 3 previews (hero + 2 screenshot SVGs) + changelog + 3 required_capabilities + 2 recommended_models + lineage (origin_package_id + derivative_of).

## 3. Install-state matcher (archive blocker)

- [x] 3.1 `ListingSummary` (registry-client) gains optional `package_id`.
- [x] 3.2 `MarketListingInstalledPayload` (shared-types) gains optional `packageId` + `version`.
- [x] 3.3 `marketListingInstalled` factory propagates `packageId` + `version`. `install-service.ts` (employee terminal path) emits with `plan.manifest.package.{id, version}`. `skill-loader.ts` (skill marketplace path) emits with `row.version`.
- [x] 3.4 `useInstalledListings` returns BOTH `installedListingIds` (back-compat) AND `installedPackageKeys` (`package_id::version` set). Hook seeds package keys from `installedPackages.{package_id, version}` initial load; new event subscriber adds key when payload carries `{packageId, version}`.
- [x] 3.5 `<MarketCardGrid>` / `<MarketDetailView>` / `<MarketplaceDetailOverlay>` match on either listingId OR packageKey; an installed package whose listing UUID rotated still renders `Installed`.

## 4. Verify-infra

- [x] 4.1 `apps/platform/package.json` dev script prebuilds `@offisim/db-platform` so tsx watch doesn't immediately fail on missing dist post-`pnpm clean`.
- [x] 4.2 `scripts/run-clean-release.mjs` boots platform :4100 before web :5176 and release `.app` open. `killOffisimPlatform` + `killPort(platformPort)` sweep, `startPlatformDev` streams logs to `output/run-action-platform-dev.log`, `waitForHttpOk` polls `/health` (45 s timeout).

## 5. Live verify

- [x] 5.1 release `.app` Market workspace loads 6 official cards, Sample Marketing Strategist shows real hero cover overlay.
- [x] 5.2 release `.app` Detail page renders carousel (3 image previews, prev/next/dot), Changelog, Requirements (3 caps + 2 models), Lineage (origin + derivative_of), Creator row with verification.
- [x] 5.3 release `.app` Manage Published — unauth state confirmed by clean profile; authenticated state confirmed with 5 verify draft rows (`bucket9-live-verify` creator, draft / validated / submitted / approved / rejected). Real platform `/v1/publish/drafts` rendering, not mocked.
- [x] 5.4 release `.app` archive blocker re-verify — without manual `origin_listing_id` edit, Sample Marketing Strategist card auto-shows `Installed`, detail CTA renders disabled `Installed`, install click no longer triggers UNIQUE constraint failure.
- [x] 5.5 Evidence in `.live-verify/bucket-9/verify-record.md` (READY TO ARCHIVE) + screenshots `01-market-cards.png` … `11-manage-published-draft-rows-statuses.png`.

## 6. Documentation + archive gate

- [x] 6.1 9-bucket queue (`memory/project_ux_9_bucket_queue.md`) marks 桶 9 archived with this change name.
- [x] 6.2 Protocols ledger: no protocol touched.
- [x] 6.3 OpenSpec Archive Gate three-check: spec consistency / tasks consistency / docs consistency.
- [ ] 6.4 Run `/opsx:archive market-explore-redesign`.
