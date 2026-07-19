# PR-A3 evidence — Rust dedup (process_group ×4 + time_util + env_scrub)

- Branch: `refactor/A3-rust-dedup`
- Base: `origin/main` at `f105efc28bcfc171adb21dd62c40fcd4a532c434`
- Scope: roadmap PR-A3 exactly (three numbered items), mechanical dedup only.

## 1. process_group landing (anchor module, 4 call sites)

`apps/desktop/src-tauri/src/process_group.rs` is the owner-authored anchor
already committed on `main` (§0: use, do not rewrite). This PR registers it
(`mod process_group;` in `lib.rs`) and replaces the four local copies:

- `git.rs`: local `configure_git_process_group` / `GitProcessGroupGuard` /
  `terminate_git_process_group` removed; grace is passed explicitly as
  `GIT_TERMINATION_GRACE = 500ms` (the original value).
- `builtin_tools.rs`: local `configure_evaluation_process_group`,
  `signal_evaluation_process_group_with`, and `ShellProcessGroupGuard`
  removed. The shell lane's distinctive termination escalation (SIGTERM →
  trap-window polling of `evaluation_process_group_exists` over
  `SHELL_TERMINATION_GRACE_MS` → SIGKILL → reap) is deliberately retained at
  the call site per the plan ("行为参数以原实现为准"); it now sends signals
  through the shared `signal_process_group`. stdout capping untouched.
- `pi_agent_host/run.rs`: local configure/signal/guard/terminate removed;
  `terminate_process_group` receives the original
  `SIDECAR_GRACEFUL_SHUTDOWN_TIMEOUT = 2s`. `finish_sidecar_process_group`
  (success-path descendant sweep) stays local and uses the shared signal.
- `codex_agent_host/protocol.rs`: local `configure_process_group` /
  `signal_process_group` duplicates removed in favor of the shared module.

## 2. time_util

New `apps/desktop/src-tauri/src/time_util.rs`:

- `civil_from_days` — canonical copy taken from `preview.rs` (Howard Hinnant
  algorithm), now the single implementation; `preview.rs`, `git.rs`
  (millisecond-precision `unix_ms_to_rfc3339` keeps its local formatter and
  calls the shared civil-date math), and `codex_agent_host/manager.rs` use it.
- `now_unix_ms` / `try_now_unix_ms` — canonical `i64` clock; callers adapt
  width and error type locally: `browser_session.rs` (`u64`),
  `startup_safety.rs` and `app_update.rs` (`u128`),
  `task_workspace_binding.rs` (`HostError` mapping, original error strings
  preserved).
- `rfc3339_from_unix` + `stable_hex` — canonical copies from
  `codex_agent_host/manager.rs`; the local duplicates were deleted.

## 3. env_scrub (security-boundary move, union rule)

New `apps/desktop/src-tauri/src/env_scrub.rs` merges `scrubbed_shell_env`
(builtin_tools) and the allowlist half of `scrubbed_git_env` (git) into one
`scrubbed_child_env()`; per §0.4 the allowlist merge takes the UNION:
shared minimal base + `SSH_AUTH_SOCK` (previously git-only). Git's pinned
variables (`GIT_TERMINAL_PROMPT=0`, `GIT_LITERAL_PATHSPECS=1`) stay at the
git call site.

- Declared behavior delta (the only one in this PR, mandated by the §0.4
  union rule): the shell lane now retains `SSH_AUTH_SOCK`, which the git lane
  always retained. No secret-bearing variable was added; provider-secret
  exclusion is unchanged.
- Tests kept/added per §0.4 "保留双侧现有测试":
  `git.rs::scrubbed_git_env_excludes_provider_secrets` kept;
  `builtin_tools::shell_env_scrub_uses_minimal_allowlist` updated for the
  union set; new symmetric `shell_env_scrub_excludes_provider_secrets`
  (builtin_tools) and `scrubbed_child_env_excludes_provider_secrets`
  (env_scrub) added.

## Gates

- `node scripts/prepare-desktop-cargo-test.mjs && cargo test --locked`:
  458 passed, 0 failed (includes the process-group descendant-reaping and
  lifetime-marker contract tests over the shared module).
- `cargo fmt --check`: clean.
- `node scripts/release-gates.mjs --lane=node`: PASS, 4/4 gates green.
- `git diff --check`: PASS.
- GitNexus `detect_changes(scope: all)` against the main index: 12 files /
  30 symbols, risk HIGH (expected — `now_unix_ms` and the process-group
  helpers sit on many execution flows). Mitigation: full cargo test sweep
  above plus the release `.app` live smoke below exercising all four
  Stop/termination paths.

## Release `.app` live smoke (four Stop/termination paths)

See `live-smoke.md` in this directory for the exact app path, PIDs, and
per-path evidence (git / shell / pi / codex: start task → Stop → no zombie
process group).

## Recorded plan deviations

- None besides the §0.4-mandated union delta documented above. The shell
  termination escalation loop and git's millisecond RFC 3339 formatter were
  kept at their call sites (allowed: "调用点参数/行为以原实现为准";
  the plan's terminate anchor matches the git semantics, not the shell trap
  window).
