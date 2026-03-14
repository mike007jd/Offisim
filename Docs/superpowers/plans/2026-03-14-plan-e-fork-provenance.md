# Plan E: Fork Provenance Chain Completion

> **File ownership:** `apps/platform/src/routes/publish.ts`, `apps/platform/src/routes/market.ts`, `apps/platform/src/services/moderation.ts`, `apps/market/src/app/listing/[slug]/page.tsx` (fork button only, not rating/report). Does NOT touch packages/core/src/agents/, packages/renderer, packages/ui-office.

**Goal:** Complete the last 10% of fork provenance: write lineage records on publish, add fork query API, and add Fork button to marketplace.

**Context:** Fork provenance infrastructure is already 90% built:
- ✅ `ManifestLineage` types in asset-schema
- ✅ `packageLineage` table in db-platform (exists but never written to)
- ✅ `lineage_edges` table defined in SQL spec
- ✅ Listing detail page already displays lineage when present
- ✅ RegistryClient has `LineageSummary` type
- ❌ Publish flow doesn't create packageLineage records
- ❌ No API to query "who forked this listing"
- ❌ No Fork button/flow on marketplace

---

## Task 1: Write Lineage Records on Publish Approval

**Files:**
- Modify: `apps/platform/src/services/moderation.ts` (processModerationJob — add lineage insert)
- Modify: `apps/platform/src/routes/publish.ts` (if needed for lineage validation)

**Spec:**
In `processModerationJob()` (moderation.ts), after creating `packageVersions` row, also insert into `packageLineage` if the manifest contains lineage:

```typescript
// After inserting packageVersions...
if (manifest.lineage?.origin_listing_id || manifest.lineage?.origin_package_id) {
  await db.insert(packageLineage).values({
    lineage_id: crypto.randomUUID(),
    package_version_id: versionId,
    origin_listing_id: manifest.lineage.origin_listing_id ?? null,
    origin_package_id: manifest.lineage.origin_package_id ?? null,
    forked_from_version: manifest.lineage.forked_from_version ?? null,
  });
}
```

Validation: if `origin_listing_id` is provided, verify it exists in `listings` table. Return validation error if the referenced listing doesn't exist (prevents dangling references).

- [ ] Step 1: Add packageLineage insert to moderation approval flow
- [ ] Step 2: Add origin_listing_id existence validation
- [ ] Step 3: Tests for lineage record creation
- [ ] Step 4: Commit

---

## Task 2: Fork Query API

**Files:**
- Modify: `apps/platform/src/routes/market.ts` (add fork endpoints)

**Spec:**
Add two new endpoints:

1. `GET /v1/market/listings/:listingId/forks` — returns listings that forked from this listing
   - Query `packageLineage` WHERE `origin_listing_id = :listingId`
   - Join with `listings` to get fork listing details (title, slug, creator, version)
   - Return: `{ forks: Array<{ listingId, title, slug, creatorHandle, version, forkedAt }> }`

2. `GET /v1/market/listings/:listingId/lineage` — returns full lineage chain (ancestors + descendants)
   - Ancestors: follow `origin_listing_id` chain upward
   - Descendants: find all listings whose lineage points to this one
   - Return: `{ ancestors: [...], descendants: [...] }`
   - Limit depth to 10 levels to prevent infinite loops

- [ ] Step 1: Add GET /forks endpoint
- [ ] Step 2: Add GET /lineage endpoint with depth limit
- [ ] Step 3: Tests for both endpoints
- [ ] Step 4: Commit

---

## Task 3: Fork Button + Fork Count on Marketplace

**Files:**
- Modify: `apps/market/src/app/listing/[slug]/page.tsx` (add fork button + fork count + fork list)
- Create: `packages/ui-market/src/components/ForkButton.tsx`
- Create: `packages/ui-market/src/components/ForkList.tsx`
- Modify: `packages/ui-market/src/index.ts` (export)
- Modify: `packages/registry-client/src/client.ts` (add getListingForks method)
- Modify: `packages/registry-client/src/types.ts` (add ForkSummary type)

**Spec:**

ForkButton:
- "Fork" button on listing detail page (next to install button)
- Requires auth — if not logged in, show login prompt
- Click → navigates to `/dashboard/publish?fork_from={listingId}&fork_version={version}`
- The publish wizard should pre-fill manifest with lineage fields pointing to the source listing
- Fork count badge next to the button (fetched from /forks endpoint)

ForkList:
- Section on listing detail page showing "Forks of this asset" (if any exist)
- List of fork cards with title, creator, version
- Link each to its listing page
- Show "No forks yet" if empty

RegistryClient additions:
```typescript
async getListingForks(listingId: string): Promise<ForkSummary[]>
```

- [ ] Step 1: Add ForkSummary type and getListingForks to registry-client
- [ ] Step 2: Create ForkButton component
- [ ] Step 3: Create ForkList component
- [ ] Step 4: Integrate into listing detail page
- [ ] Step 5: Wire fork_from query param into publish wizard (pre-fill lineage)
- [ ] Step 6: Commit

---

## Verification
- [ ] `pnpm run typecheck --filter @aics/platform --filter market --filter @aics/ui-market --filter @aics/registry-client`
- [ ] `pnpm run test --filter @aics/platform --filter @aics/registry-client`
- [ ] `pnpm run build --filter market`
- [ ] Publish a package with lineage → verify packageLineage record created
- [ ] Query /forks endpoint → returns fork list
- [ ] Fork button visible on listing page
