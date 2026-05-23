## ADDED Requirements

### Requirement: Activity Log workspace SHALL render a single-column timeline that splits to one detail column on focus

The Activity Log workspace SHALL render the timeline as a single full-width column (`grid-cols-1`). When an event is selected, the content grid SHALL split to a timeline column plus exactly one right-side detail column (`grid-cols-1 md:grid-activity-detail`, i.e. `1fr minmax(20rem, 26.25rem)` — detail ≤ 420px), revealing one `ActivityEventDetail`. The change SHALL NOT introduce a multi-column event grid (the prototype `.act-body` is `grid-template-columns: 1fr`, splitting to `.act-body.split` = `1fr minmax(320px, 420px)`). The underlying filtered event set and the content grid column definitions SHALL be unchanged; only the timeline / row / detail chrome (border / background / spacing / typography) is re-skinned to V3 tokens.

#### Scenario: Timeline renders single-column and splits to one detail column

- **WHEN** the Activity Log workspace is open with events present and no event selected
- **THEN** the timeline renders as a single full-width column (`grid-cols-1`)
- **AND** selecting an event splits the grid to `grid-activity-detail` (`1fr minmax(20rem, 26.25rem)`) revealing one ≤420px detail column
- **AND** the same filtered event set drives the view and the content grid column definitions are unchanged (no multi-column event grid)

### Requirement: Activity event row, filter bar, and detail SHALL use V3 grammar

The event row SHALL render with a level border + domain icon + label + a `×N` collapse badge (for collapsed consecutive reroutes) + relative timestamp. The filter bar (h-14 / 56px, `grid-activity-filter` = `repeat(3, minmax(0,1fr)) minmax(10rem, 2fr)`) SHALL use the V3 container-grammar for its three single-select dropdowns (date / type / actor) + search input while keeping the existing filter behavior. The detail panel SHALL render its 5 sections (EventType / Level / Timestamp / Entity / Payload) in V3 sectioned grammar, retaining the recursive `ActivityPayloadView` tree.

#### Scenario: Event row and detail use V3 grammar

- **WHEN** events render
- **THEN** each row shows level border + domain icon + label + `×N` badge (when reroutes are collapsed) + timestamp
- **AND** the detail panel renders 5 sectioned blocks with the recursive payload tree

### Requirement: Activity Log V3 redo SHALL NOT change the event/feed behavior layer or the layout grid

The V3 redo SHALL NOT modify the `components/events/EventLog.tsx` store that the workspace consumes — `primeEventLogStore` / `hydrateEventLogStore` / `disposeEventLogStore` (per-prefix subscriptions, FIFO 200 ring buffer, idempotent dispose), the 25 `EVENT_PREFIXES`, or `TYPE_PREFIX_MAP`. It SHALL NOT modify `activity-log-filter.ts` (the date → type → actor → search pipeline) or the `×N` collapse logic in `activity-log-grouping.ts` (`task.assignment.rerouted` 3+ consecutive). It SHALL NOT change the `ActivityLogPage` content grid column definitions (`grid-cols-1` ↔ `grid-activity-detail`) nor the `ActivityLogSessionState` shape. The separate `runtime/activity-feed/` 13-mapper layer (owned by `activity-feed-composition`) is not consumed here and is out of scope.

#### Scenario: Behavior layer and layout grid are untouched

- **WHEN** auditing the change diff
- **THEN** `EventLog.tsx`, `activity-log-filter.ts`, and `activity-log-grouping.ts` are unchanged
- **AND** the `ActivityLogPage` content grid column definitions and `ActivityLogSessionState` shape are unchanged
- **AND** real-time event streaming and `×N` collapse continue to function
