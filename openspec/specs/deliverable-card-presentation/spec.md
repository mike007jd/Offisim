# deliverable-card-presentation Specification

## Purpose

所有 UI 表面（chat bubble / Outputs 子 tab / 未来 Kanban 或场景入口）渲染一条 `Deliverable` 时 MUST 通过共享 `DeliverableCard` primitive（`packages/ui-office/src/components/deliverable/DeliverableCard.tsx`）。primitive 按 `variant='compact' | 'full'` 裁剪 action 密度；header / 文件态字段（lucide filetype icon / byte size / time-ago / contributor avatar stack）通过 `packages/ui-office/src/lib/deliverable-presentation.ts` 共享 helper 保持统一叙事。Tasks tab 内部分 `Activity | Plan | Outputs` 三子 tab，Kanban 只讲 plan step，不渲染 deliverable 列。此 capability 吃 `deliverable-persistence` 的 hook row 形状，不改变持久化与事件契约。
## Requirements
### Requirement: Shared `DeliverableCard` primitive is the sole deliverable renderer

All UI surfaces that render a `Deliverable` (chat bubble, Outputs sub-tab inside Tasks tab, any future consumer) SHALL do so via the shared `DeliverableCard` primitive at `packages/ui-office/src/components/deliverable/DeliverableCard.tsx`. No surface SHALL hand-roll its own deliverable card layout, metadata rendering, or action buttons.

`DeliverableCard` SHALL expose props:

- `item: Deliverable` — the hook row (from `useDeliverables()`)
- `variant: 'compact' | 'full'` — action slot density selector
- `employeeLabel?: string | null` — optional contributor override text
- `desktopVaultRoot?: string | null` — only consumed by `variant='full'` Tauri branch
- `onSaveAsSop?: (item: Deliverable) => Promise<void>` — only consumed by `variant='full'`
- `isNew?: boolean` — optional flash-highlight indicator

The primitive SHALL render a header row containing: filetype icon (from `mimeTypeToIcon`), display title, byte-size label (from `formatDeliverableBytes(item.contentSize)`), time-ago label (from `formatTimeAgo(item.createdAt)`), and contributor avatar stack (up to 3 `DicebearAvatar` at size 20, with `+N` badge when contributors exceed 3).

#### Scenario: Single primitive across all surfaces
- **WHEN** greps the codebase for `<DeliverableArtifactCard`, inline `<div ...>{deliverable.title}</div>` patterns, or any hand-rolled deliverable card layout
- **THEN** only `<DeliverableCard ...>` usages are found in chat bubble, Outputs sub-tab, and PitchHall internals

#### Scenario: Header fields render consistently
- **GIVEN** a deliverable with `title='snake.html'`, `artifact.mimeType='text/html'`, `artifact.content.length=15364`, `createdAt=(12 minutes ago)`, `contributingEmployees=[Maya]`
- **WHEN** the card renders in either variant
- **THEN** the header shows a lucide `FileCode` icon, `snake.html` title, `15.0 KB` size, `12m ago`, and one avatar for Maya

### Requirement: Variant `compact` preserves chat-bubble action set

`variant='compact'` SHALL render inside the chat bubble context and expose exactly three action buttons: Copy, Open (conditional on `canPreviewDeliverable(item.artifact)`), Download. Styling (max-width, accent color, button size) SHALL match the existing chat bubble visual treatment so the migration is not user-facing.

#### Scenario: Compact variant action set
- **WHEN** `<DeliverableCard variant='compact' item={htmlFileDeliverable} />` renders
- **THEN** the action row contains exactly `Copy`, `Open`, `Download` buttons; no doc-engine export dropdown, no Save as SOP, no Tauri local save appears

#### Scenario: Open hidden for non-previewable mime
- **WHEN** `<DeliverableCard variant='compact' item={csvFileDeliverable} />` renders and `canPreviewDeliverable(csvFileDeliverable.artifact)` returns false
- **THEN** the Open button is not rendered; Copy and Download remain visible

### Requirement: Variant `full` carries the PitchHall action suite

`variant='full'` SHALL expose the complete PitchHall action set, byte-compatible with the pre-change implementation:

