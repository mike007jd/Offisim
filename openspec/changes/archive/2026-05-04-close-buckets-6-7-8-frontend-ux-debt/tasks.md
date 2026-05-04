## 1. Bucket 6 — SOP canvas

- [x] 1.1 Remove `foreignObject` node rendering from `SopDagCanvas`.
- [x] 1.2 Render `SopDagNode` cards through an HTML overlay using the same translate/scale as SVG graph content.
- [x] 1.3 Keep ports, node drag rects, edge disconnect hit areas, grid, edges, and temporary Bezier preview in SVG layers.
- [x] 1.4 Preserve non-edit mode card selection and low-opacity non-interactive ports.
- [x] 1.5 Preserve edit mode node drag, context menu, double-click add/edit flows, and drag-to-connect.
- [x] 1.6 Release `.app` Q2 PASS: toolbar Add Step opens the popover inside the canvas center and the old bottom-right Add Step button is absent.
- [x] 1.7 Release `.app` Q3 PASS: dragging a visible step card moves the card, ports, and edges together; dragging empty canvas pans cards, ports, edges, and grid together.
- [x] 1.8 Release `.app` Q4 PASS: output-port drag creates a new dependency edge and it persists after save/redraw.

## 2. Bucket 7 — Personnel layout

- [x] 2.1 Release `.app` P1 PASS: detail header is horizontal with avatar left, identity middle, status chips right.
- [x] 2.2 Release `.app` P2 PASS: Profile tab uses multi-column layout at desktop width and is not clamped to a centered narrow column.
- [x] 2.3 Release `.app` P3 PASS: Appearance / Runtime / Skills / Memory / History tabs span the editor pane.
- [x] 2.4 Release `.app` P4 PASS: personnel sidebar header density is fixed.
- [x] 2.5 Release `.app` P5 PASS: Profile edit save bar spans the pane width.

## 3. Bucket 8 — Settings layout

- [x] 3.1 Release `.app` S1 PASS: Provider and Runtime tabs fill the workspace width.
- [x] 3.2 Release `.app` S2 PASS: section spacing is dense and avoids cards-in-cards.
- [x] 3.3 Release `.app` S3 PASS: Provider save bar still works after editing and restoring a field.
- [x] 3.4 Release `.app` S4 PASS: layout integrity holds in both light and dark themes.

## 4. Gates and archive

- [x] 4.1 Run `pnpm --filter @offisim/ui-office typecheck`.
- [x] 4.2 Run `pnpm --filter @offisim/ui-office build`.
- [x] 4.3 Run `pnpm --filter @offisim/desktop build`.
- [x] 4.4 Append final PASS notes to `.live-verify/buckets-6-7-8/verify-record.md`, preserving the 90dbc26d / 69676f3c failure history.
- [x] 4.5 Update root and `packages/ui-office/CLAUDE.md` with the durable SOP DAG `foreignObject` rule.
- [x] 4.6 Validate this consolidated change with `openspec validate close-buckets-6-7-8-frontend-ux-debt --strict`.
