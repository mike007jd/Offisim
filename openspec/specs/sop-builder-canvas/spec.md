# sop-builder-canvas

## Purpose

The SOP workspace surfaces an SOP as an editable workflow graph from the first paint, instead of reading as a flat card list whose graph nature is gated behind an `Edit` toggle. Selecting a SOP renders four regions simultaneously — left `SopSidebar` (SOP list), center `SopDagCanvas` (DAG with bezier edges), right `SopInspectorPanel` (read-only step details for `selectedStepId`), bottom `SopNlCommandBar` (selected-step prefilled NL command bar). Each node face surfaces enough I/O contract to be read at a glance: label, role-coded badge, runtime status dot, dependency-count chip (omitted at zero), single-line instruction excerpt, and `→ {output_key}` monospace subline. Connection ports render on every paint with opacity gated by edit mode so the graph nature is communicated without a toggle, while drag-to-connect, node drag, and add-step affordances stay edit-mode-only. Drag-to-connect prevents cycles in real time: while dragging from an output port, hovering an input port that would create a cycle recolors that port red and a release on it short-circuits silently (no `onAddDependency`, no toast). The post-drop `validateNoCycles` toast remains the backstop for programmatic / NL-driven mutations. The inspector is read-only — editing flows through `SopAddStepPopover` (double-click) or `SopNodeContextMenu` (right-click → Edit) so the dirty-state surface stays singular. Persistence path (`repos.sopTemplates.update(definition_json)`) and dispatch path (`sendMessage(formatRunCommand(...))`) are unchanged; runtime state visualization (per-step status pulse, edge flow animation tied to dispatch events, missing-role warnings, run history) is the boundary against `sop-run-surface` (E2) and is explicitly out of scope.

## Requirements

### Requirement: Four-region builder shell

The SOP workspace SHALL render a persistent four-region layout whenever a SOP is selected: left SOP list, center DAG canvas, right step inspector, bottom natural-language command bar. The right inspector and bottom command bar MUST remain visible alongside the canvas; they MUST NOT be modal overlays or behind a toggle.

#### Scenario: SOP selected, all four regions visible
- **WHEN** a SOP is selected (`sessionState.selectedSopId !== null`) and its definition has at least one step
- **THEN** the layout renders left sidebar (SOP list), center canvas (DAG), right inspector (320px), and bottom command bar — all simultaneously visible

#### Scenario: No SOP selected
- **WHEN** `sessionState.selectedSopId === null`
- **THEN** left sidebar and bottom command bar still render; the center area shows the empty-state CTA; the right inspector is hidden (not just empty) so the empty state can use full width

#### Scenario: SOP selected but no step selected
- **WHEN** a SOP is selected but `selectedStepId === null`
- **THEN** the right inspector renders with an empty state ("Select a step to inspect") rather than disappearing

### Requirement: Node face surfaces I/O contract

Each DAG node SHALL surface enough information to read the step's place in the workflow at first glance, without hover or selection: step `label`, `role_slug` (color-coded badge), runtime `status` dot, dependency count chip (omitted when zero), `instruction` excerpt (truncated), and `output_key` subline.

#### Scenario: Step with dependencies
- **WHEN** a step has `dependencies.length > 0`
- **THEN** the node body shows a `deps · N` chip beside the role badge, where N is the dependency count

#### Scenario: Step with no dependencies
- **WHEN** a step has `dependencies.length === 0`
- **THEN** the node body shows no dependency chip (zero-state is silent)

#### Scenario: Output key always rendered
- **WHEN** a step is rendered as a node
- **THEN** the node body includes a single-line subline `→ {output_key}` in monospace small font, regardless of whether the step has consumers

#### Scenario: Long fields truncated stably
- **WHEN** `label` or `output_key` exceeds the available width
- **THEN** the field is truncated with ellipsis; node dimensions stay fixed at `DAG_LAYOUT.nodeWidth × DAG_LAYOUT.nodeHeight`; the truncation MUST NOT cause layout shift across renders

### Requirement: Connection ports always rendered

Input and output ports for every node SHALL be rendered on every paint, gated only by opacity, not by conditional mount. Ports MUST be visibly subtle (low opacity) when not in edit mode and visibly highlighted when in edit mode.

#### Scenario: Ports visible without entering edit mode
- **WHEN** a SOP is loaded and `editMode === false`
- **THEN** every node renders an input port (left edge) and output port (right edge) at low but non-zero opacity, communicating the graph nature of the SOP

#### Scenario: Ports highlighted in edit mode
- **WHEN** the user toggles `editMode === true`
- **THEN** input ports highlight in their edit color (e.g., cyan) and output ports highlight in theirs (e.g., amber); pointer affordances (`cursor-crosshair`) and hit areas activate

#### Scenario: Ports do not steal pointer events outside edit mode
- **WHEN** `editMode === false` and the user clicks on a port location
- **THEN** the port does NOT initiate a connection drag; the click falls through to the underlying node click (or to the canvas pan if on blank space)

### Requirement: Drag-to-connect with live cycle prevention

In edit mode, the user SHALL be able to drag from an output port to an input port to create a dependency. The system SHALL prevent the user from completing a drop that would create a cycle, with visible feedback while dragging — not only as a post-drop toast.

