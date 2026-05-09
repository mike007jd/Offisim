# workspace-state-coverage Specification

## Purpose
TBD - created by archiving change add-workspace-narrow-tier-and-states. Update Purpose after archive.
## Requirements
### Requirement: Every workspace SHALL render explicit empty / loading / error / unsupported states

Every peer-level workspace surface SHALL distinguish four mutually
exclusive states in its primary content area and at each list/detail
pane. The six workspaces in scope are Office, SOPs, Market, Activity
Log, Settings, and Personnel. The four states SHALL be:

- **Empty** — no data exists yet (e.g. no SOPs, no employees, no events).
  Renders `EmptyState` from `ui-core` with icon + title + description +
  at least one `primaryAction` CTA. Pure-description empty states are
  forbidden — every empty state SHALL provide a path forward.
- **Loading** — data is being fetched. Renders a skeleton shimmer using
  `WorkspaceListSkeleton` / `WorkspaceDetailSkeleton` /
  `WorkspacePageSkeleton` from `ui-core`. SHALL NOT render plain text
  ("Loading…") or an empty container.
- **Error** — data fetch rejected or returned an unexpected shape.
  Renders `ErrorState` from `ui-core` with icon + title + message +
  primary `Retry` action and optional `Dismiss` action. Errors SHALL
  NOT silently fade as toasts when they prevent the workspace from
  rendering its primary content.
- **Unsupported** — the feature requires the desktop runtime (Tauri)
  but the user is on the web build. Renders an "Available on desktop"
  notice with an explanation and (where appropriate) a download link.

The four states SHALL be distinguishable by a single discriminated
state field per pane (e.g.
`viewState: { kind: 'loading' } | { kind: 'empty' } | { kind: 'error'; ... } | { kind: 'ready'; ... }`).
A workspace SHALL NOT conflate "loading" and "empty" by rendering empty
state during initial fetch.

#### Scenario: Personnel list shows skeleton during load
- **WHEN** Personnel workspace mounts and `findByCompany` is in flight
- **THEN** the list pane SHALL render `WorkspaceListSkeleton` with at
  least 6 shimmer rows
- **AND** SHALL NOT render `EmptyState` until the fetch resolves with
  an empty array

#### Scenario: SOPs sidebar shows skeleton during load
- **WHEN** the SOPs workspace mounts and `useSops()` reports `loading: true`
- **THEN** `SopSidebar` SHALL render a list skeleton
- **AND** SHALL NOT render the "No SOPs" empty state until the load
  resolves

#### Scenario: Activity Log timeline shows skeleton during load
- **WHEN** the Activity Log workspace mounts and the event log store
  is hydrating from `bootstrapState.eventHistory`
- **THEN** the timeline pane SHALL render a list skeleton
- **AND** SHALL NOT render `ActivityEmptyState` variant `'no-events'`
  until hydration completes

#### Scenario: Market grid shows skeleton during load
- **WHEN** the Market workspace mounts and `useMarketplace()` reports
  `isLoading: true`
- **THEN** the grid pane SHALL render at least 6 card-shaped skeletons
- **AND** SHALL NOT render `MarketEmptyState` until the load resolves

#### Scenario: Workspace router suspense fallback uses page skeleton
- **WHEN** a non-office peer workspace lazy-chunk is mid-fetch
- **THEN** `WorkspaceRouter` Suspense fallback SHALL render
  `WorkspacePageSkeleton` (centered, with header strip + dual-column
  shimmer)
- **AND** SHALL NOT render the legacy `<div>Loading workspace…</div>`
  fallback

### Requirement: Empty states SHALL provide at least one primary CTA

Every `EmptyState` invocation across the six peer workspaces SHALL
provide at least one `primaryAction`. Description-only empty states
SHALL be replaced with CTA-bearing equivalents.

The following empty-state CTAs are normative:

