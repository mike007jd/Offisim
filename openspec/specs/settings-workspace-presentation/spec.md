# settings-workspace-presentation Specification

## Purpose

Settings workspace 之前 4 个子页（Provider / Runtime / MCP / External）都用 `SurfaceCard`（24px 圆角 + border + bg）平铺；Provider tab 内层手写 `rounded-[20px]` "Resolved product" 卡构成 3 层圆角嵌套，MCP 子页把 `ui-core/Card` 嵌在 SurfaceCard 内构成 4 层 border 嵌套，Runtime tab 5 张同等级 SurfaceCard 占满首屏只露 2 张。`SettingsContentArea` 底部 sticky save bar 文案模糊（仅 "No changes to save"），保存失败后只在 SurfaceCard 内显错误 + Save 按钮重试，无明确 Retry 入口。本 capability 立 Settings 4 子页视觉 IA 契约——`SettingsSection` vs `SurfaceCard` 使用边界、容器嵌套深度上限、子页布局密度规则、sticky save bar 文案分支与 Retry 入口、与 `panel-and-dialog-sizing` 共担的 workspace footer 内容预留契约。

实现层 SSOT 在 `packages/ui-office/src/components/settings/settings-primitives.tsx`，导出 `SettingsSection` (无 border / bg / radius，顶部 1px 分割线 + 段标题) + `SurfaceCard` (24px 圆角 + border + bg) 两个互补 primitive；MCP server list 按 `transport` 分组渲染；sticky bar 在 `SettingsContentArea.tsx`，External tab 始终隐藏（无 dirty 概念）。

## Requirements

### Requirement: Settings tab body has at most one visual container layer

Each Settings tab body — Provider / Runtime / MCP / External — SHALL contain at most **one** visual container layer (= `SurfaceCard` or any element carrying border + background-fill + ≥12px border-radius). The Settings workspace shell itself counts as zero. `SettingsSection` (defined in this spec) is a row-separator + heading and SHALL NOT be counted as a visual container.

#### Scenario: Provider tab body has at most one SurfaceCard
- **WHEN** the user opens Settings → Provider tab at viewport `1440x900`
- **THEN** the tab body SHALL render with at most one `SurfaceCard` (or equivalent border+bg+rounded container)
- **AND** the previously inline `div.rounded-[20px]` "Resolved product" inner card SHALL NOT exist

#### Scenario: Runtime tab body has at most one SurfaceCard
- **WHEN** the user opens Settings → Runtime tab at viewport `1440x900`
- **THEN** the tab body SHALL render with at most one `SurfaceCard` (the desktop-only `VaultDirectorySection` is the permitted single visual container; the rest of the tab uses `SettingsSection` rows)
- **AND** the prior 5 `SurfaceCard` siblings SHALL NOT all coexist

#### Scenario: MCP tab body has at most one SurfaceCard
- **WHEN** the user opens Settings → MCP tab at viewport `1440x900`
- **THEN** the tab body SHALL render with at most one `SurfaceCard` wrapper, and the inner `ui-core/Card` instances previously nested inside SHALL be replaced by `SettingsSection` rows
- **AND** there SHALL be no element chain producing 3 or more nested borders inside the MCP tab

#### Scenario: External tab body has at most one SurfaceCard
- **WHEN** the user opens Settings → External Employees tab
- **THEN** the tab body SHALL render with at most one `SurfaceCard` wrapper
- **AND** individual external-employee row containers SHALL use `rounded-lg` flat list rows (not `SurfaceCard` per row)

### Requirement: SettingsSection primitive is the canonical row separator

A `SettingsSection` primitive SHALL be exported from `packages/ui-office/src/components/settings/settings-primitives.tsx` with the signature `SettingsSection({ title, description?, action?, children })`. The rendered DOM SHALL be a `<section>` that:

- Uses `border-t border-white/5 pt-6 first:border-t-0 first:pt-0` for inter-section separation (top divider only)
- Renders `title` as an `<h3>` with `text-sm font-semibold tracking-wide uppercase` styling
- Renders `description` (when provided) as a `<p>` with `text-xs text-white/55` styling underneath the heading
- Renders `action` (when provided) right-aligned in the header row (e.g., a "Connect agent" button)
- Wraps `children` in a `<div class="space-y-3">` content region

`SettingsSection` SHALL NOT carry its own `border`, `background-color`, or `border-radius` styling. It is a layout/heading primitive, not a visual container.

