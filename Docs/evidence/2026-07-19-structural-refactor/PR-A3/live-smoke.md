# PR-A3 release `.app` Stop / termination live smoke

## Execution report

- Checked at: `2026-07-19T17:33:55+12:00` (Pacific/Auckland)
- Worktree / command directory: `/Users/haoshengli/worktrees/offisim-refactor-a3`
- Branch: `refactor/A3-rust-dedup`
- Commit: `711903884a9b8a248f1b0ca46c2b05ab492bf936`
- Exact app: `/Users/haoshengli/worktrees/offisim-refactor-a3/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`
- App launch / window attach / click / screenshots / close: Codex Computer Use, attached to the exact app path. No bundle-id launch, localhost, dev server, dev webview, AppleScript, or `osascript` was used.
- Executor model / effort / permission mode: `gpt-5.6-sol` / `medium` / `--dangerously-bypass-approvals-and-sandbox` (also observed in the dispatch process command line); filesystem permission profile was unrestricted/disabled.
- Build: not run; the supplied signed release app was used as-is.
- Overall status: **failed**. Shell, Pi, Git, app-close, and no-`Z` checks passed, but Codex Stop left a live orphan `sleep 300` process group after both Stop and app close. The test-only residual was manually terminated only after the failure had been captured.

## Modified files

- `live-smoke.md`
- `01-shell-running.png`
- `02-shell-stopped.png`
- `03-pi-running.png`
- `04-pi-completed.png`
- `05-codex-running.png`
- `06-codex-after-stop.png`
- `07-git-status.png`

No source code, script, configuration, commit, branch, remote, or release artifact was changed.

## App identity

Command:

```text
ps -axo pid=,ppid=,pgid=,stat=,command= | rg '/Users/haoshengli/worktrees/offisim-refactor-a3/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app/Contents/MacOS/'
```

Observed immediately after Computer Use attached to the app:

```text
17853     1 17853 S /Users/haoshengli/worktrees/offisim-refactor-a3/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app/Contents/MacOS/offisim-desktop
```

Conclusion: **verified**. Exact main PID `17853`, PGID `17853`, and executable path were proven inside the required worktree app.

## Lane results

### 1. Shell — verified

UI task sent through the API/Pi conversation:

```text
Use Bash to run exactly: bash -c 'sleep 300 & sleep 300'. Do not answer until both sleeps finish.
```

Running-state command:

```text
ps -axo stat=,pid=,ppid=,pgid=,command= | rg '(^| )17853( |$)|sleep 300|pi-agent|pi-coding|codex|node'
```

Relevant observed process group:

```text
S 18473 17853 18473 .../Offisim.app/Contents/Resources/resources/node/bin/node .../pi-agent-host.mjs
S 18541 17853 18541 /bin/tcsh -c bash -c 'sleep 300 & sleep 300'
S 18543 18541 18541 bash -c sleep 300 & sleep 300
S 18544 18543 18541 sleep 300
S 18545 18543 18541 sleep 300
```

Computer Use clicked the visible stage `Stop`. Post-Stop command:

```text
ps -axo stat=,pid=,ppid=,pgid=,command= | awk '$4==18541 || $2==17853 || $3==17853 {print}'
```

Post-Stop output:

```text
S 17853 1 17853 .../Offisim.app/Contents/MacOS/offisim-desktop
```

All members of PGID `18541`, both `sleep` PIDs, and the Pi host disappeared. Evidence: `01-shell-running.png`, `02-shell-stopped.png`.

### 2. Pi / API — verified

Normal task:

```text
Reply exactly PI_A3_NORMAL_OK.
```

During the run:

```text
S 19241 17853 19241 .../Offisim.app/Contents/Resources/resources/node/bin/node .../pi-agent-host.mjs
```

The run completed naturally before the Stop click could land; UI showed `PI_A3_NORMAL_OK` and `Complete: 4 of 4 stages`. Post-completion command:

```text
ps -axo stat=,pid=,ppid=,pgid=,command= | awk '$2==17853 || $3==17853 {print}'
```

Post-completion output contained only PID `17853`; Pi sidecar PID/PGID `19241` was gone. Evidence: `03-pi-running.png`, `04-pi-completed.png`.

### 3. Codex CLI — not_verified (confirmed failure)

Alex Chen was visibly configured as `Codex CLI`; the conversation showed subscription accounting (`订阅内 · 无 API 成本`). Task:

```text
Use the shell to run exactly: bash -lc 'sleep 300'. Do not reply until it finishes.
```

Initial Codex process group:

```text
S 19799 17853 19799 node .../@openai/codex/bin/codex.js app-server --stdio
S 19800 19799 19799 .../vendor/aarch64-apple-darwin/bin/codex app-server --stdio
```

Once the built-in bash tool began, the long command was observed as:

```text
Ss 20320 1 20320 sleep 300
```

