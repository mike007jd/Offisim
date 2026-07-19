# PR-U3 · Shared card/list-row primitives evidence

Checked at: 2026-07-19 (Pacific/Auckland)

## Contract

- Added renderer-local `SelectableCard` and `ListRow` primitives under `apps/desktop/renderer/src/components/`; no shared visual UI package was introduced.
- Migrated the frozen nine-card inventory: employee, wizard template, placement, loop, market, team, board, deliverable, and run-record cards.
- Migrated the Roster, Thread, and Message rows. `ListRow` exposes avatar/title/subtitle/meta/selected vocabulary while each caller retains its exact root element, classes, handlers, accessibility attributes, and child order.
- No CSS, copy, state ownership, query behavior, or product behavior changed.
- Dialog audit found that every dialog extracted by U2 already consumes the renderer's existing `@/design-system/primitives/dialog.js`. U3 therefore makes no Dialog edit; adding another wrapper would violate the roadmap's shared-primitive intent.

## Static proof

- TypeScript AST before/after oracle normalized each primitive back to its emitted root element and compared DOM tag, class-token set, handlers, `aria-*`, `disabled`, `style`, and `title`: `12/12 PASS` (nine cards plus Roster/Thread/Message rows; MessageRow's two root variants both matched).
- `pnpm --filter @offisim/desktop-renderer typecheck`: PASS, exit `0`.
- `pnpm --filter @offisim/desktop-renderer build`: PASS, exit `0`.
- Targeted Biome check across both primitives and all eleven migrated callers: PASS, exit `0`.
- `node scripts/release-gates.mjs --lane=node`: PASS, exit `0`, `4 gate(s) green`; the run included the full validation, UI-hygiene, security-harness, and production-audit gates.
- `pnpm --filter @offisim/desktop build`: PASS, exit `0`; a signed release app was produced. Notarization was not attempted because this local environment has no notarization credentials.
- No stylesheet was edited. `git diff --check`: PASS.

`ThreadRow` was the only HIGH-risk GitNexus result (`8` upstream symbols, `2` direct callers, one OfficeSurface execution flow). The risk was surfaced before editing. Mitigation was exact DOM/class/handler preservation in the AST oracle plus release-app Connect interaction below. All other migrated symbols were LOW risk.

## Release app proof

Baseline: U2 commit `51bdffc70b83f95d776c287a9880a1c049fbb9fe`, rebuilt in an isolated detached worktree as a signed release app. Its window was resolved before automation as PID `43057`, CGWindowNumber `33210`, title `Offisim`, bounds `1440x886@36,33`, AX URL `tauri://localhost`. The temporary baseline worktree and app were removed after capture; the screenshots remain in this evidence directory.

U3 artifact:

`/Users/haoshengli/worktrees/offisim-refactor-u2/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`

The U3 window was resolved before automation as PID `29837`, CGWindowNumber `33185`, title `Offisim`, bounds `1440x886@36,33`, AX URL `tauri://localhost`. Computer Use targeted the exact artifact path, not the shared bundle identifier. The release app was closed after verification and its process exit was confirmed.

Verified interactions:

- TeamDock card: clicked Alex Chen. The Popover opened at the card anchor and focus landed on the model combobox, proving the polymorphic `SelectableCard` preserved the `PopoverTrigger asChild` ref/focus contract.
- Personnel RosterRow: selected an employee and rendered the detail pane.
- Board card: selected a request and opened its detail drawer.
- Connect ThreadRow/MessageRow: created a mentions-only group with Alex and Maya, sent the boss-only message `U3 ListRow live verify` without invoking a model, returned to the thread list, reselected the new ThreadRow, and rendered the MessageRow. The verification thread was then archived through the product UI and disappeared from the active list.

## Visual comparison

| Surface | Baseline | U3 | Evidence |
| --- | --- | --- | --- |
| TeamDock Popover | `baseline-01-team-popover.png` | `01-team-popover.png` | Same Alex-card state. Tight Popover crop `313x397+567+288`: raw AE `32`; with `1%` raster tolerance AE `0 (0)`. Overlay inspection found `0px` geometry displacement. |
| Personnel selected row | `baseline-02-personnel-selected.png` | `02-personnel-selected.png` | Role-equivalent selected-row/detail state. The captured employee differs (Alex vs Maya), so no pixel-identity claim is made. Manual overlay inspection found no row/panel geometry displacement above the roadmap's `2px` limit. |
| Board selected card | `baseline-03-board-card-selected.png` | `03-board-card-selected.png` | Role-equivalent selected-card/drawer state over live request data. Dynamic request content differs, so no pixel-identity claim is made. Manual overlay inspection found no card/drawer geometry displacement above `2px`. |
| Connect Thread/Message rows | `../PR-U2/after-05-connect-draft.png` | `04-connect-thread-message.png` | Release Connect shell baseline versus U3 live persisted thread/message state. Dynamic row content differs, so no pixel-identity claim is made. Manual inspection found no rail/row/message geometry displacement above `2px`; exact row DOM/class/handler parity is covered by the AST oracle. |

Full-frame AE is intentionally not used: the release screenshots include live 3D animation, pointer/focus glow, relative-time text, and different live entities. The same-state TeamDock crop is the only valid pixel metric; the other surfaces use role-equivalent release interactions, manual `<=2px` geometry review, and the exact AST structural oracle.

## Cleanup and merge state

- Both release-app processes exited after capture.
- The detached U2 baseline worktree was clean and was removed after evidence capture.
- No merge was performed or attempted.