#### Scenario: Valid drag creates dependency
- **WHEN** in edit mode, the user drags from step A's output port and drops on step B's input port, and adding `B.dependencies += A` does not create a cycle
- **THEN** `onAddDependency(A, B)` is called and persists; the new edge appears on the next render

#### Scenario: Cycle-creating drag rejected with visible feedback
- **WHEN** in edit mode, the user is dragging from step A's output port and hovers over step B's input port where adding `B.dependencies += A` would create a cycle
- **THEN** step B's input port renders in a rejection color (e.g., red) while hovered; releasing on it does NOT call `onAddDependency` and does NOT show a toast (the visual was the message)

#### Scenario: Self-connection blocked silently
- **WHEN** in edit mode, the user drags from step A's output port and releases on step A's input port
- **THEN** no dependency is added; no toast fires; the drag state resets to idle

#### Scenario: Escape cancels in-flight connection
- **WHEN** a port-drag is in progress and the user presses Escape
- **THEN** the drag aborts cleanly, the candidate connection line disappears, no `onAddDependency` is called

### Requirement: Step inspector reflects selection

The right inspector SHALL render details for the step identified by `selectedStepId`, sourced from the parsed `SopDefinition`. The inspector is read-only — editing flows through `SopAddStepPopover` (double-click) or `SopNodeContextMenu` (right-click → Edit), not through the inspector.

#### Scenario: Inspector shows full step details
- **WHEN** `selectedStepId` matches a step in the current definition
- **THEN** the inspector renders: full `label`, full `role_slug`, full `instruction` (no truncation), dependency list (each row showing the upstream step's `label` for human readability, not just `step_id`), `output_key` (monospace, copyable), runtime `status` if available

#### Scenario: Inspector empty state when no step selected
- **WHEN** `selectedStepId === null` while a SOP is loaded
- **THEN** the inspector renders an empty state with placeholder copy ("Select a step to inspect") and remains visible at the configured width

#### Scenario: Inspector clears when step is deleted
- **WHEN** the currently inspected step is deleted (via context menu or NL command)
- **THEN** `selectedStepId` resets to `null` and the inspector returns to its empty state on the next render

#### Scenario: Inspector reads pre-existing selection state
- **WHEN** the user clicks a node (not in edit mode) and `selectedStepId` is set as today
- **THEN** the inspector and the existing `SopNlCommandBar` prefill BOTH receive the selection from the same `selectedStepId`; there is no duplicated selection model

### Requirement: Surface boundary against runtime and dispatch

This capability SHALL cover only the editor surface. Runtime status visualization (per-step status pulse, edge flow animation tied to dispatch events, missing-role warnings, run history) is owned by `sop-run-surface` (E2). The Run action SHALL continue to dispatch via the existing `formatRunCommand` → `sendMessage` path with no inline state changes in this capability.

#### Scenario: Run button still dispatches as today
- **WHEN** the user clicks Run on a selected SOP
- **THEN** `sendMessage(formatRunCommand(sop.name))` is called via `useOffisimRuntime`; this capability does NOT introduce a parallel dispatch path

#### Scenario: Status dots reflect runtime state when present, default to pending
- **WHEN** `useSopRuntimeState(sopTemplateId)` returns runtime step states
- **THEN** the node `status` dot reflects them (`pending` / `active` / `completed` / `failed`) using the existing color mapping; this capability does NOT add new status types or new visual treatments — those are E2's scope

#### Scenario: No persistence-model change
- **WHEN** any builder interaction mutates the SOP (add/remove dependency, move node, add/edit/delete step, duplicate step)
- **THEN** persistence MUST go through `repos.sopTemplates.update(id, { definition_json: JSON.stringify(SopDefinition) })`; this capability MUST NOT introduce a new schema field, table, or repo method

### Requirement: Release canvas layers share one graph transform

`SopDagCanvas` SHALL keep all user-visible graph elements on one coherent translate/scale path in Tauri release `.app`. Node faces that require HTML layout MUST render in a normal HTML overlay transformed with the graph transform, not as SVG `foreignObject`. Native SVG layers MAY render grid, edges, temporary connection previews, ports, node drag hit rects, and edge disconnect hit areas, but they MUST use the same graph coordinates as the HTML node overlay.

#### Scenario: Fresh release render has no node-port split
- **WHEN** a SOP is opened in Tauri release `.app`
- **THEN** node cards, ports, and edges align on first paint
- **AND** panning or zooming the canvas moves cards, ports, edges, and grid together
- **AND** no visible card remains fixed while SVG ports or edges move independently

#### Scenario: Edit-mode card drag moves the graph node as one unit
- **WHEN** edit mode is enabled and the user drags the visible face of a step card beyond the drag threshold
- **THEN** the card moves instead of panning the canvas
- **AND** that card's input/output ports and connected edge endpoints move with the card during the drag
- **AND** the final position persists through the existing SOP definition update path

#### Scenario: Drag-to-connect stays coordinate based in release
- **WHEN** edit mode is enabled and the user drags from an output port toward another step's input port
- **THEN** the output port shows an active affordance
- **AND** a dashed Bezier preview follows the pointer in graph coordinates
- **AND** the hovered input port highlights
- **AND** releasing over a valid input creates the dependency edge and the edge remains after save/redraw