- Copy — `navigator.clipboard.writeText(item.content)` with transient "Copied!" confirmation
- Download — triggered via Blob + `<a download>` click
- Preview — conditional on `canPreviewDeliverable(item.artifact)`, opens Blob URL in new tab
- Export — dropdown of `docx / pdf / pptx / csv / html / txt` (from `@offisim/doc-engine` `exportDocument`)
- Save as SOP — invokes `onSaveAsSop(item)` callback, converts deliverable to `SopDefinition` in the calling scope
- Save locally (Tauri only, conditional on `isTauri()` and valid `desktopVaultRoot`) — writes to vault directory via existing `saveDesktopDeliverable`
- Open folder (Tauri only, conditional on successful local save) — invokes `openDesktopLocalPath`

#### Scenario: Full variant in browser mode
- **WHEN** `<DeliverableCard variant='full' item={htmlFileDeliverable} desktopVaultRoot={null} />` renders in a non-Tauri browser
- **THEN** action row contains Copy, Download, Preview, Export dropdown, and Save as SOP; Save locally and Open folder buttons are NOT rendered

#### Scenario: Full variant in Tauri mode
- **WHEN** the same card renders with `isTauri() === true` and `desktopVaultRoot='/Users/alice/Vault'`
- **THEN** action row additionally shows Save locally and, after a successful save, Open folder buttons

#### Scenario: Export produces doc-engine output
- **WHEN** user selects `docx` in the export dropdown and clicks Export
- **THEN** `exportDocument({ content, title, format: 'docx' })` is invoked and the returned Blob is downloaded with a filename derived from the deliverable title

### Requirement: Shared presentation helpers provide filetype icon, byte-size, and time-ago mappings

`packages/ui-office/src/lib/deliverable-presentation.ts` SHALL export three pure functions:

- `mimeTypeToIcon(mime: string | null): LucideIcon` — maps common mime types to lucide-react icon components. Mappings SHALL include at minimum: `text/html`→`FileCode`, `text/javascript`/`text/typescript`→`FileCode`, `application/json`→`FileJson`, `text/markdown`→`FileText`, `text/csv`→`FileSpreadsheet`, `image/*`→`FileImage`, `text/plain`→`FileText`. Unknown mimes and `null` SHALL return the generic `File` icon.
- `formatDeliverableBytes(bytes: number): string` — returns human-readable size using 1024-base units (`B / KB / MB / GB`), 1 decimal place for KB and above (`15.0 KB`, `1.2 MB`).
- `formatTimeAgo(ts: number): string` — maps an epoch-ms timestamp to short relative labels (`just now` / `Nm ago` / `Nh ago` / `Nd ago`). MAY be implemented as a re-export of the repo-wide `formatTimestamp` helper as long as the semantics hold.

All three SHALL be pure (no React/DOM side effects) and consumed by `DeliverableCard`.

#### Scenario: Mime mapping covers known types
- **WHEN** `mimeTypeToIcon('text/html')`, `mimeTypeToIcon('application/json')`, `mimeTypeToIcon('text/markdown')` are called
- **THEN** they return `FileCode`, `FileJson`, `FileText` respectively (lucide-react component references)

#### Scenario: Unknown mime falls back to generic File icon
- **WHEN** `mimeTypeToIcon('application/x-unknown')` or `mimeTypeToIcon(null)` is called
- **THEN** both return the generic lucide `File` icon

#### Scenario: Byte formatting uses 1024 base
- **WHEN** `formatDeliverableBytes(0)`, `formatDeliverableBytes(512)`, `formatDeliverableBytes(15_360)`, `formatDeliverableBytes(1_887_436)` are called
- **THEN** they return `'0 B'`, `'512 B'`, `'15.0 KB'`, `'1.8 MB'` respectively

#### Scenario: Time-ago covers short and long ranges
- **WHEN** `formatTimeAgo` is called with timestamps 10 seconds / 3 minutes / 2 hours / 3 days ago
- **THEN** it returns `'just now'`, `'3m ago'`, `'2h ago'`, `'3d ago'` respectively

### Requirement: `useDeliverables()` hook exposes `contentSize` field

