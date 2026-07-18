# R3 onboarding live verification — 2026-07-18

## Status

`PASS`: clean-database first run completed the full first-order chain in 270 seconds in the exact rebuilt release `.app`; skip and empty-state recovery paths also passed.

## Scope and evidence lineage

- Requirement source: `Docs/roadmap/2026-07-18-usability-polish-round.md`, R3.
- Branch: `feat/r3-onboarding-firstrun`.
- Release app: `apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`.
- Evidence: `~/.dev-dispatch/evidence/offisim/r3-onboarding-2026-07-18/`.
- Original local state was moved aside before each cold run and restored after both windows were closed; the two disposable verification states remain inside the evidence directory.

## Verification result

| Assertion | Result | Evidence |
|---|---|---|
| Clean launch enters guided flow | PASS | `01-cold-start.png` |
| Company and demo Project are ready | PASS | `02-company-created.png`; seeded `PROJECT_BRIEF.md` and `README.md` |
| First employee is hired and assigned to a workstation | PASS | `03-employee-hired.png` |
| Installed, logged-in Codex CLI is selectable in one action | PASS | `04-codex-selected.png` |
| Built-in lightweight request is prefilled and dispatched | PASS | `05-example-request-ready.png`, `06-request-running-live-step.png` |
| Work is visible on stage and timeline before delivery | PASS | `06-request-running-live-step.png`, `07-live-timeline.png` |
| First visible output and file are delivered | PASS | `08-first-output.png`; archived `full-flow-state/demo-projects/first-project-225520a7f656fb8dae60d7450921c124/FIRST_WIN.md` |
| Guide reaches 6/6 and points to Board | PASS | `09-guide-complete.png`, `10-board-next-step.png` |
| Wall clock stays under five minutes | PASS | process launch `16:27:07 +1200`; guide complete observed `16:31:37 +1200`; 270 seconds |
| Skip and empty-state guide entries recover the flow | PASS | `11-skip-cold.png` through `16-personnel-entry-resumes-guide.png` cover skip, company, Project, and Personnel entries; the 21/21 first-run harness covers Conversation and no-engine variants |

## Automated and release gates

- Renderer typecheck: PASS.
- Renderer production build: PASS.
- `node scripts/release-gates.mjs --lane=node`: PASS, including the 21/21 first-run onboarding harness and 861/861 template contract.
- Desktop release build: PASS; Developer ID signature verified with `codesign --verify --deep --strict`.

## Live notes

The clean machine state exposed an installed and authenticated Codex CLI, so the successful live lane used Codex. The alternative Pi Accounts route and the neither-engine dead-end copy are deterministic UI states covered by the onboarding harness. The final evidence root contains only the post-fix acceptance run; `pre-fix-live/` is retained as diagnostic lineage for the premature Live-step advancement found and fixed before acceptance. No localhost or dev WebView evidence is used.
