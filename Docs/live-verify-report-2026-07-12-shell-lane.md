# Shell lane live verification — 2026-07-12

## Status

`BLOCKED`: the implementation, automated gates, release build, Board/Game invariant, and split-ratio restart recovery are verified. The final live PiP proof for all five activity families remains blocked because the configured Pi route timed out twice before any tool activity.

## Scope and evidence lineage

This report supersedes shell-lane assertions that had been written into the historical 2026-06-30 report. That report is restored to its `main` version.

- B2 Connect dissolution: `~/.dev-dispatch/evidence/Offisim/b2-connect-dissolve-2026-07-12/`
- B3 experience polish: `~/.dev-dispatch/evidence/Offisim/b3-experience-polish-2026-07-12/`
- B4 stage split view: `~/.dev-dispatch/evidence/Offisim/b4-stage-split-view-2026-07-12/`
- Final-audit supplement: `~/.dev-dispatch/evidence/Offisim/final-audit-2026-07-12/`

The B3 evidence did not prove every compact workload family, and the original B4 evidence proved only the forward transition from split work views into Board. The final-audit supplement adds deterministic coverage for all five compact families, reverse Board/Game state-machine coverage, real Board/Game release screenshots, and real cold-restart ratio recovery.

## Verification result

| Assertion | Result | Evidence |
|---|---|---|
| Terminal/file/search/browser/computer use one human-readable compact boundary | Automated PASS, live BLOCKED | workload harness 36/36; final-audit `00-pip-live-provider-timeout.jpeg` records the provider timeout |
| Split state is empty or different from active; Board/Game cannot enter split | PASS | stage harness 33/33; final-audit `02-board-no-split-controls.jpeg`, `03-game-no-split-controls.jpeg` |
| Split ratio survives unmount/remount and release-app restart | PASS | stage harness; final-audit `01-split-ratio-70.png`, `04-restart-restored-ratio-70.jpeg` |
| Opposite concurrent lease decisions share the actual terminal result | PASS | workspace lease decision harness 2/2 plus Pi host/delegation harnesses |
| Renderer and release gates | PASS | renderer typecheck/build, knip, Node release lane explicit exit 0, release `.app` build and codesign verification |

## Live blocker

Two directed runs in the exact rebuilt release `.app` asked Pi to exercise terminal, file, search, browser, and computer activity. Both ended with `upstream: Request timed out.` before the first tool event, including the explicit Retry. Therefore the five-family live PiP screenshot assertion is not claimed as passing. Re-running that single assertion requires a responsive configured Pi provider route; no code or local release-build blocker remains.
