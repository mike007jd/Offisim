# R5 differentiation depth live verification — 2026-07-18

## Status

`PASS`: the exact rebuilt release `.app` completed a mixed Pi API + Codex CLI competitive draft from parallel execution through side-by-side review, winner merge, and loser cleanup. Existing track record now produces deterministic, visible seniority without new persisted counters.

## Scope and evidence lineage

- Requirement source: `Docs/roadmap/2026-07-18-usability-polish-round.md`, R5.
- Branch: `feat/r5-differentiation-depth`.
- Release app: `apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`.
- Evidence: `~/.dev-dispatch/evidence/offisim/r5-depth-2026-07-18/`.
- The release app was launched as one exact-path instance. The original `~/.offisim` was moved aside before verification and restored after the verified window closed.

## Verification result

| Assertion | Result | Evidence |
|---|---|---|
| One request card assigns at least one Pi employee and one Codex employee | PASS | `17-closure-pi-codex-selected.png` |
| Both engines execute in parallel | PASS | `18-closure-parallel-running.png` |
| Comparison shows both engines side by side with per-attempt token and duration facts | PASS | `19-closure-side-by-side-ready.png`; Pi `>=22,326 tok`, Codex `>=27,863 tok · 34s` |
| Selecting Pia's Pi proposal merges it into the root project | PASS | `20-closure-winner-merged-loser-cleaned.png`; root `R5_CLOSURE.md` |
| Cody's losing Codex proposal is discarded with no branch or worktree residue | PASS | `20-closure-winner-merged-loser-cleaned.png`; `cleanup-proof.txt` |
| Personnel list distinguishes experienced and new employees | PASS | `21-personnel-list-new-hire-below-threshold.png` |
| Exact upper threshold example reaches Senior hand | PASS | `22-personnel-profile-senior-at-threshold.png`: 5 tasks + 0 wins x 2 + 3 lessons = 8 |
| Just-below threshold example remains New hire | PASS | `23-personnel-profile-new-hire-below-threshold.png`: 0 tasks + 0 wins x 2 + 2 lessons = 2 |
| Scene hover exposes the experienced employee's title | PASS | `28-scene-hover-cody-senior.png`: `Level 3 · Senior hand` |
| Scene hover exposes the new employee's title | PASS | `35-scene-hover-nia-new-hire.png`: `Level 1 · New hire` |

## Product and runtime decisions

- Seniority is derived from existing completed-task, comparison-win, and experience-entry repositories. The score is `completed tasks + comparison wins x 2 + experience entries`; levels begin at 0, 3, and 8. No schema, migration, compatibility fallback, or second ledger was added.
- Competitive lanes instruct every engine to modify only its assigned worktree and leave branch, commit, capture, merge, and cleanup ownership to Offisim.
- Pi's deferred competitive child result now enters the same deterministic Offisim capture path as other proposals. The production gateway accepts the verified prepared child identity for the Pi orchestration shell, then attributes the terminal result to the root run; unrelated runs retain strict root identity checks.
- Engine/model facts remain visible inside each comparison card. No status element was added to the stage tab row, and no renderer-root margin was introduced.

## Automated and release gates

- Renderer typecheck: PASS.
- Renderer production build: PASS.
- `node scripts/release-gates.mjs --lane=node`: PASS.
- Cargo library tests: PASS, 456 tests.
- `pnpm harness:pi-agent-host`: PASS, including Pi delegation integration.
- Desktop release build: PASS; the generated Pi host bundle was rebuilt into the packaged application.

## Live notes

The accepted group is `draft-group-b8e525e9-6db5-4216-b520-a011f0332fa9`. Pia Stone's Pi API attempt finished as `winner`; Cody Vale's Codex CLI attempt finished as `not_selected`. The root project contains the merged deliverable and a clean Git status; both successful-group lease worktrees and branches are absent. Earlier numbered screenshots are retained as diagnostic lineage for the root-cause fixes; screenshots 17 onward are the final acceptance sequence. No localhost or dev WebView evidence is used.
