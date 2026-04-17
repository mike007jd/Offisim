## ADDED Requirements

### Requirement: `DeliverableRepository` exposes bulk list-with-content query

`DeliverableRepository` SHALL expose a `listByCompanyWithContent(companyId: string, opts?: { threadId?: string; limit?: number }): Promise<DeliverableRow[]>` method that returns full rows (including `content`) in a single round-trip, sorted by `created_at DESC`, with the same default limit (100) as `listByCompany`. Drizzle and Tauri backends SHALL implement this via a single `SELECT *` SQL statement filtered by `company_id` (and optional `thread_id`). The memory backend SHALL traverse its row map and, if a `contentLoader` is registered, hydrate any missing content in parallel before returning.

The existing `listByCompany` (summary-only) SHALL remain for future listview scenarios that only need metadata; `listByCompanyWithContent` is the hydrate path for UI hooks.

#### Scenario: Single SQL call replaces N+1
- **WHEN** calling `repos.deliverables.listByCompanyWithContent('co-a', { limit: 10 })` against a drizzle or tauri backend with 10 matching rows
- **THEN** exactly one `SELECT` statement is executed (no per-row `findById`), and the returned array has 10 full rows each carrying a non-null `content` string

#### Scenario: Memory backend hydrates content via loader
- **WHEN** `MemoryDeliverableRepository` was constructed with a `contentLoader(id)` that returns IndexedDB-backed content AND 3 summary-only rows were seeded from snapshot
- **THEN** calling `listByCompanyWithContent('co-a')` returns 3 rows each with `content` populated from the loader (loader invoked exactly 3 times, in parallel), and any row whose loader returns null SHALL be returned with `content = ''` and a single `console.warn` for that `deliverable_id`

#### Scenario: Thread filter honored
- **WHEN** 4 rows exist for `company_id = 'co-a'` across 2 threads (`t-1`: 3, `t-2`: 1) and caller invokes `listByCompanyWithContent('co-a', { threadId: 't-1' })`
- **THEN** the returned array has exactly 3 rows, all with `thread_id = 't-1'` and full `content`, ordered by `created_at DESC`

#### Scenario: Default limit caps results
- **WHEN** 300 rows exist for `company_id = 'co-a'` and caller invokes `listByCompanyWithContent('co-a')` without `limit`
- **THEN** the returned array has exactly 100 rows — the 100 most recent — each with full `content`

### Requirement: Browser content store rides IndexedDB independent of the localStorage snapshot

Web-mode (non-Tauri) persistence SHALL decouple deliverable content bytes from the `MemoryRepositoriesSnapshot.deliverables` blob to avoid `localStorage` quota exhaustion. The web app SHALL write each `deliverable.created` event's `content` into an IndexedDB object store `deliverable_content` (database `offisim-runtime`), keyed by `deliverable_id`. The main snapshot written to `offisim:browser-runtime-snapshot:v1` SHALL carry only `DeliverableSummaryRow[]` (metadata + `content_size`) — not full rows.

A `createDeliverableContentBridge(eventBus)` helper in `apps/web/src/lib/browser-runtime-storage.ts` SHALL subscribe to `deliverable.created` and `await` the IDB write inside its handler. Its `dispose()` SHALL unsubscribe. On browsers where IndexedDB is unavailable (private mode fallback, very old engines), the bridge SHALL degrade gracefully: a single `console.warn` at construction, `contentLoader` returns `null` thereafter, and the session falls back to in-memory content with no persistence.

`MemoryRepositoriesSnapshot.deliverables` type SHALL be `DeliverableSummaryRow[]` (breaking from the H1 shape of `DeliverableRow[]`). On boot, `createBrowserRuntime` SHALL detect legacy snapshot rows carrying inline `content` (from pre-migration sessions) and write those bodies into IDB in a fire-and-forget background task so no data is lost during the transition.

#### Scenario: Snapshot excludes content bytes after migration
- **WHEN** the browser runtime has processed 5 `deliverable.created` events with ~100 KB content each and `createBrowserRuntimePersistence` has flushed
- **THEN** `JSON.parse(localStorage['offisim:browser-runtime-snapshot:v1']).deliverables` has 5 entries, each with a numeric `content_size` ≥ 100000, and NONE carries a `content` property; separately, the IDB `deliverable_content` store has 5 entries keyed by the same `deliverable_id`s, each containing the original content string

