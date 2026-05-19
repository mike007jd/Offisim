# company-creation-flow Specification

## Purpose

Company creation 之前在 13 张 UX 截图里反复出现两个基础信任问题：(1) `Back` 按钮悬在 dialog header 角落像 close icon，与底部的 `Company Name` input + `Start` / `Open Studio Editor` 主操作行视觉脱节，操作流被打断；(2) 用户点 `Open Studio Editor` 期待 "create + 直接进 Studio 编辑模式"，但实际只是创建公司停在主界面，名实不符（产品 closure bar："不要靠 fallback 假装完成"）。

本 capability 定义 Company creation footer 的 **行布局** 契约（Back / Company Name / Start / Open Studio Editor 单行同位）+ **Open Studio Editor** 的 **三步原子组合** 行为契约（create → activate → open Studio in edit mode），并把 click handler 的实现形态约束成 "单 async sequence"，禁止 `useEffect` 链watch state 来组合流程。Offisim 因 `<OffisimRuntimeProvider key={companyId}>` 强制 company switch 触发 App tree re-mount，handler 内 set 一次 sessionStorage intent marker（`offisim:pending-view = 'studio-edit'`），新 tree 的 `useCompanyBootstrap` 在第一个 mount-bootstrap 内消费一次并清掉——这是显式 one-shot bridge，不是 state-watching effect chain。

实现入口：`packages/ui-office/src/components/onboarding/CompanyCreationWizard.tsx`、`apps/desktop/renderer/src/hooks/useCompanyLifecycle.ts.handleCreateYourOwn`、`apps/desktop/renderer/src/hooks/useCompanyBootstrap.ts.PENDING_VIEW_KEY`。

## Requirements

### Requirement: Company creation footer holds Back, name input, and primary actions in one row

The Company creation dialog SHALL render its primary action surface as a single footer row containing `Back`, the Company Name input, `Start`, and `Open Studio Editor` controls. `Back` SHALL NOT live in the dialog header alongside the close icon. On narrow viewports the same controls SHALL stack into a single column following `responsive-app-shell`'s narrow rules, but the desktop/tablet layout SHALL be a single horizontal row.

#### Scenario: Desktop footer row
- **WHEN** Company creation dialog is open at `1440x900`
- **THEN** `Back`, `Company Name` input, `Start`, and `Open Studio Editor` SHALL render on a single horizontal row at the dialog footer
- **AND** the dialog header SHALL NOT contain a `Back` control

#### Scenario: Tablet footer row
- **WHEN** Company creation dialog is open at `1280x800`
- **THEN** the same four controls SHALL render on a single horizontal row at the dialog footer

#### Scenario: Narrow stacks footer into single column
- **WHEN** Company creation dialog is open at `390x844`
- **THEN** `Back`, `Company Name`, `Start`, and `Open Studio Editor` SHALL stack vertically following the narrow rules in `responsive-app-shell`
- **AND** all four SHALL remain reachable without horizontal scrolling

### Requirement: Open Studio Editor performs create, activate, and open in one action

The `Open Studio Editor` control SHALL atomically (a) create the company from the form, (b) set that company as the active company, and (c) open Studio in edit mode, in that order, before closing the Company creation dialog. The control SHALL NOT close the dialog if any of the three steps fails. The control SHALL NOT leave the system in a half-completed state where a company is created without being activated, or activated without Studio opening.

#### Scenario: Successful Open Studio Editor flow
- **WHEN** the user fills the required Company Name field and clicks `Open Studio Editor`
- **THEN** the system SHALL create the company, set it as the active company, and open the Studio overlay in edit mode bound to that company
- **AND** the Company creation dialog SHALL close only after Studio open succeeds

#### Scenario: Company creation failure leaves dialog open
- **WHEN** the user clicks `Open Studio Editor` and the create-company step fails
- **THEN** the dialog SHALL remain open
- **AND** the failure reason SHALL be surfaced inline (banner, field error, or toast)
- **AND** no company SHALL be persisted, no active company SHALL be changed, and Studio SHALL NOT open

#### Scenario: Activation failure does not silently open Studio against wrong company
- **WHEN** the create succeeds but the set-active-company step fails
- **THEN** the dialog SHALL remain open with a clear error
- **AND** Studio SHALL NOT open in edit mode against any company
- **AND** the freshly created company MAY remain in the database (best-effort cleanup is out of scope) but SHALL NOT be silently abandoned without user-visible error

#### Scenario: Studio open failure leaves the dialog open
- **WHEN** create and activate succeed but the Studio open step fails
- **THEN** the dialog SHALL remain open with a clear error
- **AND** the active company state SHALL reflect the freshly created company so the user can navigate to Studio manually
- **AND** the dialog message SHALL explain that the company was created and activated but Studio failed to open

### Requirement: Open Studio Editor handler is a single async sequence, not a state-watching effect chain

The `Open Studio Editor` action SHALL be implemented as a single async handler that awaits each of the three steps in order. The handler SHALL NOT compose the flow out of multiple `useEffect`s that watch state changes (e.g. one effect watching the active-company ID to trigger activation, another effect watching the active-company ID to trigger Studio open). When the host runtime forces a tree re-mount as part of company activation (Offisim's `<OffisimRuntimeProvider key={companyId}>` pattern), the handler MAY set a one-shot intent marker that the freshly mounted tree consumes on its first mount-bootstrap pass — this is NOT a state-watching effect chain because the marker is set synchronously inside the handler, consumed once on mount, and cleared.

#### Scenario: Handler awaits steps in order
- **WHEN** auditing the implementation of the `Open Studio Editor` button
- **THEN** the click handler SHALL be a single function that calls create, then signal-Studio-intent, then set-active, awaiting each step
- **AND** the click handler SHALL NOT delegate the second or third step to a `useEffect` that watches state changes
- **AND** any cross-remount handoff SHALL be a one-shot intent marker (e.g. `sessionStorage` key) that the bootstrap pass consumes once and clears, NOT a long-lived effect that re-fires on subsequent state changes

### Requirement: Start vs Open Studio Editor distinction is preserved

The Company creation dialog SHALL keep `Start` and `Open Studio Editor` as two distinct actions on the footer. `Start` SHALL create + activate the company and close the dialog without opening Studio. `Open Studio Editor` SHALL additionally open Studio in edit mode as defined above.

#### Scenario: Start does not open Studio
- **WHEN** the user clicks `Start` after filling Company Name
- **THEN** the system SHALL create the company, set it as active, close the dialog
- **AND** the system SHALL NOT open Studio in edit mode automatically

#### Scenario: Open Studio Editor does open Studio
- **WHEN** the user clicks `Open Studio Editor` after filling Company Name
- **THEN** the system SHALL execute the full create + activate + open-Studio sequence per the prior requirement