The `Deliverable` interface returned by `useDeliverables()` SHALL carry a `contentSize: number` field. For full-content hook rows the field SHALL equal `artifact.content.length`; for summary-mode rows (content lazy-loaded later) the field MAY be populated from the repo's `content_size` (UTF-8 byte length) instead. Consumers SHALL NOT re-derive byte-size at render time.

#### Scenario: Hook row carries contentSize
- **WHEN** `useDeliverables()` mounts and returns rows
- **THEN** each row has a `contentSize` number matching either the live `artifact.content.length` or the repo-provided byte size for summary rows

### Requirement: Contributor avatar stack replaces text badge list

`DeliverableCard` header SHALL render up to 3 contributor avatars (size 20) stacked horizontally with hover tooltip showing each employee's name. Each avatar SHALL be rendered through the shared `EmployeeAvatar` primitive (`packages/ui-office/src/components/shared/EmployeeAvatar.tsx`), which dispatches as follows:

- `isExternal === true` → `BrandAvatar2D` is **always** the renderer; if `brandKey` is `null` or unknown, `BrandAvatar2D`'s registry lookup falls back to a generic external-brand asset (the existing `lookupExternalBrand(null)` fallback). External contributors **never** render DiceBear, even when `brandKey` is unknown.
- `isExternal === false` → `DicebearAvatar` is the renderer (seeded by appearance / persona / name as `EmployeeAvatar` already implements).
- Legacy contributor records lacking `isExternal` SHALL be treated as `isExternal: false` (internal) and render via DiceBear; this is the only case where the absence of `brandKey` infers internal identity.

Additional contributors beyond 3 SHALL be collapsed into a single `+N` badge whose tooltip lists the overflow names.

`DeliverableCard.tsx` SHALL NOT call `DicebearAvatar` directly for contributor rendering. The pre-change `<DicebearAvatar seed={emp.employeeName} size={size} />` site SHALL be replaced with `<EmployeeAvatar agent={...} size={size} />` where `agent` carries the row-shape `{ is_external, brand_key, name, persona_json: null }` derived from the contributor record. The TODO comment at `DeliverableCard.tsx:104` SHALL be removed.

#### Scenario: Internal contributor renders DiceBear

- **WHEN** `item.contributingEmployees = [{ employeeId, employeeName: 'Maya', roleSlug: 'designer', isExternal: false, brandKey: null }]`
- **THEN** the header shows exactly one DiceBear avatar seeded with Maya's name; no `+N` badge appears

#### Scenario: External brand contributor renders BrandAvatar2D

- **WHEN** `item.contributingEmployees = [{ employeeId, employeeName: 'Hermes Bot', roleSlug: 'external', isExternal: true, brandKey: 'hermes' }]`
- **THEN** the header shows the Hermes brand SVG via `BrandAvatar2D`; no DiceBear seed is generated for this contributor

#### Scenario: External contributor with null brandKey renders BrandAvatar2D fallback

- **WHEN** `item.contributingEmployees = [{ employeeId, employeeName: 'Generic Bot', roleSlug: 'external', isExternal: true, brandKey: null }]`
- **THEN** the header renders `BrandAvatar2D` with its custom-external-brand fallback (via `lookupExternalBrand(null)`)
- **AND** DiceBear is **not** invoked for this contributor

#### Scenario: Mixed internal + external contributors

- **WHEN** `item.contributingEmployees = [Maya (internal), Hermes (external/hermes), Codex (external/codex)]`
- **THEN** the header renders three avatars in order: DiceBear (Maya), Hermes brand, Codex brand
- **AND** clicking through `EmployeeAvatar` dispatch shows internal vs external paths

#### Scenario: Four or more contributors fold into +N

- **WHEN** `item.contributingEmployees = [Maya, Hermes, Ryan, Sophie]` regardless of internal/external mix
- **THEN** the header shows three avatars (Maya DiceBear / Hermes brand / Ryan DiceBear) followed by a `+1` badge; tooltip on the badge lists Sophie

#### Scenario: Contributor record missing isExternal/brandKey falls back as internal

- **WHEN** a historical `Deliverable.contributingEmployees` element lacks `isExternal` or `brandKey` fields (legacy persisted shape)
- **THEN** rendering tolerates the absence by treating `isExternal` as `false` and `brandKey` as `null`, producing a DiceBear avatar
- **AND** no runtime error is thrown