#### Scenario: Browser hydrates content from IDB on reload
- **WHEN** the browser tab is reloaded after a session that wrote 3 deliverables
- **THEN** `MemoryDeliverableRepository` is seeded from snapshot with 3 summary rows (content='') AND a subsequent `runtime.listRecentDeliverables()` call returns 3 rows each with `content` populated — the content was re-hydrated from IDB via `contentLoader`

#### Scenario: Legacy localStorage content migrates into IDB
- **WHEN** `createBrowserRuntime` boots against a pre-migration `offisim:browser-runtime-snapshot:v1` whose `deliverables[]` rows still carry inline `content` strings
- **THEN** each row's `content` is written into IDB `deliverable_content` store, and the next snapshot flush writes the new summary-only shape; no deliverable content is lost across the migration boundary

#### Scenario: IndexedDB unavailable degrades gracefully
- **WHEN** the browser refuses to open `offisim-runtime` IDB (private mode, unsupported engine, storage policy block)
- **THEN** `createDeliverableContentBridge` logs exactly one `console.warn`, `contentLoader` returns `null` for every `id`, live-session events still reach `useDeliverables` via in-memory cache, and the session simply loses content on refresh (same as pre-H1 behavior) — no exceptions surface to the UI

## MODIFIED Requirements

### Requirement: `DeliverableRepository` exposes list + find queries

`packages/core/src/runtime/repositories.ts` SHALL define a `DeliverableRepository` interface on `RuntimeRepositories.deliverables` (optional slot, mirroring the `userPreferences?` / `agentEvents?` pattern). The interface SHALL expose at least:

- `insert(row: NewDeliverable): Promise<void>` — idempotent insert, never throws on duplicate PK
- `findById(deliverableId: string): Promise<DeliverableRow | null>` — returns the full row including `content`
- `listByCompany(companyId: string, opts?: { threadId?: string; limit?: number }): Promise<DeliverableSummaryRow[]>` — returns rows sorted by `created_at DESC`, WITHOUT the `content` field (summary only: all metadata + `content_size` byte count). Default `limit` when unspecified SHALL be 100.
- `listByCompanyWithContent(companyId: string, opts?: { threadId?: string; limit?: number }): Promise<DeliverableRow[]>` — returns full rows (including `content`) sorted by `created_at DESC` in a single SQL call (or single Map scan + optional parallel content loader on the memory backend). Default `limit` when unspecified SHALL be 100.

`DeliverableRow` SHALL include all columns. `DeliverableSummaryRow` SHALL omit `content` and add `content_size: number`.

#### Scenario: listByCompany excludes content
- **WHEN** calling `repos.deliverables.listByCompany('co-a', { limit: 20 })`
- **THEN** the returned rows each have `content_size` (a non-negative integer) and SHALL NOT carry a `content` property

#### Scenario: findById returns full content
- **WHEN** calling `repos.deliverables.findById('dlv-1')` after the row was inserted with 50 KB content
- **THEN** the returned row's `content` field equals the originally inserted 50 KB string byte-for-byte

#### Scenario: listByCompany filters by thread
- **WHEN** three rows exist for `company_id = 'co-a'` across two threads (`t-1`: 2 rows, `t-2`: 1 row), and caller invokes `listByCompany('co-a', { threadId: 't-1' })`
- **THEN** the returned array has exactly 2 rows, both with `thread_id = 't-1'`, ordered by `created_at DESC`

#### Scenario: listByCompany default limit caps results
- **WHEN** 300 rows exist for `company_id = 'co-a'` and caller invokes `listByCompany('co-a')` without specifying `limit`
- **THEN** the returned array has exactly 100 rows — the 100 most recent by `created_at DESC`

### Requirement: `useDeliverables()` hydrates from repo on mount and merges live events

The `useDeliverables()` hook in `@offisim/ui-office` SHALL, on mount:

1. Call `runtime.listRecentDeliverables({ limit: 100 })` (exposed on the runtime context) and use the result as initial state
2. Subscribe to `eventBus.on('deliverable.created')` and merge incoming events into state

Merge semantics SHALL deduplicate by `deliverableId` (primary); a fallback composite key (`threadId + kind + fileName + content`) SHALL be used only when `deliverableId` is absent from an incoming event (defensive).

