# T16 final release blind-test evidence

Checked at: 2026-07-17 NZST

Result: PASS — no open finding after the full round, second-round spot check, fixes, rebuild, and targeted regression.

## Identity

- Worktree: `/private/tmp/offisim-t16-final-release`
- Branch: `codex/offisim-final-release`
- Merged main baseline: `d33f5e6c`
- Tested fix commit: `a88a7bd7`
- Release app: `apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`
- Final executable SHA-256: `04806f6c9003f764a74c8a3d0cf66b43662ee0e01228f6dda2c9f29cd687504f`
- Renderer identity: `tauri://localhost`
- Full round C: PID `89639`, CGWindowNumber `15710`, title `Offisim`, bounds `x=36 y=33 1440x884`
- Round D spot check: PID `92380`, CGWindowNumber `15751`, title `Offisim`, bounds `x=36 y=33 1440x884`
- Final polling regression: PID `5343`, CGWindowNumber `15956`, title `Offisim`, bounds `x=36 y=33 1440x884`

Each run used the exact worktree app path with a fresh isolated HOME. Window identity was resolved by exact executable path, PID, CGWindowNumber, title, bounds, and renderer URL before Computer Use interaction. No bundle-id launch, AppleScript window control, localhost, dev server, or sandbox process liveness claim was used.

## Full blind round C

- Onboarding created `T16 Final C` and bound the exact isolated Project folder.
- Hiring `T16 Temp C` with role `Release Auditor` projected the QA role after the finding fix.
- Settings reported Pi API configuration plus Codex CLI `0.144.3` and Claude Code CLI `2.1.211` as Ready.
- Pi returned `PI-C` with at least 2,909 tokens and API Estimated Cost `$0.00`.
- Codex returned `CODEX-C` with at least 25,873 tokens and 18 seconds, labelled subscription / no API cost.
- Claude returned `CLAUDE-C` with 22,671 tokens and 3 seconds, labelled subscription / no API cost.
- A natural-language Loop was created, saved, started, and materialized as a project run. Its real Mission ended Blocked because the intentionally empty Project folder could not be read.
- Market degraded cleanly to `Online catalog unavailable`; Settings kept API accounting separate from CLI subscription accounting.
- The user-confirmed temporary employee deletion completed and the roster returned to the baseline team.

Evidence: [Pi](round-c-pi-complete.jpeg), [Codex](round-c-codex-complete.jpeg), [Claude](round-c-claude-complete.jpeg), [Loop terminal state](round-c-loop-blocked-converged.jpeg), [Market offline state](round-c-market-offline-state.jpeg), [Settings accounting](round-c-settings-accounting.jpeg), [Personnel deletion](round-c-personnel-delete-complete.jpeg).

## Second round and finding closure

Round D used another fresh HOME and rechecked onboarding, Project binding, hiring, all three engine states, a real Pi run, and a Loop run. It exposed that Runs could retain `Running` until navigation even though SQLite had already persisted the Mission as `blocked`.

Findings and fixes:

1. `Release Auditor` originally fell back to Developer. `roleSlug` now maps audit/quality roles to QA.
2. Runs did not observe asynchronous Mission terminalization. `useLoopRuns` now waits for its initial SQLite projection, then refreshes every five seconds even when WKWebView reports background state.

The final exact release binary loaded the persisted run, then—without navigation—refreshed `Blocked → Running → Blocked` as the isolated diagnostic row changed. The row was restored to the real `blocked` terminal state before the isolated HOME was deleted. This proves the post-fix query refresh rather than a navigation remount. Evidence: [automatic Runs refresh](round-c-loop-auto-refresh-blocked.jpeg).

No remaining product finding was observed. The Market offline message is an expected graceful state, not a blocker. Failed-round screenshots and all `/private/tmp/offisim-t16-round-*` profiles/workspaces were removed after evidence capture.

## Retained branch assets after main-first merge

- Run-cost provenance lane: retained only the missing API actual/estimated and engine-managed subscription aggregation/presentation behavior plus its harness coverage.
- Personnel Pi removal and hygiene: retained only neutral employee/persona wording and the hygiene rule missing from main.
- pnpm 11 audit client: main already contained the canonical `audit:prod` command, so the duplicate branch wrapper was dropped in favor of main.
- `prepare-desktop-cargo-test` hardening: main already contained the canonical preparation path; only non-duplicated stub-detection coverage survived the merge.

Engine implementation, architecture docs, release gates, and overlapping assets otherwise use `main` as the source of truth.

## Gates and real exit codes

- `pnpm --filter @offisim/desktop build` — exit `0`; exact `.app` bundled and ad-hoc signed. Notarization was skipped because Apple notarization credentials were not present.
- `cargo test` from `apps/desktop/src-tauri` — exit `0`; 436 unit tests passed, followed by successful auxiliary targets.
- `node scripts/release-gates.mjs --lane=node` — exit `0`; validate, UI hygiene, security harness, and pnpm 11 production audit all green. The audit reported only 1 low and 5 moderate advisories, below the configured high-severity failure threshold.
- Node lane log contained no Cargo/Rust release-gate step.
- `git diff --check` — exit `0`.
- GitNexus `detect_changes(scope=compare, base_ref=main)` — LOW; 21 changed symbols, 0 affected execution processes.

Targeted retained-asset checks also passed: `harness:run-cost-scope`, `check:ui-hygiene`, and `harness:loop-office-invocation` (20/20).
