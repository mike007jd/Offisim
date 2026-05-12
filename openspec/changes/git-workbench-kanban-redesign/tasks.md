## 1. Design Gate

- [x] 1.1 Generate refined wireframe with Codex image generation.
- [x] 1.2 Reject global `main / Auto-sync / Checks` header placement and constrain Git information to Git context.

## 2. Kanban

- [x] 2.1 Render Kanban top chip even when there are zero cards.
- [x] 2.2 Expand Kanban as a five-column panel over the center scene.
- [x] 2.3 Support drag transitions, per-column card creation, inline card editing, assignee, and blocked reason.
- [x] 2.4 Share `/kanban`, `/board`, `/k`, Tasks entry, and chip state through `officeState.kanbanOpen`.

## 3. Git Workbench

- [x] 3.1 Add right Workspace Git tab with branch, status, diff preview, local commit, checks availability, and PR readiness.
- [x] 3.2 Support selected-file staging and local commit messages.
- [x] 3.3 Keep PR-ready as compare preparation only; do not push or create remote state.
- [x] 3.4 Rename the visible Git action from sync/Auto-commit to Local commit and explain selected-files-only local semantics.

## 4. Safety

- [x] 4.1 Extend `git_exec` allowlist for status, diff, branch, remote get-url, add, commit, and rev-parse.
- [x] 4.2 Reject destructive or remote-mutating Git operations including push, reset, force, amend, and no-verify.
- [x] 4.3 Release `.app` desktop validation evidence captured.

## 5. Verification

- [x] 5.1 `pnpm --filter @offisim/ui-office build`
- [x] 5.2 `pnpm --filter @offisim/web typecheck`
- [x] 5.3 `cargo test git -- --nocapture`
- [x] 5.4 `pnpm --filter @offisim/desktop build`
- [x] 5.5 Computer Use release `.app` validation for Kanban two states, Git status/diff, local commit, and PR-ready state.
- [x] 5.6 `gitnexus_detect_changes()` pre-commit scope check.