Computer Use clicked both visible Stop surfaces repeatedly (stage `Stop` and conversation `Stop run`). The Codex app-server group exited, but UI remained `WORKING`; the orphan sleep stayed alive with PPID `1`, PGID `20320`. A later snapshot showed the CLI host had respawned:

```text
S 20372 17853 20372 node .../@openai/codex/bin/codex.js app-server --stdio
S 20385 20372 20372 .../vendor/aarch64-apple-darwin/bin/codex app-server --stdio
Ss 20320 1 20320 sleep 300
```

After Computer Use closed the app, PID `17853` and the `20372` Codex group exited, but this remained:

```text
Ss 20320 1 20320 sleep 300
```

This fails the required no-residual-process-group guarantee. After recording the failure, cleanup was performed explicitly:

```text
kill -TERM -- -20320
sleep 1
ps -axo stat=,pid=,ppid=,pgid=,command= | awk '$2==20320 || $3==20320 || $4==20320 {print}'
```

Cleanup output was empty. Evidence: `05-codex-running.png`, `06-codex-after-stop.png`.

### 4. Git — verified (completion-only smoke shape)

Computer Use selected the app's `Git` workspace tab. This triggered the real workspace status/binding refresh for `/private/tmp/offisim-w6-live-project`; the panel displayed:

```text
main ↑ 0 ↓ 0
CHANGES · 0
No local changes
DIFF PREVIEW: clean tree
```

The git operation completed too quickly to expose a Stop window. This lane is therefore a completion-only git status/workspace-binding smoke, as allowed by the acceptance criteria. The immediate app-child snapshot contained only the already-running Codex host and no git child process:

```text
ps -axo stat=,pid=,ppid=,pgid=,command= | awk '$3==17853 {print}'
S 20372 17853 20372 node .../@openai/codex/bin/codex.js app-server --stdio
```

Evidence: `07-git-status.png`.

## Close and zombie checks

Before close, the targeted `Z`-state query returned no output:

```text
ps -axo stat=,pid=,ppid=,pgid=,command= | awk '$1 ~ /^Z/ && ($2==17853 || $3==17853 || $4==17853 || $2==20320 || $3==20320 || $4==20320 || $2==20372 || $3==20372 || $4==20372) {print}'
```

Computer Use clicked the exact Offisim window close button. The immediate post-close query showed only the non-zombie orphan sleep:

```text
Ss 20320 1 20320 sleep 300
```

After the explicitly documented manual cleanup, both the targeted process query and targeted `Z` query returned empty output. Thus:

- Main app PID `17853` exit: **verified**.
- `Z`-state Offisim descendants observed at any checkpoint: **none**.
- Automatic no-residual-process-group guarantee: **failed**, because Codex left live PGID `20320` until manual cleanup.

## Evidence files

1. `01-shell-running.png` — shell lane working with visible Stop.
2. `02-shell-stopped.png` — shell lane interrupted/stopped.
3. `03-pi-running.png` — Pi/API normal run working.
4. `04-pi-completed.png` — Pi/API normal run complete.
5. `05-codex-running.png` — Codex CLI built-in bash tool running with Stop visible.
6. `06-codex-after-stop.png` — UI still working after Stop attempts.
7. `07-git-status.png` — real Git panel status, branch, and clean tree.

## Residual risks

- Confirmed defect: a Codex built-in shell command can detach into its own process group (`20320`) and survive both Offisim Stop and app close.
- The Codex UI remained `WORKING` after the original CLI host exited and later spawned a new host group, so runtime state reconciliation is also suspect.
- Git subprocess lifetime was too short to exercise Stop; only the explicitly allowed completion-only status/binding shape was covered.
- Pi used natural completion, not a landed Stop click; its sidecar cleanup was nevertheless directly observed.

## Final conclusion

- App identity: `verified`
- Shell: `verified`
- Pi/API: `verified`
- Codex CLI: `not_verified` (confirmed failure)
- Git: `verified` (completion-only smoke shape)
- Main process close: `verified`
- No `Z` state: `verified`
- Overall conclusion status: **failed**

## Baseline contrast (2026-07-19, after the smoke above)

To classify the Codex failure, the identical experiment was repeated on a
release app whose `src-tauri` is byte-identical to `main@f105efc2` (the U4
worktree artifact; `git diff f105efc2 71a5a377 -- apps/desktop/src-tauri`
inside that worktree is empty). Result: **the baseline leaks the same way** —
after both stage `Stop` and conversation `Stop run`, the Codex app-server
group exits but `sleep 300` survives with `PPID 1` in its own process group,
and it outlives app close. Full report and 4 screenshots:
[`baseline-codex-stop/report.md`](baseline-codex-stop/report.md).

Classification: the Codex Stop orphan-process leak is a pre-existing `main`
defect (the Codex CLI's own child, `codex-code-mode-host` → `sleep`, detaches
into a group Offisim never owned), not an A3 regression. A3 is a mechanical
dedup and does not attempt to fix it; the defect is surfaced for a separate
bug lane. The three process-group lanes A3 actually touched (git, shell, pi
sidecar) all passed the smoke.