#### Scenario: SettingsSection exports the documented signature
- **WHEN** auditing `packages/ui-office/src/components/settings/settings-primitives.tsx`
- **THEN** the file SHALL export `SettingsSection` with props `{ title: string; description?: string; action?: React.ReactNode; children: React.ReactNode }`

#### Scenario: SettingsSection has no visual container styling
- **WHEN** inspecting the rendered DOM of any `SettingsSection`
- **THEN** the `<section>` SHALL NOT have computed `border-radius > 0`, `border-width > 0`, or non-transparent `background-color`

#### Scenario: SettingsSection used as the dominant Settings layout primitive
- **WHEN** grepping `packages/ui-office/src/components/settings/Settings{Provider,Runtime}Tab.tsx` and `McpConfigPanel.tsx` for `<SettingsSection`
- **THEN** there SHALL be at least 2 `<SettingsSection>` usages in `SettingsRuntimeTab.tsx` (Runtime defaults + Conversation memory & summarization)
- **AND** at least 1 `<SettingsSection>` usage in `SettingsProviderTab.tsx` (Advanced routing)
- **AND** at least 2 `<SettingsSection>` usages in `McpConfigPanel.tsx` (Add server form + Configured servers list)

### Requirement: Provider tab uses single resolved-product summary line

`SettingsProviderTab.tsx` SHALL render the currently selected product as a single inline summary row at the top of the right column, NOT as a nested `SurfaceCard` or hand-written `div.rounded-[20px]` inner card. The summary row SHALL include the product display name and a tone chip (using the canonical `Badge` primitive from `@offisim/ui-core`) indicating access mode. The "Advanced routing" SettingsSection SHALL appear exactly once at the bottom of the right column.

#### Scenario: Resolved product is inline summary, not card
- **WHEN** auditing `SettingsProviderTab.tsx` at the location formerly housing `div.rounded-[20px]` inner card
- **THEN** the resolved-product display SHALL be a single `<div>` with text + `<Badge>` tone chip
- **AND** SHALL NOT include `border`, `border-radius >= 12px`, or non-transparent `background-color` on the wrapping `<div>`

#### Scenario: Advanced routing renders exactly once
- **WHEN** auditing `SettingsProviderTab.tsx` for the literal string "Advanced routing" (case-insensitive)
- **THEN** the string SHALL appear exactly once as a `SettingsSection` title

#### Scenario: Provider double-column layout density
- **WHEN** the user opens Settings → Provider at viewport `1440x900`
- **THEN** all Provider configuration fields (product picker + access mode + API key + endpoint override + default model + default headers + execution lane + Advanced routing) SHALL be visible without vertical scroll inside the tab body
- **AND** the `xl:grid-cols-[340px_minmax(0,1fr)]` two-column layout (Tailwind v4 underscore arbitrary syntax) SHALL be active at viewport ≥ 1280

### Requirement: Runtime tab merges defaults and memory groups

`SettingsRuntimeTab.tsx` SHALL render the runtime configuration in exactly **two** `SettingsSection` rows (plus the standalone `VaultDirectorySection` on desktop):

- `SettingsSection "Runtime defaults"` SHALL contain: execution mode, tool search, git auto-commit, display density, and employee runtime default (`RuntimeBindingControl scope="company"`). Fields SHALL use a dense grid layout (`md:grid-cols-2 xl:grid-cols-3`).
- `SettingsSection "Conversation memory & summarization"` SHALL contain: memory configuration (4 fields) and summarization configuration (3 fields), with H4 sub-headings to differentiate sub-groups but no additional `SurfaceCard` borders between them.

The previously separate 5 SurfaceCards ("Runtime orchestration", "Runtime controls", "Summarization", "Memory", "Default employee runtime") SHALL be replaced by these 2 SettingsSection rows. The display-density toggle SHALL use the canonical `SegmentedControl` primitive from `@offisim/ui-core` (not a hand-rolled 3-button div). Repeated boolean Selects (Tool search / Git auto-commit / Memory enabled / Prompt injection / Summarization enabled) SHALL be expressed via a shared `BooleanSelect` helper inside the file; repeated numeric inputs (Max facts / Confidence threshold / Trigger tokens / Keep recent) SHALL be expressed via a shared `NumberField` helper.

#### Scenario: Runtime tab renders exactly two SettingsSection rows
- **WHEN** the user opens Settings → Runtime tab
- **THEN** the tab body SHALL render exactly 2 `SettingsSection` rows for runtime configuration
- **AND** `RuntimeBindingControl scope="company"` SHALL be inside the "Runtime defaults" SettingsSection

