# Quarantine — dead-code-2026-07-21

Isolated (not deleted) candidates from the Dead Code And Docs Cleanup Loop on
2026-07-21 NZST. Gate-unprovable removals land here first.

## `connect-calendar-meetings.css`

Orphan Workspace Calendar/Meetings styles formerly in
`apps/desktop/renderer/src/surfaces/office/rail/connect/connect.css`
(`.off-ws-cal*`, `.off-ws-evt*`, `.off-ws-meet*`, `.off-ws-attendee*`).

Evidence:
- Consumer `CalendarApp.tsx` removed in `da992cc8` (2026-07-12); CSS was ported
  into Connect without a TSX remount.
- Monorepo grep: zero `className` / string references in TS/TSX/JS.
- Design prototypes use different class names (`.cal` / `.evt`), not `off-ws-*`.
- `pnpm validate` / `check:ui-hygiene` / knip do not assert these selectors
  (gate-unprovable → quarantine, not direct delete).

Re-delete review: after one release cycle with no restore request.
