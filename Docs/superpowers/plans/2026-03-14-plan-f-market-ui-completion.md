# Plan F: Market UI Completion (Rating + Report + Download History)

> **File ownership:** `apps/market/src/app/listing/[slug]/page.tsx`, `packages/ui-market/src/`, `apps/platform/src/routes/`. Does NOT touch packages/core, packages/renderer, packages/ui-office.

**Goal:** Add the 3 missing marketplace UI features: rating submission, content reporting, and download/install history.

---

## Task 1: Rating Submit UI

**Files:**
- Create: `packages/ui-market/src/components/ReviewForm.tsx`
- Modify: `apps/market/src/app/listing/[slug]/page.tsx` (add review form section)
- Modify: `packages/ui-market/src/index.ts` (export)

**Spec:**
Platform API already has `POST /v1/market/listings/:listingId/reviews` (routes/market.ts).

ReviewForm component:
- Star rating selector (1-5 stars, clickable)
- Text comment textarea (optional, max 500 chars)
- Submit button → calls `POST /v1/market/listings/:listingId/reviews` with auth token
- Show success toast on submit, disable form after submission
- Only visible to authenticated users (check useAuth)
- Show "Already reviewed" if user has existing review

Integration in listing detail page:
- Add ReviewForm below existing reviews section
- Conditionally render based on auth state

- [ ] Step 1: Create ReviewForm component with star selector + comment
- [ ] Step 2: Integrate into listing detail page
- [ ] Step 3: Commit

---

## Task 2: Report/Takedown UI

**Files:**
- Create: `packages/ui-market/src/components/ReportDialog.tsx`
- Modify: `apps/market/src/app/listing/[slug]/page.tsx` (add report button)
- Modify: `packages/ui-market/src/index.ts` (export)

**Spec:**
Platform has moderation service. Need `POST /v1/market/listings/:listingId/reports` endpoint + UI.

API (if not exists, create):
- `POST /v1/market/listings/:listingId/reports` — body: `{ reason: string, details?: string }`
- Reasons enum: 'spam' | 'malicious_code' | 'copyright' | 'misleading' | 'other'
- Authenticated only

ReportDialog:
- Trigger: small "Report" link/button on listing detail page (subtle, not prominent)
- Dialog with reason selector (radio buttons) + optional details textarea
- Submit → POST report → close dialog + show confirmation toast
- Rate limited: 1 report per user per listing

- [ ] Step 1: Add report API endpoint to platform if missing (apps/platform/src/routes/market.ts)
- [ ] Step 2: Create ReportDialog component
- [ ] Step 3: Add report button to listing detail page
- [ ] Step 4: Commit

---

## Task 3: Download/Install History

**Files:**
- Create: `apps/market/src/app/dashboard/history/page.tsx`
- Create: `packages/ui-market/src/components/HistoryList.tsx`
- Modify: `packages/ui-market/src/index.ts` (export)

**Spec:**
Platform already has `GET /v1/install/library` endpoint that returns user's install receipts.

HistoryList component:
- Table/list showing: listing title, version, install date, status
- Link each row to the listing detail page
- Sort by install date (newest first)
- Empty state: "No installations yet"

Dashboard history page:
- Protected route (require auth)
- Fetch from `/v1/install/library` via RegistryClient
- Render HistoryList

- [ ] Step 1: Create HistoryList component
- [ ] Step 2: Create dashboard/history page
- [ ] Step 3: Commit

---

## Verification
- [ ] `pnpm run typecheck --filter market --filter @aics/ui-market`
- [ ] `pnpm run build --filter market`
- [ ] Review form submits successfully
- [ ] Report dialog opens and submits
- [ ] History page shows install records
