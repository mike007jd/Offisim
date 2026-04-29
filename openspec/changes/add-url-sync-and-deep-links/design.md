## Context

The existing implementation of `useWorkspaceBackNavigation` only pushes a
single `history.pushState({ workspace })` entry on mount and re-pushes
the identical entry every time `popstate` fires after an internal back
unwind. The address bar is constant (`/`). `useWorkspaceSessionState`
holds workspace identity, per-workspace session slices, and a
`historyStack: WorkspaceKey[]` for unwind. `useOverlayState` is a
parallel `useState<OverlayKey | null>` with no relation to the URL.
`createRouteToPersonnel` does two writes (`updateWorkspaceState` then
`setActiveWorkspace`) without surfacing them in the URL.

`useDeepLinkInstall` proves Tauri 2's deep-link plugin is wired up — the
Rust shell receives `offisim://install?listing_id=X&version=Y` and emits
an `'deep-link-install'` event into the React app. That channel is
preserved unchanged: install requests are asynchronous side-effects,
not navigation. They MAY additionally trigger a URL change (e.g.
navigating to the market detail page during install review), but the
event channel and the URL channel are orthogonal.

Bundle size is a known debt — main chunk is ~1.7 MB. Adding React
Router 7 (`react-router-dom@7` ≈ 90 KB minified) or TanStack Router
(`@tanstack/react-router@1` ≈ 70 KB minified plus generated route
tree machinery) is non-trivial. A custom router based on `useSyncExternalStore`
+ native `History` API is ≈ 1.5 KB.

## Goals / Non-Goals

**Goals:**

- The URL is the canonical source of truth for `(workspace, primary
  entity, secondary state, overlay)` for every state combination
  reachable through normal user navigation.
- Pasting a URL into a fresh window OR refreshing the current window
  reproduces the visible state byte-equivalent (modulo lazy-chunk
  loading flicker).
- Browser back/forward step through every URL change in order, no
  dead steps.