| Workspace | Empty state | Primary CTA | Secondary CTA (optional) |
|-----------|-------------|-------------|---------------------------|
| Personnel | No employees | `Hire your first employee` (opens employee creator) | `Browse marketplace` (switches to Market) |
| Personnel | No employee selected (detail pane) | `Pick someone on the left` (focuses list) | — |
| Personnel | No employee selected (tab pane) | `Pick someone on the left` (focuses list) | — |
| SOPs | No SOPs | `Create SOP` (opens editor) | `Import SOP` (opens import dialog) |
| SOPs | No SOP selected (canvas) | `Pick an SOP on the left` (focuses sidebar) | `Create SOP` |
| Market | No listings match filters | `Reset filters` | — |
| Market | No installed assets (manage tab) | `Browse the marketplace` (switches to explore) | — |
| Activity Log | No events yet | `Open Office to start working` (switches to office) | — |
| Activity Log | No events match filters | `Reset filters` | — |
| Settings | (no empty state — settings always populated) | — | — |
| Office | No active company | `Create your first company` (opens template wizard) | `Pick existing company` |

#### Scenario: Personnel detail empty state has CTA
- **WHEN** Personnel workspace renders with no `selectedEmployeeId`
- **THEN** the detail pane SHALL render `EmptyState` with title `Pick
  someone on the left` and a `primaryAction` that focuses the list

#### Scenario: SOPs canvas empty state has CTA
- **WHEN** SOPs workspace renders with no `selectedSopId`
- **THEN** the canvas area SHALL render `EmptyState` with title `Pick
  an SOP on the left` and a `primaryAction` that focuses the sidebar
  (or opens the create dialog if no SOPs exist)

#### Scenario: Market filter-empty has Reset CTA
- **WHEN** Market workspace `mode === 'explore'`, results are empty,
  and at least one filter is active (search, kind, sort non-default)
- **THEN** the grid SHALL render `EmptyState` with title indicating no
  matches and a `primaryAction` `Reset filters`

#### Scenario: Activity Log no-events has Office switch CTA
- **WHEN** Activity Log workspace renders with `events.length === 0`
- **THEN** the page SHALL render `EmptyState` with a `primaryAction`
  that switches to the Office workspace

### Requirement: `WorkspaceListSkeleton` / `WorkspaceDetailSkeleton` / `WorkspacePageSkeleton` SHALL exist in `ui-core`

`packages/ui-core/src/components/skeleton.tsx` SHALL export:

- `Skeleton` — base shimmer atom with `width` / `height` / `className`
  props. Renders a CSS-keyframe gradient that animates left-to-right
  every 1500ms. Honors `prefers-reduced-motion` (animation disabled
  when the user opts out, replaced with a static muted background).
- `WorkspaceListSkeleton` — composition rendering a stack of N rows
  (default 6, configurable via `rows` prop), each row containing an
  avatar circle (32×32) + two text-line skeletons (one 60% width, one
  40% width).
- `WorkspaceDetailSkeleton` — composition rendering a header chunk
  (avatar 80×80 + title line + subtitle line) + 2 paragraph blocks
  (3 lines each) + a button-shaped skeleton.
- `WorkspacePageSkeleton` — page-level composition: a top header strip
  (40px) + a dual-column shimmer (left 280px list + right detail). Used
  by `WorkspaceRouter` Suspense fallback.

All skeleton primitives SHALL be exported from
`packages/ui-core/src/index.ts` and re-exported transitively by
`packages/ui-office`.

#### Scenario: `Skeleton` honors `prefers-reduced-motion`
- **WHEN** the user has `prefers-reduced-motion: reduce` set
- **THEN** the `Skeleton` element SHALL render with a static background
  (no animated gradient)

#### Scenario: `WorkspaceListSkeleton` defaults to 6 rows
- **WHEN** `<WorkspaceListSkeleton />` is rendered with no `rows` prop
- **THEN** the rendered DOM SHALL contain exactly 6 row elements

#### Scenario: `WorkspacePageSkeleton` covers full container
- **WHEN** `<WorkspacePageSkeleton />` is rendered inside a
  `min-h-screen` parent
- **THEN** the rendered skeleton SHALL fill the parent's height and
  width with a header strip + dual-column shimmer

### Requirement: `ErrorState` SHALL exist in `ui-core` with retry contract

`packages/ui-core/src/components/error-state.tsx` SHALL export:

```ts
interface ErrorStateProps {
  title: ReactNode;
  message?: ReactNode;
  icon?: ComponentType<{ className?: string }> | ReactNode;
  primaryAction?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
  variant?: 'banner' | 'page';
  className?: string;
}

export function ErrorState(props: ErrorStateProps): JSX.Element;
```

The `variant` defaults to `'page'` when not specified. The `'banner'`
variant renders inline above the content area (red-tinted border + bg).
The `'page'` variant fills the container. Default icon is `AlertCircle`
from `lucide-react`.

When the error is recoverable (workspace or pane can refetch), the
`primaryAction` SHALL be wired to a Retry handler that re-issues the
failed request. When the error is informational (e.g. "Listing
unavailable"), `primaryAction` MAY be omitted in favor of a `Dismiss`
secondary action.

Error states SHALL replace the current pattern of `addToast(..., 'error')`
for errors that block the workspace from rendering its primary content.
Toasts SHALL remain only for transient, non-blocking errors (e.g. "SOP
synced" / "Failed to sync SOP" where the workspace continues to
function).

#### Scenario: `ErrorState` page variant fills container
- **WHEN** `<ErrorState title="..." variant="page" />` is rendered
  inside a `flex h-full` parent
- **THEN** the error block SHALL fill the parent's height and be
  vertically centered

#### Scenario: `ErrorState` banner variant inlines above content
- **WHEN** `<ErrorState title="..." variant="banner" />` is rendered
  above other content
- **THEN** the error block SHALL render as a horizontal banner with
  red-tinted border and background, without taking the full container
  height

#### Scenario: `ErrorState` Retry handler invokes the provided callback
- **WHEN** the user clicks the `primaryAction` button on an
  `ErrorState`
- **THEN** the `onClick` handler SHALL be invoked exactly once per
  click

### Requirement: Personnel workspace SHALL render loading and error states

`PersonnelPage` SHALL track a `viewState` for both the list and detail
panes, distinct from the existing `selectedEmployeeId` selection state:

- List pane: `loading | empty | error | ready`
- Detail pane: `unselected | loading | empty | error | ready`

When `findByCompany(activeCompanyId)` is in flight, the list pane SHALL
render `WorkspaceListSkeleton`. When the call rejects, the list pane
SHALL render `ErrorState` (variant `'page'`) with title "Couldn't load
employees" and a Retry button that re-invokes the fetch.

When the editor (`useEmployeeEditor`) is loading the selected employee,
the detail pane SHALL render `WorkspaceDetailSkeleton`. When the editor
load rejects, the detail pane SHALL render `ErrorState` with Retry.

#### Scenario: Personnel list renders skeleton during initial load
- **WHEN** `PersonnelPage` mounts and `findByCompany` is in flight
- **THEN** the left rail SHALL render `WorkspaceListSkeleton`
- **AND** the search input and filter chips SHALL still be rendered
  (form chrome is not skeleton-blocked)

#### Scenario: Personnel list renders error with retry
- **WHEN** `findByCompany` rejects
- **THEN** the left rail SHALL render `ErrorState` with title
  "Couldn't load employees" and a `Retry` `primaryAction`
- **AND** clicking Retry SHALL re-invoke `findByCompany` and transition
  back to the loading state

#### Scenario: Personnel detail renders skeleton during editor load
- **WHEN** the user selects an employee and `useEmployeeEditor.openForEdit`
  is in flight
- **THEN** the detail pane SHALL render `WorkspaceDetailSkeleton`

### Requirement: SOPs workspace SHALL render loading and error states

`SopViewSurface` SHALL track sidebar and inspector view states.
`SopSidebar` SHALL render `WorkspaceListSkeleton` while `useSops()`
reports `loading: true`. When the SOP fetch rejects (currently silent),
the sidebar SHALL render `ErrorState` banner variant with title "Couldn't
load SOPs" and a Retry button.

The SOP sync action (`SopSyncService.syncFromUrl`) currently surfaces
failure as `addToast('Failed to sync SOP', 'error')` — this SHALL be
preserved as a transient toast since the workspace remains usable.

#### Scenario: SOP sidebar renders skeleton during load
- **WHEN** `useSops()` reports `loading: true`
- **THEN** `SopSidebar` SHALL render at least 5 list-row skeletons
  beneath the search input
- **AND** SHALL NOT render the "No SOPs" empty state

#### Scenario: SOP sidebar renders error with retry
- **WHEN** the SOP fetch rejects
- **THEN** `SopSidebar` SHALL render `ErrorState` banner with Retry
  that re-invokes `refreshSops`

### Requirement: Activity Log workspace SHALL render loading and error states

`ActivityLogPage` SHALL render `WorkspaceListSkeleton` in the timeline
area while the event log store is hydrating from
`bootstrapState.eventHistory`. When event log subscription fails, the
page SHALL render `ErrorState` with Retry.

The existing toast for "The selected event is no longer available"
SHALL remain (transient; the workspace remains functional).

#### Scenario: Activity Log timeline renders skeleton during hydration
- **WHEN** `ActivityLogPage` mounts and `hydrateEventLogStore` is mid-
  hydration (events array empty AND store not yet flushed)
- **THEN** the timeline area SHALL render at least 5 row skeletons
- **AND** SHALL NOT render `ActivityEmptyState` variant `'no-events'`

### Requirement: Market workspace SHALL render loading and error states

`MarketPage` SHALL render a grid skeleton (at least 6 card-shaped
skeletons) when `useMarketplace()` reports `isLoading: true` AND
`results.length === 0`. When `error !== null` the grid SHALL render
`MarketErrorState` (existing) which SHALL be migrated to use the new
`ErrorState` primitive with Retry wired to `refresh()`.

Listing detail loading uses the existing `MarketDetailSkeleton`; this
SHALL be retained but renamed/refactored to use the shared `Skeleton`
atom for visual consistency.

#### Scenario: Market grid renders skeleton during initial load
- **WHEN** `MarketPage` mounts in `mode === 'explore'` and
  `useMarketplace().isLoading === true` AND `results.length === 0`
- **THEN** the grid area SHALL render at least 6 card skeletons
- **AND** the filter bar SHALL remain interactive

### Requirement: Settings workspace SHALL render loading and error states

`SettingsPage` SHALL render skeleton placeholders for each tab pane
while the underlying config (`useSettingsWorkspaceController`) is
loading. When provider verification or runtime reinit fails, the page
SHALL render an `ErrorState` banner above the tab content with Retry.

The existing sticky save bar SHALL display `Save failed — retry`
inline (existing); this state SHALL not be replaced by the new error
banner — they coexist (banner for fetch / load errors, sticky bar for
save submission errors).

#### Scenario: Settings provider tab renders skeleton during load
- **WHEN** `SettingsPage` mounts and the provider tab content is mid-
  load (`controller.isLoading === true`)
- **THEN** the content area SHALL render a `WorkspaceDetailSkeleton`
  layout

### Requirement: Unsupported state SHALL be explicit for desktop-only features

Workspaces SHALL render an explicit "Available on desktop" notice in
place of any desktop-only feature on the web build. The desktop-only
features in scope are the Tauri folder picker, the project file tree,
the MCP transport list, and the SDK-backed model transport configuration. The
notice SHALL include an explanation and (where applicable) a download
link.

The notice SHALL be visually distinct from `EmptyState` (use a different
icon — e.g. `Monitor` from `lucide-react`) so users do not mistake it
for "no data yet". The notice SHALL include the text "Available on
desktop" and a brief explanation of why the feature requires desktop
(e.g. "File system access requires the Offisim desktop app").

#### Scenario: Project file tree on web shows desktop-only notice
- **WHEN** the user is on the web build and views a project that has a
  `workspace_root` bound
- **THEN** the file tree area SHALL render an "Available on desktop"
  notice with the `Monitor` icon
- **AND** the notice SHALL NOT use the same icon as `EmptyState`

#### Scenario: Folder picker on web shows desktop-only notice
- **WHEN** the user opens `ProjectCreateDialog` on the web build
- **THEN** the folder picker row SHALL render the "Available on
  desktop" hint instead of the Choose button (existing behavior, now
  formalized)
