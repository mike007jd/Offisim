## ADDED Requirements

### Requirement: Deliverable rows are persisted to db-local

Every `deliverable.created` runtime event observed on the core `EventBus` SHALL be persisted as a single row in the db-local `deliverables` table. The row SHALL carry: `deliverable_id` (PK, UUID from payload), `company_id` (from event envelope), `thread_id`, `title`, `content`, `kind` (nullable), `file_name` (nullable), `mime_type` (nullable), `contributors_json` (JSON array of `{employeeId, employeeName, sourceKind?, roleSlug}`), `created_at` (ISO-8601 string derived from payload `createdAt`). Writes SHALL be idempotent: re-emitting the same event SHALL NOT produce a duplicate row (use `INSERT OR IGNORE` semantics keyed on `deliverable_id`).

The `deliverables` table SHALL be created by migration `023_deliverables.sql` and index at minimum `(company_id, created_at DESC)` and `(thread_id, created_at DESC)` for list queries.

#### Scenario: Fresh deliverable event produces a row
- **WHEN** an employee run emits `deliverable.created { deliverableId: 'dlv-1', content: '<html>...</html>', fileName: 'snake.html', mimeType: 'text/html' }` with `companyId: 'co-a'`
- **THEN** within one async tick the `deliverables` table contains exactly one row with `deliverable_id = 'dlv-1'`, `company_id = 'co-a'`, `file_name = 'snake.html'`, `mime_type = 'text/html'`, `content = '<html>...</html>'`, and a parseable `contributors_json` array

#### Scenario: Duplicate event is idempotent
- **WHEN** the same `deliverable.created` event with `deliverableId: 'dlv-1'` is emitted twice
- **THEN** `deliverables` still contains exactly one row with that ID, and the second insert SHALL NOT raise a constraint-violation error to the caller

#### Scenario: Oversize content is clamped, not dropped
- **WHEN** a `deliverable.created` event carries `content` whose UTF-8 byte length exceeds 1 MB
- **THEN** the persisted row's `content` SHALL be truncated to at most 1 MB (measured in UTF-8 bytes), a `console.warn` SHALL be logged identifying the `deliverable_id` and the original byte size, and the row SHALL otherwise be written normally

### Requirement: `DeliverableRepository` exposes list + find queries

`packages/core/src/runtime/repositories.ts` SHALL define a `DeliverableRepository` interface on `RuntimeRepositories.deliverables` (optional slot, mirroring the `userPreferences?` / `agentEvents?` pattern). The interface SHALL expose at least:

- `insert(row: NewDeliverable): Promise<void>` — idempotent insert, never throws on duplicate PK
- `findById(deliverableId: string): Promise<DeliverableRow | null>` — returns the full row including `content`
- `listByCompany(companyId: string, opts?: { threadId?: string; limit?: number }): Promise<DeliverableSummaryRow[]>` — returns rows sorted by `created_at DESC`, WITHOUT the `content` field (summary only: all metadata + `content_size` byte count). Default `limit` when unspecified SHALL be 100.

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

### Requirement: `DeliverablePersistenceService` subscribes to the event bus

Core SHALL ship a `DeliverablePersistenceService` that subscribes to `eventBus.on('deliverable.created', ...)` on construction and writes each observed event to `repos.deliverables.insert(...)`. The service SHALL:

- Register exactly one subscription and return its unsubscribe handle from its `dispose()` method
- Gracefully no-op (log `console.warn` once) when `repos.deliverables` is absent on the runtime (memory-only or not-yet-wired backends)
- Catch errors from `insert(...)` and log via `console.error` without re-throwing; persistence failure SHALL NOT propagate back to the event bus or stall the runtime
- Never call `HookRegistry` — fire-and-forget semantics are required to avoid blocking graph execution

The runtime bootstrap (`packages/core/src/runtime/*`) SHALL instantiate the service after `eventBus` and `repos` are ready, and SHALL invoke `service.dispose()` from the runtime teardown path.

#### Scenario: Event triggers repo insert
- **WHEN** `deliverable.created` fires on the bus with `deliverableId: 'dlv-1'` and `repos.deliverables` is present
- **THEN** `repos.deliverables.insert` is called exactly once with a payload whose `deliverable_id` equals `'dlv-1'`

