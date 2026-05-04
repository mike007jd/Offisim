## Design

### SOP DAG layer model

The release `.app` failure came from mixed rendering ownership: HTML cards were inside SVG `foreignObject`, while ports and edges were native SVG. In Tauri/WebKit, that made node cards and SVG interaction geometry drift under the same logical graph transform.

The durable model is three layers inside `SopDagCanvas`:

- Bottom SVG: dot grid, visual edges, temporary dashed Bezier preview.
- Middle HTML overlay: `SopDagNode` cards, positioned in canvas coordinates and transformed with CSS `translate(...) scale(...)`.
- Top SVG interaction overlay: ports, transparent node drag rects, and edge disconnect hit areas.

This keeps all graph math in one coordinate system while letting each rendering technology do the job it is good at: HTML for card layout, SVG for precise graph hit geometry.

### Interaction contracts preserved

- Non-edit mode: node cards own click selection; ports are visible at low opacity and do not take pointer events.
- Edit mode: node cards do not own pointer events; SVG drag rects own card drag/context/double-click; ports own drag-to-connect.
- Drag-to-connect uses coordinate hit-testing for drop resolution, so release behavior does not depend on SVG group bubbling.
- No schema or persistence model changes; all SOP mutations still flow through the existing SOP definition update path.

### Bucket 7 and 8 consolidation

Personnel and Settings did not need additional design changes in this final fix. Their release `.app` evidence was consolidated into this change so buckets 6/7/8 close as one frontend-UX debt batch instead of leaving two already-verified buckets open.
