## MODIFIED Requirements

### Requirement: Step inspector reflects selection

The right inspector SHALL render details for the step identified by `selectedStepId`, sourced from the parsed `SopDefinition`. The inspector is read-only — editing flows through `SopAddStepPopover` (double-click) or `SopNodeContextMenu` (right-click → Edit), not through the inspector.

The inspector SHALL present its content as a V3 rail-style sectioned scroll panel: each section is an `.insp-sec` block — a caps label (`--fs-micro`, uppercase, `--ls-caps` tracking, weight ~680, `--ink-3`) followed by a content block — with sections separated by a `--line-soft` bottom border (the last section has none), `--sp-5` section padding, and `--sp-3` inner gap. This is a visual reskin only: the inspector's data sources, copy logic, and the existing copyable-`output_key` / last-error sections are unchanged.

#### Scenario: Inspector shows full step details
- **WHEN** `selectedStepId` matches a step in the current definition
- **THEN** the inspector renders: full `label`, full `role_slug`, full `instruction` (no truncation), dependency list (each row showing the upstream step's `label` for human readability, not just `step_id`), `output_key` (monospace, copyable), runtime `status` if available

#### Scenario: Inspector sections use line-soft dividers
- **WHEN** a step is selected and the inspector renders
- **THEN** each section is an `.insp-sec` block (caps label + content block) separated by a `--line-soft` bottom border, with none on the last section, `--sp-5` padding, and `--sp-3` inner gap
- **AND** the section data/copy behavior (instruction, dependencies, copyable output key, last-error) is unchanged by the reskin

#### Scenario: Inspector empty state when no step selected
- **WHEN** `selectedStepId === null` while a SOP is loaded
- **THEN** the inspector renders an empty state with placeholder copy ("Select a step to inspect") and remains visible at the configured width

#### Scenario: Inspector clears when step is deleted
- **WHEN** the currently inspected step is deleted (via context menu or NL command)
- **THEN** `selectedStepId` resets to `null` and the inspector returns to its empty state on the next render

#### Scenario: Inspector reads pre-existing selection state
- **WHEN** the user clicks a node (not in edit mode) and `selectedStepId` is set as today
- **THEN** the inspector and the existing `SopNlCommandBar` prefill BOTH receive the selection from the same `selectedStepId`; there is no duplicated selection model

### Requirement: Release canvas layers share one graph transform

`SopDagCanvas` SHALL keep all user-visible graph elements on one coherent translate/scale path in Tauri release `.app`. Node faces that require HTML layout MUST render in a normal HTML overlay transformed with the graph transform, not as SVG `foreignObject`. Native SVG layers MAY render grid, edges, temporary connection previews, ports, node drag hit rects, and edge disconnect hit areas, but they MUST use the same graph coordinates as the HTML node overlay.

The V3 reskin (Phase 6) SHALL NOT alter this rendering architecture, the topo-sort layout, drag-to-connect with cycle prevention, pan/zoom, or node-drag persistence (`onMoveStep` → `updateDefinition` → `repos.sopTemplates.update(id, { definition_json })`). `SopDagCanvas`, `sop-dag-layout.ts`, `SopDagNode`, and `SopDagEdge` are out of scope for this phase and do not enter the diff.

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

#### Scenario: Reskin leaves the canvas transform untouched
- **WHEN** the Phase 6 inspector / run-strip reskin ships
- **THEN** node cards, ports, and edges still move together under one graph transform with no layered misalignment in Tauri release `.app`
- **AND** drag-to-connect, cycle prevention, pan/zoom, and node-drag persistence behave exactly as before