### Requirement: Tasks tab renders three peer sub-tabs: Activity · Plan · Outputs

`packages/ui-office/src/components/layout/RightSidebar.tsx` Tasks tab (`TabsContent[value='tasks']`) SHALL contain a second-level tab bar with three peer sub-tabs `Activity | Plan | Outputs`. The default selected sub-tab SHALL be `Plan`. Sub-tab state SHALL be held in component `useState`; no persistence across session is required.

- `Activity` sub-tab content: `<ActivityRail variant="full" />`
- `Plan` sub-tab content: External Departments section (if any) + `<TaskDashboard agents={agents} />`
- `Outputs` sub-tab content: `<PitchHall activeThreadId={activeThreadId} />` rendered via the shared `DeliverableCard` primitive

The three sub-tabs SHALL render as a pill-style tab bar consistent with the top-level Chat/Tasks tab styling (border-radius-full, cyan active state). The pre-change Deliverables section block inside the Tasks tab SHALL be removed; its content moves entirely into the Outputs sub-tab.

#### Scenario: Default sub-tab is Plan
- **WHEN** the user first opens the Tasks tab
- **THEN** the Plan sub-tab is active; TaskDashboard (and External Departments if present) is visible; Activity and Outputs content is hidden behind their sub-tab triggers

#### Scenario: Outputs sub-tab surfaces deliverable list
- **WHEN** the user clicks the Outputs sub-tab
- **THEN** the Outputs pane renders the PitchHall content — a list of `DeliverableCard` entries (variant='full') for every deliverable in `useDeliverables()` filtered by `activeThreadId`

#### Scenario: Activity sub-tab surfaces event rail
- **WHEN** the user clicks the Activity sub-tab
- **THEN** the Activity pane renders `<ActivityRail variant="full" />` exclusively; no TaskDashboard, no deliverables

#### Scenario: Sub-tab selection does not persist across session
- **WHEN** the user selects Outputs, then reloads the tab
- **THEN** on next mount the default sub-tab (Plan) is active again

#### Scenario: External Departments section is under Plan
- **WHEN** `externalDepartments.length > 0` and the user is on the Plan sub-tab
- **THEN** the External Departments section renders at the top of the Plan pane (above TaskDashboard); the section does NOT appear under Activity or Outputs

### Requirement: KanbanBoard is a plan-only view, no Deliverables column

`packages/ui-office/src/components/kanban/KanbanBoard.tsx` SHALL NOT render a "Deliverables" column. The pre-change column and the `useDeliverables` import + derived `deliverables` variable SHALL be removed. KanbanBoard's role is step-by-step plan-progress visualization only; deliverable listing is delegated to the Outputs sub-tab.

#### Scenario: Kanban contains no Deliverables column
- **WHEN** KanbanOverlay opens with an active plan and existing deliverables in state
- **THEN** the horizontal scrollable column region contains only plan-step columns (matching `dashboard.steps`); no column titled "Deliverables" appears

#### Scenario: KanbanBoard does not subscribe to deliverables
- **WHEN** inspecting `KanbanBoard.tsx` imports and body
- **THEN** no `useDeliverables` import, no `deliverables` variable, no deliverable-related JSX is present

### Requirement: Contributor brand metadata propagates from employee row through StepTaskOutput to deliverable emit

The contributor `isExternal` + `brandKey` fields SHALL propagate through every layer of the deliverable emit chain so that `DeliverableCard` always receives the correct values. The propagation chain has **three independent emit paths**, all of which SHALL carry the fields:

```
employee row (is_external + brand_key)
  → StepTaskOutput.{ isExternal, brandKey }   [packages/core/src/graph/state.ts]
  ├→ boss-summary-node.emitDeliverable        [packages/core/src/agents/boss-summary-node.ts]
  ├→ employee-completion.ts (direct emit)     [materialized artifact path]
  └→ employee-a2a-executor.ts (direct emit)   [external A2A artifact path]
  → DeliverableCreatedPayload.contributingEmployees[]
  → useDeliverables.Deliverable.contributingEmployees[]
  → DeliverableCard.ContributorStack render
```

