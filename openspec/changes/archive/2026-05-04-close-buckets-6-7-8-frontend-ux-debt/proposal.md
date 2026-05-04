## Why

The 2026-05-02 release `.app` UX batch left three frontend buckets open after earlier fixes:

- Bucket 6: SOP canvas Q3/Q4 still failed in Tauri release because SVG `foreignObject` node faces desynchronized from SVG ports and edges.
- Bucket 7: Personnel detail layout needed release evidence that the resume/editor pane no longer collapsed into a centered narrow column.
- Bucket 8: Settings needed release evidence that Provider/Runtime surfaces use the full workspace width with professional section density.

The final Bucket 6 root cause was not another pointer-event patch. Tauri/WebKit rendered HTML node cards inside SVG `foreignObject` on a different transform path from native SVG ports/edges. The fix moves node faces to an HTML overlay and keeps only ports, drag rects, edge hit areas, grid, and edges in SVG layers.

## What Changes

- `SopDagCanvas` now renders as synchronized layers:
  - bottom SVG for dot grid, edges, and temporary dashed Bezier line;
  - middle HTML overlay for `SopDagNode` cards, transformed with the same translate/scale as the graph;
  - top SVG interaction overlay for node drag rects, ports, and edge disconnect hit areas.
- Non-edit mode remains card-click/select-first: ports render low-opacity and do not steal pointer events.
- Edit mode remains graph-edit-first: card faces do not own pointer events; the transparent SVG drag rect is the node drag/context/double-click target; ports and edge hit areas stay native SVG.
- Bucket 7 and 8 were consolidated as verified acceptance facts from the same release `.app` batch; no additional runtime/schema change was needed for those buckets.

## Capabilities

### Modified Capabilities

- `sop-builder-canvas`: adds the release transform contract for node faces, ports, edges, and drag hit zones in Tauri release `.app`.
- `personnel-workspace-surface`: records release layout requirements for the horizontal personnel detail header and full-pane inspector tabs.
- `settings-workspace-presentation`: records release layout requirements for full-width Settings Provider/Runtime surfaces and section density.

## Evidence

- Static gates:
  - `pnpm --filter @offisim/ui-office typecheck`
  - `pnpm --filter @offisim/ui-office build`
  - `pnpm --filter @offisim/desktop build`
- Release `.app` gate:
  - exact app path: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
  - mtime: 2026-05-04 18:50:25 +1200
  - Computer Use pid: 74601
  - Q2/Q3/Q4 PASS evidence appended in `.live-verify/buckets-6-7-8/verify-record.md`