#### Scenario: Missing repo slot is tolerated
- **WHEN** the runtime is constructed with a memory-mode `RuntimeRepositories` whose `deliverables` property is undefined
- **THEN** constructing the service SHALL NOT throw; event emissions SHALL silently no-op; a single `console.warn` SHALL be observable on first service construction

#### Scenario: Insert failure does not crash runtime
- **WHEN** `repos.deliverables.insert` rejects with an error (e.g. DB write failed)
- **THEN** the service SHALL log via `console.error` and the event bus SHALL continue to dispatch subsequent events normally

#### Scenario: Dispose unsubscribes
- **WHEN** `service.dispose()` is invoked, then a new `deliverable.created` event is emitted
- **THEN** `repos.deliverables.insert` SHALL NOT be called for that event

### Requirement: `useDeliverables()` hydrates from repo on mount and merges live events

The `useDeliverables()` hook in `@offisim/ui-office` SHALL, on mount:

1. Call `runtime.listRecentDeliverables({ limit: 100 })` (exposed on the runtime context) and use the result as initial state
2. Subscribe to `eventBus.on('deliverable.created')` and merge incoming events into state

Merge semantics SHALL deduplicate by `deliverableId` (primary); a fallback composite key (`threadId + kind + fileName + content`) SHALL be used only when `deliverableId` is absent from an incoming event (defensive).

The runtime context SHALL expose `listRecentDeliverables(opts: { threadId?: string; limit?: number }): Promise<Deliverable[]>` that internally queries `repos.deliverables.listByCompany(activeCompanyId, opts)` and lazily hydrates `content` via `findById` when an entry is opened (entries from `listByCompany` carry only metadata + `content_size`).

#### Scenario: Hook initial render returns persisted history
- **WHEN** the hook mounts after an app restart where 5 rows exist for the active company
- **THEN** the hook's returned array contains those 5 entries sorted newest-first, with `contributingEmployees` populated and `artifact.content` available (lazily resolved if initially a size-only summary)

#### Scenario: Live event merges with hydrated history
- **GIVEN** the hook has hydrated 3 historical entries
- **WHEN** a new `deliverable.created` event fires with `deliverableId: 'dlv-new'`
- **THEN** the hook's returned array contains 4 entries, `dlv-new` appears in position consistent with its `createdAt`, and no duplicate of `dlv-new` exists

#### Scenario: Event with known deliverableId does not duplicate
- **GIVEN** the hook has hydrated an entry `dlv-1` from history
- **WHEN** a `deliverable.created` event for `deliverableId: 'dlv-1'` arrives (race between hydrate and live)
- **THEN** the hook's returned array still contains exactly one entry for `dlv-1`

### Requirement: Platform database is not affected

This capability SHALL NOT add tables, columns, or migrations to `@offisim/db-platform`. Marketplace-side storage SHALL remain disjoint from runtime deliverable history. Platform API endpoints for deliverables are explicitly out of scope for this capability.

#### Scenario: No platform schema change
- **WHEN** inspecting `packages/db-platform/src/schema.ts` and `packages/db-platform/src/migrations/`
- **THEN** neither file contains any reference to a `deliverables` table, a `Deliverable*` type, or a deliverables migration

### Requirement: Browser-only (non-Tauri) persistence is a documented gap

When the web app runs outside Tauri (no `tauri-repos` wired), the active `RuntimeRepositories.deliverables` SHALL be the in-memory implementation, which SHALL be acceptable for the current iteration. Documentation (`CLAUDE.md`, project memory or queue notes) SHALL call out that browser-only sessions lose deliverable history on refresh and that full browser persistence is deferred.

#### Scenario: Memory repo does not throw on browser
- **WHEN** the web app boots without Tauri and emits `deliverable.created`
- **THEN** the in-memory `DeliverableRepository` accepts the insert, `useDeliverables()` shows the entry for the session, and nothing errors

#### Scenario: Browser hydration returns empty after refresh
- **WHEN** the browser tab is reloaded after deliverables were created in the previous session
- **THEN** `useDeliverables()` initial state SHALL be an empty array (no persisted history), with no runtime error
