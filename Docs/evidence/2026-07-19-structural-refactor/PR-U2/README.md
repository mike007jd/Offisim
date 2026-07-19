# PR-U2 · UI large-file split evidence

Checked at: 2026-07-19 (Pacific/Auckland)

## Contract

- Pure-move extraction from five UI monoliths into 19 colocated leaf modules.
- `ThreadDetailShell` is the only intentional structural consolidation: persisted and draft detail share the same unchanged shell markup and callbacks.
- Product behavior, copy, classes, DOM order, state ownership, and public root imports are unchanged.
- Existing source-text harnesses now read the extracted modules together with their root files; their assertions and expected contracts are unchanged.

## Static proof

- TypeScript AST body comparison against `main`: `checked: 72`, `failures: []`.
- `pnpm --filter @offisim/desktop-renderer typecheck`: PASS.
- `pnpm --filter @offisim/desktop-renderer build`: PASS.
- Final post-review `node scripts/release-gates.mjs --lane=node`: PASS, exit `0`, `4 gate(s) green`; production audit reports no vulnerabilities. This run followed the `compactPath` de-duplication and harness diff cleanup.
- `pnpm --filter @offisim/desktop build`: PASS; signed release app produced. Notarization was not attempted because this local environment has no notarization credentials.

## Release app proof

Baseline artifact:

`/Users/haoshengli/Seafile/WebWorkSpace/Offisim/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`

U2 artifact:

`/Users/haoshengli/worktrees/offisim-refactor-u2/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`

Both artifacts were rebuilt and signed immediately before comparison. Window resolution was verified before GUI automation: baseline PID `50608`, window ID `33071`; U2 PID `60905`, window ID `33094`; both titled `Offisim` with bounds `1440x886@36,33`. Computer Use targeted each full artifact path. Every comparison app instance was closed after capture and its process exit was confirmed.

Verified interactions:

- Workspace: Files tree loaded and Git tab rendered.
- Stage viewer: Open-view menu exposed Output, Browser, Preview, Review, Terminal, Run log, Files, and Computer.
- Board: 20 requests rendered and a request-detail drawer opened.
- Personnel: Alex Chen detail and Hire employee dialog rendered.
- Connect: empty company-channel list rendered; New chat → Direct message → Alex Chen opened an unsaved draft detail with the composer. No message was sent and no shared state was created.

## Visual comparison

The baseline and U2 apps were put into the same five states. The cursor was parked in the same non-interactive title-bar area for the Workspace, Board, and Personnel recaptures. `magick compare -metric AE` was run against component-owned crops; `0 (0)` means every pixel in that crop is identical.

| Surface | Baseline | U2 | Compared crop | AE |
| --- | --- | --- | --- | --- |
| Workspace Files | `before-01-workspace-files.png` | `after-01-workspace-files.png` | `260x210+10+140` file list | `0 (0)` |
| Stage view menu | `before-02-stage-menu.png` | `after-02-stage-menu.png` | `157x445+568+110` menu content | `0 (0)` |
| Board + detail | `before-03-board-drawer.png` | `after-03-board-drawer.png` | `440x693+285+75` Board stage | `0 (0)` |
| Personnel hire | `before-04-personnel-hire.png` | `after-04-personnel-hire.png` | `350x400+595+220` form | `0 (0)` |
| Connect draft | `before-05-connect-draft.png` | `after-05-connect-draft.png` | `524x693+725+75` Connect rail | `0 (0)` |

Full-frame AE is not claimed as zero because the screenshots include live 3D animation, relative-time labels, pointer glow, and JPEG capture rasterization. For the recaptured static frames: Workspace full `1.90913%` (Files panel `0.116046%`, exact file-list crop above), Board full `0.232478%`, and Personnel full `0.032109%`. The component-owned crops above are the visual-regression oracle; the paired full images retain the surrounding runtime context.

## Deviations

No product deviation from the roadmap contract. The source-location-only harness updates were required by the pure move so the existing assertions continue covering the same production code.