#### Scenario: Runtime defaults uses dense grid
- **WHEN** the "Runtime defaults" SettingsSection renders at viewport `1440x900`
- **THEN** its inner field grid SHALL apply `xl:grid-cols-3` (or denser)

#### Scenario: Memory and summarization share one SettingsSection
- **WHEN** auditing `SettingsRuntimeTab.tsx`
- **THEN** memory fields and summarization fields SHALL be inside the same `SettingsSection` row (titled "Conversation memory & summarization" or equivalent), differentiated only by H4 sub-headings, NOT by separate `SurfaceCard` containers

### Requirement: MCP tab groups configured servers by transport

`McpConfigPanel.tsx` SHALL render the "Configured servers" list grouped by `server.transport` (one group per distinct transport: `stdio`, `sse`, `http`). Each group SHALL have a small heading row showing the transport label and the count (e.g., "STDIO · 3"). Server rows within a group SHALL render as flat list rows (no `Card` per row, no per-row border + bg).

The "Add MCP server" form SHALL render as a single `SettingsSection` at the top of the tab, NOT as an independent `Card`. The two prior `ui-core/Card` containers SHALL be removed.

#### Scenario: Configured servers grouped by transport
- **WHEN** the user opens Settings → MCP tab with at least 2 servers of different transports configured
- **THEN** the "Configured servers" SettingsSection SHALL render one sub-group per distinct `server.transport` value present in the configuration
- **AND** each sub-group SHALL display the transport label (uppercase) and the count of servers (format `${TRANSPORT.toUpperCase()} · ${count}`)

#### Scenario: MCP server rows are flat
- **WHEN** auditing `McpConfigPanel.tsx`
- **THEN** the per-server row markup SHALL NOT contain `<Card>` (from `ui-core`) or `<SurfaceCard>` wrapping
- **AND** each row SHALL be a flex row with `rounded-md` + transparent background or a subtle hover-only background tint, no full-time border

#### Scenario: Add MCP server is a SettingsSection
- **WHEN** auditing `McpConfigPanel.tsx`
- **THEN** the "Add MCP server" form SHALL be wrapped by `<SettingsSection title="Add MCP server">` (or equivalent), NOT by `<Card>` or `<SurfaceCard>`

#### Scenario: Server list re-render preserves identity
- **WHEN** a user adds, removes, or reconnects an MCP server while the panel is open
- **THEN** unaffected server rows SHALL preserve their React component instances (no unmount/remount flicker)
- **AND** every rendered row SHALL use a stable `key` derived from `server.serverId ?? "local:" + server.name`

### Requirement: Sticky save bar shows specific disabled and failure copy

`SettingsContentArea.tsx` sticky save bar SHALL render distinct copy for each lifecycle state:

| Controller state | Button label | Tooltip / hint copy |
|------------------|--------------|---------------------|
| `!hasUnsavedChanges` | `Save changes` | tooltip: `No changes to save` |
| `hasUnsavedChanges && !isSaving && !saveError` | `Save changes` | tooltip: `Save provider + runtime changes` (or equivalent specific copy) |
| `isSaving && !isReinitializing` | `Saving…` | tooltip: `Saving changes`; button disabled |
| `isReinitializing` | `Saving…` | hint text under bar: `Reinitializing runtime` |
| `saveError != null` | `Save changes` | tooltip: `Save failed — retry`; hint area BELOW the sticky bar SHALL show the error message; hint area SHALL include a `<button>Retry</button>` that re-invokes `handleSave` and is disabled while `isSaving` is true |

Note: `controller.isSaving` is the merged flag (`save.isSaving || save.isReinitializing`); the controller separately exposes raw `isReinitializing` so the hint line can call out the reinit phase distinctly. Consumers SHOULD use the merged `isSaving` for all gating to keep button states consistent.

The Retry button (when present) SHALL be visually subordinate to the main Save button (e.g., text-link styling, not a primary CTA chip).

#### Scenario: No-changes state shows specific tooltip
- **WHEN** the user is on Settings → Provider or Runtime tab and has not edited any field
- **THEN** the sticky save bar Save button SHALL be disabled
- **AND** its `title` attribute SHALL equal `No changes to save`

#### Scenario: Saving state shows progress label
- **WHEN** the user clicks Save and the save call is in flight
- **THEN** the button label SHALL be `Saving…` and the button SHALL be disabled

