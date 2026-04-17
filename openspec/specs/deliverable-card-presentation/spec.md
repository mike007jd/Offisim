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

`DeliverableCard` header SHALL render up to 3 `DicebearAvatar` instances (size 20, via `createOffisimAvatar` / `employeeName` seed) stacked horizontally with hover tooltip showing each employee's name and role. Additional contributors beyond 3 SHALL be collapsed into a single `+N` badge.

#### Scenario: Single contributor renders single avatar
- **WHEN** `item.contributingEmployees = [Maya]`
- **THEN** the header shows exactly one DicebearAvatar seeded with Maya's name; no `+N` badge appears

#### Scenario: Four or more contributors fold into +N
- **WHEN** `item.contributingEmployees = [Maya, Alex, Ryan, Sophie]`
- **THEN** the header shows three avatars (Maya, Alex, Ryan) followed by a `+1` badge; tooltip on the badge lists Sophie

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