The runtime context SHALL expose `listRecentDeliverables(opts: { threadId?: string; limit?: number }): Promise<DeliverableHookRow[]>` that internally queries `repos.deliverables.listByCompanyWithContent(activeCompanyId, opts)` in a single round-trip — there SHALL NOT be an N+1 pattern of `listByCompany` + per-row `findById`. `loadDeliverableContent(id)` SHALL remain available for single-row refresh scenarios but is not on the default hydrate path.

#### Scenario: Hook initial render returns persisted history
- **WHEN** the hook mounts after an app restart where 5 rows exist for the active company
- **THEN** the hook's returned array contains those 5 entries sorted newest-first, with `contributingEmployees` populated and `artifact.content` fully hydrated (no lazy `findById` required)

#### Scenario: Live event merges with hydrated history
- **GIVEN** the hook has hydrated 3 historical entries
- **WHEN** a new `deliverable.created` event fires with `deliverableId: 'dlv-new'`
- **THEN** the hook's returned array contains 4 entries, `dlv-new` appears in position consistent with its `createdAt`, and no duplicate of `dlv-new` exists

#### Scenario: Event with known deliverableId does not duplicate
- **GIVEN** the hook has hydrated an entry `dlv-1` from history
- **WHEN** a `deliverable.created` event for `deliverableId: 'dlv-1'` arrives (race between hydrate and live)
- **THEN** the hook's returned array still contains exactly one entry for `dlv-1`

#### Scenario: Hydrate uses single round-trip on Tauri
- **WHEN** the Tauri desktop runtime has 20 deliverables stored in SQLite and `useDeliverables()` mounts
- **THEN** `listRecentDeliverables` triggers exactly one Tauri IPC SQL round-trip (via `listByCompanyWithContent`), NOT 1 + 20

### Requirement: Browser-only (non-Tauri) persistence rides the existing localStorage snapshot

When the web app runs outside Tauri (no `tauri-repos` wired), the active `RuntimeRepositories.deliverables` SHALL be the in-memory implementation. The existing `createBrowserRuntimePersistence` path in `apps/web/src/lib/browser-runtime-storage.ts` debounce-writes `repos.snapshot()` to `localStorage` under key `offisim:browser-runtime-snapshot:v1` and seeds new memory repos from that snapshot on boot. Deliverable metadata (title, kind, file_name, mime_type, contributors_json, created_at, content_size) SHALL ride the main snapshot; deliverable `content` bytes SHALL instead live in the IndexedDB store defined under the "Browser content store" requirement.

`MemoryDeliverableRepository.snapshot()` SHALL return `DeliverableSummaryRow[]` (metadata + content_size, no body bytes), and `MemoryRepositoriesSnapshot.deliverables` SHALL carry the same type. The memory repo constructor SHALL accept `(snapshot?: Partial<MemoryRepositoriesSnapshot>, contentLoader?: (id: string) => Promise<string | null>)` so the snapshot round-trip is symmetric and content hydrate is explicit.

#### Scenario: Memory repo does not throw on browser
- **WHEN** the web app boots without Tauri and emits `deliverable.created`
- **THEN** the in-memory `DeliverableRepository` accepts the insert, `useDeliverables()` shows the entry for the session, and nothing errors

#### Scenario: Browser hydration restores persisted deliverables after refresh
- **WHEN** the browser tab is reloaded after deliverables were created in the previous session AND both `localStorage` and IndexedDB are available and untouched
- **THEN** `useDeliverables()` initial state SHALL contain those deliverables after mount-time hydrate, with `artifact.content` populated from IDB via `contentLoader`

#### Scenario: Browser snapshot stays small even with large content
- **WHEN** 50 deliverables × 500 KB content each (25 MB total) have been emitted in a session
- **THEN** `JSON.stringify(localStorage['offisim:browser-runtime-snapshot:v1']).length` stays well under 5 MB (localStorage quota floor) — the 25 MB content is in IDB, not in the snapshot; `QuotaExceededError` SHALL NOT be thrown

#### Scenario: Browser hydration returns empty when localStorage is cleared
- **WHEN** `localStorage` is wiped between sessions (user action, storage quota, or incognito eviction)
- **THEN** `useDeliverables()` initial state SHALL be an empty array, with no runtime error — the memory repo simply starts fresh (IDB content that has no matching summary is effectively orphaned until future garbage-collection)
