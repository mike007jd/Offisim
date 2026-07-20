# PR A4 refactor-contract convergence

- Result: `completed`
- Checked at: 2026-07-20 15:29 NZST (Pacific/Auckland)
- Branch: `refactor/A4-relative-time-empty-states`
- Release app: `/Users/haoshengli/worktrees/offisim-refactor-a4/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`

## Independent audit correction

The prior A4 implementation was rejected because it changed product behavior and presentation while labelled as a refactor:

- a fresh AI Accounts profile no longer opened the add-provider form automatically;
- handwritten one-line empty states became icon blocks with different height and spacing;
- activity timestamps changed from `just now` / `5m ago` / `5h ago` to Intl copy;
- the pre-existing shared Intl formatter changed from `Math.round` to `Math.trunc`.

The corrected implementation restores all four contracts. Empty-state DOM/CSS and the first-run effect are byte-equivalent to `origin/main`. The shared `relativeTime` keeps its original rounding. The only time deduplication now uses `relativeTimeAgo`, whose deterministic output exactly matches the four removed handwritten implementations. Connect's repeated empty copy remains a constant extraction with identical rendered text and DOM.

## Verification

- Renderer typecheck: PASS.
- Renderer production build: PASS.
- `node scripts/release-gates.mjs --lane=node`: PASS, 4/4 gates and 73/73 harnesses.
- Deterministic time oracle: PASS for future, now, minute, hour and day boundaries; existing Intl rounding also remains unchanged.
- Signed release `.app` build: PASS. Notarization was skipped because notarization credentials are not present in the environment.
- Git diff whitespace check: PASS.

## Release app proof

Computer Use was bound to the exact app path above. The confirmed main process was PID `10191` and AX reported window title `Offisim` with URL `tauri://localhost`. A stale same-bundle-id process from another worktree was identified by its executable path and closed before this app was launched.

| Surface | Result | Evidence | Observation |
| --- | --- | --- | --- |
| Settings / AI Accounts | PASS | [converged-ai-accounts.png](converged-ai-accounts.png) | Existing provider/account cards render normally; source comparison confirms the fresh-profile auto-open effect and original one-line empty states are restored exactly. |
| Settings / Tools & Integrations | PASS | [converged-tools-integrations.png](converged-tools-integrations.png) | Reachable empty server list is intact; MCP detail empty-state source is byte-equivalent to `origin/main`. |
| Loops / Library | PASS | [converged-loop-library.png](converged-loop-library.png) | Saved-plan age renders `5h ago`, preserving original copy. |
| Loops / Runs | PASS | [converged-loop-runs.png](converged-loop-runs.png) | Run age renders `5h ago`, preserving original copy. |
| Office / Board Timeline | PASS | [converged-board-timeline.png](converged-board-timeline.png) | Timeline rows render `5h ago`, `18h ago`, and `19h ago`, preserving original compact grammar. |

The release app was closed through Computer Use and PID `10191` exited. No provider, account, project, loop, conversation, or other user data was created, edited, deleted, or archived during this acceptance run.