#### Scenario: Reinitializing state shows hint
- **WHEN** the runtime is reinitializing after a successful save (`isReinitializing === true`)
- **THEN** a hint line `Reinitializing runtime` SHALL render adjacent to or below the save bar
- **AND** the button SHALL still display `Saving…` (since `isSaving` exposes the merged value)

#### Scenario: Save failure exposes Retry entry point
- **WHEN** `handleSave` rejects and `saveError` is set
- **THEN** the error message SHALL render below the sticky save bar in a hint region
- **AND** a `<button>Retry</button>` SHALL render in the same hint region
- **AND** clicking Retry SHALL re-invoke the same `handleSave` function

#### Scenario: Retry disabled during in-flight save
- **WHEN** the user clicks Retry and a new save attempt starts (`isSaving === true`)
- **THEN** the Retry button SHALL be disabled until the new attempt resolves

#### Scenario: External tab hides save bar
- **WHEN** `activeTab === 'external'`
- **THEN** the sticky save bar SHALL NOT render

### Requirement: Settings sub-page content area reserves bottom padding for sticky save bar

When the sticky save bar is rendered (any tab except External), the Settings content area SHALL reserve `padding-bottom` ≥ the rendered height of the sticky bar so the last form field, validation message, or list row in any tab is fully visible above the bar at every supported viewport (≥ 768px width).

#### Scenario: Last field visible above sticky bar
- **WHEN** the user scrolls any Settings tab content (Provider / Runtime / MCP) to the bottom at viewport `1440x900`
- **THEN** the last visible field, button, or list row SHALL be fully visible above the sticky save bar
- **AND** the sticky save bar SHALL NOT obscure any content the user can interact with

#### Scenario: Tab switch does not change content-area height
- **WHEN** the user switches between Provider / Runtime / MCP / External tabs at viewport `1440x900`
- **THEN** the workspace surface outer container's computed `height` SHALL NOT change as a side effect of the tab change
- **AND** any tab content longer than the visible region SHALL scroll inside the tab content scroller, not expand the workspace shell

### Requirement: Settings primitives module exports remain backward-compatible

The existing `SurfaceCard` export from `settings-primitives.tsx` SHALL continue to be exported with its current props signature. The newly added `SettingsSection` primitive SHALL be additive. No consumer outside `packages/ui-office/src/components/settings/` SHALL be required to update imports.

#### Scenario: SurfaceCard remains exported
- **WHEN** auditing `settings-primitives.tsx`
- **THEN** `SurfaceCard` SHALL remain exported with its existing props (`title`, `description?`, `icon?`, `children`, `className?`)

#### Scenario: External consumers untouched
- **WHEN** grepping the repo for `from '.+/settings/settings-primitives'` outside `packages/ui-office/src/components/settings/`
- **THEN** any non-zero matches SHALL still resolve correctly without code changes

### Requirement: Settings tab nav does not render an inner collapse toggle

`SettingsTabNav` SHALL NOT render a collapse / expand toggle button on its vertical orientation. The Settings workspace SHALL rely on the existing workspace-level collapse handle (the right rail / left rail collapse mechanism on the app shell) for any panel-level collapse semantics; an additional inner collapse control on the Settings tab nav is redundant and visually conflicts with a back affordance. As a result, `SettingsTabNav` SHALL NOT accept `collapsed` or `onToggleCollapse` props, and SHALL NOT compute a `verticalCollapsed` visual state.

#### Scenario: Vertical Settings tab nav has no collapse button
- **WHEN** the Settings workspace renders at viewport `1440x900` with the vertical tab nav (`orientation='vertical'`)
- **THEN** `SettingsTabNav` SHALL render only the 4 Settings tab buttons (Provider / Runtime / MCP / External Employees)
- **AND** there SHALL NOT be any additional `<button>` rendered above the tab list for collapse / expand purposes
- **AND** there SHALL NOT be any chevron-only icon button at the top of the nav that toggles the nav width

#### Scenario: SettingsTabNav props do not expose collapse handlers
- **WHEN** auditing the public props of `SettingsTabNav` exported from `packages/ui-office/src/components/settings/SettingsTabNav.tsx`
- **THEN** the props type SHALL NOT include `collapsed?: boolean` or `onToggleCollapse?: () => void`
- **AND** no internal `verticalCollapsed` derived value SHALL be computed
- **AND** no consumer (`SettingsPage`, `SettingsWorkspaceSurface`, or `useSettingsWorkspaceController`) SHALL pass collapse-related props to it