`StepTaskOutput` (defined at `packages/core/src/graph/state.ts`) SHALL carry `isExternal: boolean` and `brandKey: string | null` as required (non-optional) fields. Every `StepTaskOutput` construction site (employee node, external-employee-dispatch, sop-runner, and any future producer) SHALL populate both fields by reading from the underlying employee row's `is_external` (mapped to `boolean`) and `brand_key` (mapped to `string | null`). External A2A employees SHALL set `isExternal: true` and `brandKey` from the brand metadata.

All three deliverable emit sites (`boss-summary-node.emitDeliverable`, `employee-completion.ts`, `employee-a2a-executor.ts`) SHALL pass both fields through verbatim into `DeliverableCreatedPayload.contributingEmployees[]`. No layer is permitted to drop these fields silently. Direct emits that do not flow through `currentStepOutputs` SHALL read the fields directly from the producing employee's row.

Persisted state restored from a LangGraph checkpoint (`apps/desktop/renderer/src/lib/tauri-checkpoint.ts`) MAY contain pre-change `currentStepOutputs[]` entries lacking the new fields. The hydrate path SHALL backfill missing fields with `isExternal: false` / `brandKey: null` (legacy = internal) so the strict TypeScript shape is satisfied without runtime error. Harness scenario fixtures (`packages/core/harness/scenarios/*.json`) SHALL be updated in lockstep so that strict scenario validation does not require ad-hoc type coercion.

#### Scenario: Internal employee output carries internal flags

- **WHEN** an internal employee produces a `StepTaskOutput`
- **THEN** `output.isExternal === false` and `output.brandKey === null`
- **AND** the resulting `DeliverableCreatedPayload.contributingEmployees` element carries the same values

#### Scenario: External A2A employee output carries brand metadata

- **WHEN** an external A2A employee with `brand_key === 'hermes'` produces a `StepTaskOutput`
- **THEN** `output.isExternal === true` and `output.brandKey === 'hermes'`
- **AND** the resulting `DeliverableCreatedPayload.contributingEmployees` element carries the same values
- **AND** the rendered `DeliverableCard` shows the Hermes brand avatar via `EmployeeAvatar` dispatch

#### Scenario: Direct artifact emit from employee-completion preserves fields

- **WHEN** `employee-completion.ts` emits `deliverable.created` directly for a materialized artifact (without flowing through `boss-summary-node`)
- **THEN** the emitted `contributingEmployees[]` single element carries `isExternal` + `brandKey` derived from the producing employee's row
- **AND** the rendered `DeliverableCard` dispatches via `EmployeeAvatar` correctly (external → BrandAvatar2D, internal → DiceBear)

#### Scenario: Direct artifact emit from employee-a2a-executor preserves fields

- **WHEN** `employee-a2a-executor.ts` emits `deliverable.created` directly for an external A2A artifact (without flowing through `boss-summary-node`)
- **THEN** the emitted `contributingEmployees[]` single element carries `isExternal: true` + `brandKey` (registered or `null`) derived from the external employee's row
- **AND** the rendered `DeliverableCard` shows `BrandAvatar2D` (with brand-specific or fallback asset)

#### Scenario: Mixed contributors round-trip through persistence

- **WHEN** a deliverable is emitted with mixed internal/external contributors, persisted to `contributors_json`, and rehydrated
- **THEN** the rehydrated `Deliverable.contributingEmployees` preserves both `isExternal` and `brandKey` for every element
- **AND** the rendered card shows the same avatar mix as before persistence

#### Scenario: Legacy persisted contributors lack brand fields

- **WHEN** `contributors_json` was written before this change and lacks `isExternal` / `brandKey`
- **THEN** the persistence-service deserializer fills them with `isExternal: false` / `brandKey: null` without throwing
- **AND** the rendered card shows DiceBear avatars (legacy contributors treated as internal)

#### Scenario: Legacy LangGraph checkpoint restored without brand fields

- **WHEN** `TauriCheckpointSaver.loadLatest` restores a pre-change checkpoint whose `currentStepOutputs[]` entries lack `isExternal` / `brandKey`
- **THEN** the hydrate path backfills `isExternal: false` / `brandKey: null` for every missing entry
- **AND** the resumed graph executes without TypeScript-strict runtime errors
- **AND** any subsequent `deliverable.created` emit derived from these restored entries carries the backfilled (legacy = internal) values