- Tauri release `.app` reload preserves URL state (within the same
  webview lifetime — across `.app` quit/relaunch the URL is reset
  to `/` per Tauri's normal behavior, which is acceptable).
- Cross-surface helpers (`createRouteToPersonnel` + future siblings)
  drive navigation via the serializer, single `history.pushState` per
  user action.
- Unknown / malformed URLs degrade gracefully — defined fallback,
  visible toast for primary-entity misses, silent for cosmetic params.
- No third-party router dependency added.

**Non-Goals:**

- Server-side rendering / SSR routes. Offisim is a SPA (Vite + React
  19) and a Tauri shell — no server rendering pipeline.
- A "router config" file with declarative route definitions and
  loaders. The route surface is small (6 workspaces + a few overlays);
  a programmatic parse/serialize pair is simpler than codegen.
- Wrapping route components with `useLoaderData` / nested route
  outlets. Workspace pages already consume session state through hooks;
  a route-data layer adds a second source of truth.
- Persistence of state OTHER than what the URL grammar covers (e.g.
  scroll position, drawer expanded/collapsed flags that have their own
  localStorage). URL only carries reachable / shareable state.
- Auto-generating sitemap / link maps for SEO. SPA + Tauri only.
- A redirect API for legacy paths. There are no legacy paths to
  redirect from — pre-launch.

## Decisions

### Decision 1: Build a custom router (`useSyncExternalStore` + History API)

**Rationale**:
- Bundle size: custom router is ~1.5 KB; React Router 7 is ~90 KB;
  TanStack Router is ~70 KB plus generated tree code. Main chunk is
  already at ~1.7 MB known debt — every kilobyte counts pre-1.0.
- Tauri compatibility: React Router's `BrowserRouter` reads
  `window.location` and uses `history.pushState` exactly the same as
  custom code; no Tauri-specific quirks. But TanStack Router's
  generated route file approach (auto-generated `routeTree.gen.ts`)
  adds a dev-time codegen step that interferes with the existing
  `pnpm dev` flow (turbo + vite) and would require build-pipeline
  changes.
- Domain fit: Offisim's route surface is a 2-axis tuple
  `(workspaceKey, overlayKey | null)` plus per-workspace nested
  state — each workspace needs only a small URL parser, all six
  fit on one screen. A library router optimizes for nested route
  trees with shared layouts; we have a single `AppLayout` shell
  that already handles this.
- Mocking + harness: a custom parse/serialize pair is pure-function
  testable inline. Wrapping our existing `useWorkspaceSessionState`
  in router contexts adds layers that the deterministic harness
  scenarios would have to mock.

**Alternative considered: React Router 7 (`react-router-dom`)**.
Rejected — bundle size + adds a new mental model on top of the
existing workspace state hooks. Reuse value is low (no nested
routes, no loaders).

**Alternative considered: TanStack Router**. Rejected — bundle size
+ codegen step + heavier mental model than needed.

**Alternative considered: `wouter` (~1 KB)**. Rejected — it would
collapse our two-axis routing into a flat path-only model and force
overlays to be expressed as path segments only, losing the existing
`overlay = orthogonal` semantics. Custom router preserves the orthogonal
overlay axis cleanly.

The custom router consists of:
1. A `parseUrl(location: { pathname: string; search: string }):
   ParsedUrl` pure function that maps a URL into the structured
   tuple `{ workspace, sessionPatch: Partial<WorkspaceSessionState>,
   overlay: OverlayKey | null }`. Uses an explicit dispatch table
   per workspace, returns the safe fallback for unknown paths.
2. A `serializeUrl(state: { workspace, sessionState, overlay }):
   string` pure function that produces the canonical URL for a
   given app state. Round-trip identity with `parseUrl` is part
   of the contract.
3. A `useUrlSync({ workspace, sessionState, overlay })` hook that
   subscribes to `popstate` and writes `history.replaceState` /
   `history.pushState` based on whether the change touches workspace
   identity. Uses `useSyncExternalStore` for popstate so React 19
   concurrent rendering does not skip URL events.

### Decision 2: URL grammar is path-first, query-secondary

**Rule**: workspace identity + primary entity (employee id, sop id,
listing id, settings section, activity event) live in the path.
Secondary state (tab, view mode, filters, search) lives in the
query string.

**Rationale**: paths are easier to type, share, and parse visually.
Path segments always reflect the screen the user is looking at.
Queries are the right place for filter state because they can be
omitted without changing identity ("/activity" with no filters
vs. "/activity?filter=task").

### Decision 3: Overlays use a dedicated `?overlay=` token, except where they have a natural path

**Rule**:
- `employee-creator`: `/personnel/new` (natural path — it is the
  "create employee" screen of Personnel).
- `office-editor`: `?overlay=office-editor` (no natural path —
  it overlays Office without changing workspace identity, and
  it has no entity ID).
- `company-select`: NOT in URL (modal-only, gates initial app
  load — see Decision 6).
- `studio`: `/studio?company=<companyId>` (natural path — it is
  a full-screen editor identified by the company being edited).

**Rationale**: overlays that have a stable, addressable identity
(`employee-creator` is "new employee", `studio` is "edit company X")
get a path. Overlays that exist as a side-channel on top of an
existing workspace use `?overlay=<key>` to avoid collisions with
workspace paths.

### Decision 4: URL writes use replaceState by default; pushState only on workspace identity change

**Rule**:
- Workspace identity change (`activeWorkspace` from `'office'` to
  `'sops'`, OR overlay opens/closes, OR primary entity in the path
  changes — e.g. `/personnel/maya` → `/personnel/alex`): emit
  `history.pushState` so browser back returns to the previous identity.
- In-place state change within the same workspace + same primary
  entity (e.g. `?tab=profile` → `?tab=appearance`, `?filter=task`
  toggle): emit `history.replaceState` so back does not step
  through every tab change.

**Rationale**: tab toggles, filter checkboxes, and search input
typing should not flood the back stack. A back press from
`/personnel/maya?tab=appearance` goes back to where the user
came from (e.g. `/office`), not to `/personnel/maya?tab=profile`.

**Edge cases**:
- Workspace switch via `setActiveWorkspace('personnel')` with no
  primary entity yet: pushState `/personnel`. Then selecting
  Maya: pushState `/personnel/maya` (entity is identity). Tab
  switch to appearance: replaceState `/personnel/maya?tab=appearance`.
- Office viewMode toggle (`2D` ↔ `3D`): pushState. The viewMode
  is observable in the scene rendering, the user expects back to
  undo the toggle.

### Decision 5: Fallback rules

| URL element | Validation | Failure behavior |
|-------------|------------|------------------|
| Workspace key | Must be in `'office' \| 'sops' \| 'market' \| 'personnel' \| 'activity-log' \| 'settings'` | Fall back to Office, no toast (silent — could be a typo). |
| Primary entity (employee id, sop id, listing id, event id) | Existence checked against current data on first paint after parse | Fall back to workspace base, info toast `Couldn't open the link — <entity> not found.` |
| Settings section | Must be in `'provider' \| 'runtime' \| 'mcp' \| 'external'` | Fall back to `'provider'`, silent. |
| Activity datePreset | Must be `'today' \| '7d' \| '30d' \| 'custom'` | Drop, silent. |
| Office viewMode | Must be `'2D' \| '3D'` | Drop, silent. |
| Personnel tab | Must be in tab union | Fall back to `'profile'`, silent. |
| Market kind | Must be in `AssetKind \| 'all'` | Fall back to `'all'`, silent. |
| Market sort | Must be `MarketSortOption` | Fall back to `'relevance'`, silent. |
| Overlay token | Must be `'office-editor'` (only addressable `?overlay=`) | Drop, silent. |
| Company id (studio) | Existence checked | If missing, fall back to overlay close + Office. |

**Rationale**: silent drops for cosmetic params keep noise low.
Toasts only for primary-entity misses where the user explicitly
asked for an entity that's gone.

### Decision 6: company-select overlay is NOT in URL

**Rule**: `useOverlayState` opens `'company-select'` automatically
when `activeCompanyId` is null (existing behavior). It is not
addressable via URL.

**Rationale**: company-select is a modal pre-condition to using
the app, not a page. URLs SHALL behave as if the user already has
a company selected. If a deep-link arrives while no company is
selected, the company-select overlay shows first; once the user
selects a company, the saved deep-link target re-applies.

**Implementation**: parsed URL is held in a ref until
`activeCompanyId !== null`; when company is selected, the ref's
state is replayed via `useEffect`, then cleared.

### Decision 7: popstate handling re-parses URL fresh

**Rule**: `popstate` listener calls `parseUrl(window.location)` and
hands the resulting `{ workspace, sessionPatch, overlay }` to the
existing setters via a single batched update (React 19 automatic
batching). It does NOT consult the React state — popstate is
defined as "the URL changed, reflect that".

**Rationale**: keeps URL the single source of truth. Avoids the
divergence class where state and URL drift.

**Internal drill-in**: when the user is on `/personnel/maya?tab=appearance`
and clicks browser back, popstate fires with the previous URL. If
the previous URL was `/personnel/maya?tab=profile`, the parser
returns Personnel + Maya + tab=profile, the setter just changes the
tab. If the previous URL was `/personnel`, the setter clears the
selection. The `tryWorkspaceInternalBack` logic is no longer the
primary back driver — it becomes an Escape-key shortcut and an
internal tool used by the URL serializer to compute the next URL
when the user presses Escape.

### Decision 8: Initial-paint URL parse happens before first render

**Rule**: `App.tsx` SHALL read `window.location` synchronously
at module top-level (or in a `useState` initializer that runs
exactly once) and pass the parsed result as `initial` to
`useWorkspaceSessionState({ initial })` and
`useOverlayState({ initial })`.

**Rationale**: avoids the "render Office, then flash to deep
link target" janky transition. First paint already reflects the URL.

**Implementation**: a small `parseInitialUrl(): ParsedInitialState`
helper in `apps/web/src/lib/url-routing/parser.ts` is called inside
the existing `useState` initializer in `useWorkspaceSessionState`
and `useOverlayState`.

### Decision 9: `createRouteToPersonnel` writes a single URL and lets useUrlSync propagate

**Rule**: refactor `createRouteToPersonnel` to:
```ts
return (employeeId, tab = 'profile') => {
  const url = serializePersonnelUrl(employeeId, tab);
  history.pushState(null, '', url);
  applyParsedUrl(parseUrl({ pathname: url, search: '' }));
};
```

**Rationale**: this collapses the current two-write pattern into
one navigation call. Other cross-surface helpers (future
`routeToSop`, `routeToActivityEvent`, `routeToMarketDetail`) follow
the same pattern.

### Decision 10: Tauri SPA fallback

**Rule**: Tauri 2 serves `frontendDist` as static files. Non-`/`
paths return 404 unless a fallback rewrites them to `index.html`.
Tauri 2 supports this via `tauri.conf.json` `app.windows[].url`
plus a static-file rewrite. The change SHALL add the SPA fallback
config so `/personnel/maya` loads `index.html` and the React app
parses the URL.

**Verification**: Tauri release build, navigate to
`tauri://localhost/personnel/maya` — webview loads `index.html`
+ React reads URL + state restored.

## URL Grammar Table

### Workspace Bases (6)

| Workspace | Pathname | Notes |
|-----------|----------|-------|
| Office | `/` or `/office` | Both forms accepted on parse; serialize uses `/` (root). |
| SOPs | `/sops` | List view. |
| Market | `/market` | Defaults to explore feed. |
| Personnel | `/personnel` | List, no selection. |
| Activity Log | `/activity` | Path is `/activity` not `/activity-log` for brevity; workspace key remains `'activity-log'`. |
| Settings | `/settings` | Defaults to `provider` section. |

### Workspace Nested URLs (full grammar)

| Workspace | URL Pattern | Maps to state |
|-----------|-------------|---------------|
| Office | `/?company=<id>&view=2d` (or `view=3d`) | `OfficeSessionState.viewMode = '2D' | '3D'`; `?company=` selects active company. |
| Office | `/?company=<id>&dashboard=1` | `dashboardOpen = true` (push entry, back closes dashboard). |
| Office | `/?company=<id>&kanban=1` | `kanbanOpen = true`. |
| Office | `/?company=<id>&listing=<id>` | `marketplaceListingId = <id>`. |
| SOPs | `/sops?q=<search>` | `sops.search = <search>`. |
| SOPs | `/sops/<sopId>` | `sops.selectedSopId = <sopId>`. |
| SOPs | `/sops/<sopId>?step=<stepId>` | Selected SOP + focused step (run-surface UI). |
| Market | `/market/explore` | `mode = 'explore'`. |
| Market | `/market/explore/<listingId>` | `mode = 'explore'`, `selectedListingId = <listingId>`. |
| Market | `/market/manage` | `mode = 'manage'`, defaults to `manageTab = 'installed'`. |
| Market | `/market/manage/<tab>` where `<tab> ∈ {installed,updates,published}` | `manageTab = <tab>`. |
| Market | `/market/manage/<tab>?detail=<listingId>` | Manage tab + detail panel. |
| Market | any of above + `?q=<search>&kind=<assetKind>&sort=<sort>` | Filters. |
| Personnel | `/personnel/new` | `employee-creator` overlay open over Personnel. |
| Personnel | `/personnel/<employeeId>` | `selectedEmployeeId = <employeeId>`, defaults `tab=profile`. |
| Personnel | `/personnel/<employeeId>?tab=<tabId>` where `<tabId> ∈ {profile,appearance,runtime,skills,memory,history}` | Selected employee + active tab. |
| Activity Log | `/activity?event=<eventId>` | `selectedEventId`. |
| Activity Log | `/activity?type=<csvList>&actor=<csvList>&date=<preset>&q=<search>` | Filters. |
| Activity Log | `/activity?event=<eventId>&type=...` | Event focus + retain filters. |
| Settings | `/settings/<section>` where `<section> ∈ {provider,runtime,mcp,external}` | Active settings tab. |

### Overlay URLs (4)

| Overlay | URL Pattern | Notes |
|---------|-------------|-------|
| `employee-creator` | `/personnel/new` (path-based) | Overlays the Personnel workspace. Closing pops back to last Personnel state. |
| `office-editor` | `/?overlay=office-editor` (query-based) | Overlays Office. Path remains `/` because office identity is unchanged. |
| `company-select` | NOT in URL | Modal pre-condition; opens automatically when `activeCompanyId === null` per Decision 6. |
| `studio` | `/studio?company=<companyId>` | Full-screen editor; addressable. |

### Shareable URL Examples

```
http://localhost:5176/personnel/emp_maya_001?tab=appearance
  → Personnel workspace, Maya selected, Appearance tab focused.

http://localhost:5176/sops/sop_onboarding_v2?step=step_review_pr
  → SOPs workspace, "Onboarding v2" SOP open in builder, step "review_pr" focused.

http://localhost:5176/market/explore/skill_typescript_audit
  → Market workspace, explore mode, listing detail "skill_typescript_audit".

http://localhost:5176/market/manage/published?detail=employee_jordan
  → Market, manage tab, published filter, detail panel on "employee_jordan".

http://localhost:5176/activity?event=evt_42&type=task,manager&date=7d&q=maya
  → Activity Log, event 42 focused, filtered to task+manager events
    over last 7 days, search "maya".

http://localhost:5176/settings/runtime
  → Settings workspace, Runtime tab.

http://localhost:5176/personnel/new
  → Personnel workspace + employee-creator overlay (path).

http://localhost:5176/?overlay=office-editor
  → Office workspace + office-editor overlay (query-based).

http://localhost:5176/studio?company=co_acme
  → Studio overlay editing company "co_acme".

http://localhost:5176/?view=2d&dashboard=1
  → Office, 2D mode, dashboard overlay open.

tauri://localhost/personnel/emp_maya_001?tab=memory
  → Same as the http:// version but inside the Tauri webview.
```

### Query Parameter Types and Defaults

| Param | Type | Default when absent | Notes |
|-------|------|---------------------|-------|
| `view` | `'2d' \| '3d'` (lowercase serialized; uppercase in state) | `'3D'` (matches `createDefaultOfficeState`) | Office-only. Path serializer normalizes to lowercase. |
| `company` | string (company_id) | `activeCompanyId` from runtime context | Office-only when explicitly desired in URL; otherwise inferred. |
| `dashboard` | `'1'` to enable, omit to disable | omitted (closed) | Boolean toggle. |
| `kanban` | `'1'` to enable, omit to disable | omitted (closed) | Boolean toggle. |
| `listing` | string (listing_id) | omitted | Office marketplace detail. |
| `q` | string (URL-encoded) | empty | Search input. Cosmetic — does not push entry. |
| `step` | string (step_id) | omitted | SOPs only. |
| `tab` | one of `{profile,appearance,runtime,skills,memory,history}` | `'profile'` | Personnel only. |
| `event` | string (event_id) | omitted | Activity log only. |
| `type` | comma-separated string | empty | Activity log filter. |
| `actor` | comma-separated string | empty | Activity log filter. |
| `date` | one of `{today,7d,30d,custom}` | `'today'` | Activity log filter. |
| `kind` | one of `AssetKind \| 'all'` | `'all'` | Market filter. |
| `sort` | `MarketSortOption` | `'relevance'` | Market filter. |
| `detail` | string (listing_id) | omitted | Market manage tab detail panel. |
| `overlay` | one of `{office-editor}` | omitted | Only `office-editor` is `?overlay=` addressable. |

### Special Character Handling

- All free-text values (`q`, `actor`) are URL-encoded with
  `encodeURIComponent` on serialize and `decodeURIComponent` on parse.
- Empty strings are NOT serialized — `q=` is dropped.
- Invalid IDs (non-matching pattern, e.g. control characters) are
  treated as missing (fall back to workspace base + toast).
- Maximum query string length is bounded by browser limit (~2 KB
  practical) — long search strings (>1024 chars) get truncated to
  1024 with a console warn; this is a defensive guard, not user-facing.
- Path segments are case-sensitive on parse (matches REST norm).
  Workspace keys ARE lowercase by definition.

## Risks / Trade-offs

[Risk] Serializer/parser drift — the parse and serialize functions
must round-trip. A bug in one without a matching fix in the other
silently breaks state restore.
→ Mitigation: round-trip property test in the deterministic harness
(parse(serialize(state)) === state for the canonical state corpus).
The corpus enumerates one URL per row of the URL Grammar Table.

[Risk] Tauri release build SPA fallback — if `tauri.conf.json` is
not configured for SPA fallback, deep-link URLs return 404 in the
release `.app`.
→ Mitigation: Task 8 explicitly verifies. Failure mode is loud
(white screen on first load), not silent — won't ship unverified.

[Risk] popstate race during company-select gate — if user pastes
`/personnel/maya` while `activeCompanyId === null`, the URL is
saved in a ref. If the user manually clicks browser back before
selecting a company, the ref needs to be cleared to avoid replaying
a stale deep link.
→ Mitigation: Decision 6 implementation includes a clear-on-popstate
guard. Also clear when activeCompanyId transitions from null to
non-null AND the user has interacted (any click or keypress).

[Risk] Bundle splits + lazy chunks — first paint URL parse needs
to dispatch into the right workspace, but workspace pages are
React.lazy. A `/personnel/maya` deep link causes the Personnel
chunk to download before Personnel renders, showing the existing
`WorkspaceLoadingFallback` skeleton.
→ Acceptable: this is the existing behavior for any non-Office
workspace navigation, no regression.

[Risk] Forward-button parity needs every workspace mutation to
be in the URL. If a workspace introduces session state that is
NOT in the URL grammar, forward press skips that state.
→ Mitigation: spec contains the full table, every workspace state
field SHALL either be (a) in the URL, (b) explicitly documented
as ephemeral, or (c) localStorage-backed (e.g. panel widths).
Code review enforced via spec checks.

[Risk] Event listener leaks — `popstate` listener attached during
mount must be cleaned up. The custom router uses
`useSyncExternalStore` whose teardown semantics are well-defined,
but the `useUrlSync` hook needs a stable subscribe identity.
→ Mitigation: subscribe function is module-level (closes over
nothing), single source of registration; teardown verified with
React StrictMode mount/unmount/remount cycle.

[Trade-off] Custom router means contributors must learn the
serializer dispatch table. Library router would have community
documentation.
→ Acceptable: the table is one file (~150 lines) and entirely
declarative; the cost of learning it is lower than the cost of a
React Router upgrade later.

[Trade-off] We lose React Router DevTools. No third-party debugger
for our routes.
→ Acceptable: React DevTools already shows our hook state; URL
itself is in the address bar.

[Trade-off] React 19 concurrent rendering may schedule URL writes
slightly out of order if a state mutation cascades synchronously
through multiple setters. `replaceState` then `pushState` in the
same task is fine (both go onto the same task queue), but if
`useUrlSync` is split across two effects, the order is undefined.
→ Mitigation: single `useUrlSync` hook handles all URL writes
in one effect, derived from a single combined input snapshot.

## Migration Plan

Pre-launch — no migration. Web app is in active dev with a small
internal user pool. The change deletes the current
`useWorkspaceBackNavigation` push-only history wiring and replaces
it with full URL routing. Existing in-flight session state in
browser tabs at deploy time is reset to default URL `/` on the
next reload (no action needed — Office is the safe fallback).

Tauri release `.app` requires a rebuild because of the SPA
fallback config change. The change SHALL ship a single
`pnpm --filter @offisim/desktop build` artifact bundle as part
of verification.

`useDeepLinkInstall` event channel preserved unchanged. Marketplace
install deep links continue to fire the existing event, with no
URL navigation requirement (the event handler MAY internally
navigate, but the contract is not changed).

`createRouteToPersonnel` API signature unchanged
(`(employeeId, tab?) => void`); only its internal implementation
shifts to single-URL navigation.

No external integrations depend on the absence of URL state, so
introducing URL state cannot break a documented contract.
