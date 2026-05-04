## ADDED Requirements

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
