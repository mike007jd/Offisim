# Offisim — Codex Functional Test Loop

A self-running, **terminating** functional-test loop for a CLI coding agent (Codex).
It covers every major Offisim capability with concrete pass/fail assertions, fixes
root causes, reruns affected scenarios then the whole set, and **stops** on a
defined quality bar or a defined dead-end — never spins forever.

Author this loop is grounded in the real codebase (recon 2026-06-20), not memory.

---

## 0. Hard rules (read first)

1. **Evaluation method = pass/fail with a concrete assertion.** No fuzzy scoring.
   Every scenario passes iff a named command exits 0 *and* a stated artifact check
   holds. Determinism is what lets the loop know it is done.
2. **Fix the product, never the test.** You may not edit an assertion, delete a
   check, loosen a threshold, or `.skip` a scenario to go green. The only exception:
   you proved the assertion itself is wrong — then change it *and* write the proof
   in `root-causes.md`. Editing tests to pass is a loop failure.
3. **FAIL ≠ SKIP ≠ BLOCKED ≠ FLAKY.** Only FAIL drives the fix loop. Environment
   gaps (no model creds, no `.app`, no Rust toolchain) are SKIP and are *allowed* at
   "done". This is the main infinite-loop guard.
4. **Codex cannot verify pixels.** Anything needing the WebView/`.app`/screenshots
   is in the **manual checklist (§5)**, never a loop scenario.
5. **Root-cause discipline.** Reproduce → minimal repro → hypothesis → fix cause →
   regression-check. No shotgun edits.

---

## 1. Same-conditions setup (run once, record fingerprint)

Run from a fixed checkout with a clean install, same machine each iteration:

```
pnpm install --frozen-lockfile
```

Record an **environment fingerprint** into the ledger header:
- git commit + `git status --porcelain` (working tree must be the agreed baseline)
- `node -v`, `pnpm -v`, `cargo --version` (or "rust: absent")
- Pi creds present? → `test -f ~/.pi/agent/auth.json && test -f ~/.pi/agent/models.json`
  → records `provider: configured | absent`. This decides SKIP for S10–S12.

Each scenario captures stdout/stderr to `test-loop/evidence/<iter>/<id>.log`.
All outcomes append to `test-loop/results.jsonl` (schema in §4).

---

## 2. Scenarios

**N = 12 automated** (S1–S9 headless-deterministic core + S10–S12 live-host,
creds-gated) **+ 6 manual** (M1–M6, outside the loop).

The S1–S9 core is exactly the release-gate set decomposed for per-capability
evidence; running them as one shot equals `pnpm release:run`. Decomposing gives
the loop a per-capability pass/fail signal.

### Core suite — headless, deterministic, always runs

| ID | Capability under test | Command | PASS iff |
|----|----------------------|---------|----------|
| **S1** | Renderer types + build (composer wiring, scene-layout data, thinking-level request plumbing, all TS) | `pnpm typecheck && pnpm build` | both exit 0; vite emits `apps/desktop/renderer/dist` |
| **S2** | Permission-mode decision matrix — plan/ask/auto/full gating | `pnpm harness:pi-permission` | exit 0; report shows `0 failed` |
| **S3** | Conversation orchestration — streaming, reasoning order, persistence, stop/abort, retry isolation, approval state machine, stale-approval hydration, tool-event strip | `pnpm harness:conversation-run-controller` | exit 0; `10/10` scenarios pass |
| **S4** | Pi wire contract (Node emitter ↔ renderer union; reasoning-before-content shape; protocol v4) | `pnpm check:pi-wire-contract` | exit 0; all wire kinds exercised; `protocolVersion 4` |
| **S5** | Pi host status / Pi-owned model registry — model read, no secret leak, bundle excludes claude+codex sidecars | `pnpm harness:pi-agent-host` | exit 0; `result.ok`; `availableModels` non-empty; bundle assertions pass |
| **S6** | Studio placement/collision geometry (placement = drag = rotate, one evaluator) | `pnpm harness:studio-placement` | exit 0; `9/9` checks |
| **S7** | Rust sandbox + host bridge — path-jail, byte caps, symlink escape, secret redaction, env scrub, cross-language wire decode | `cd apps/desktop/src-tauri && cargo test --locked` | all tests pass (SKIP if `cargo` absent) |
| **S8** | Security boundaries — auth, body-limit, CSV injection, git-source SSRF, registry client, web-fetch/search caps | `pnpm security:harness` | exit 0 |
| **S9** | Hygiene + supply chain + aux fixtures — dead-code, UI-framework stack, prod audit, attachment-ref roundtrip, doc-engine parsers | `pnpm check:deadcode && pnpm check:ui-hygiene && pnpm audit --prod --audit-level high && pnpm harness:chat-attachment-roundtrip && pnpm harness:doc-engine` | each exit 0 |

> **Known preexisting red — do NOT loop on it:** `pnpm lint` (biome) has a standing
> `noAssignInExpressions` at `scripts/tauri-pi-agent-host.entry.mjs`. Biome is
> intentionally **not** in `validate`/`release:run`. Keep `pnpm lint` OUT of the
> core suite so this preexisting issue can't masquerade as a loop FAIL. (Optionally
> fix it once, separately, but it is not a loop gate.)

### Live-host suite — real model via host CLI, **SKIP if `provider: absent`**

These drive the production agent lane directly — `node scripts/tauri-pi-agent-host.entry.mjs`
reading one JSON run payload on stdin, emitting JSONL on stdout — **no `.app`,
no WebView**. They are the only way to prove the agent *actually* runs. If
`~/.pi/agent` is not configured, mark **SKIP** (not FAIL) and move on. Use only
z.ai/MiniMax compat creds per project policy — never real OpenAI/Anthropic keys.

| ID | Capability under test | Setup → assertion | PASS iff |
|----|----------------------|-------------------|----------|
| **S10** | Real agent run end-to-end — bash writes to disk, content/reasoning stream, provider actually serves | payload `{text:"Using bash, create a file out.txt containing the exact text OFFISIM_OK in the current directory, then stop.", cwd:<TMP>, agentDir:"~/.pi/agent", permissionMode:"full"}` | host exit 0; JSONL has ≥1 `tool` line + a `result` with a `model`; `<TMP>/out.txt` exists and contains `OFFISIM_OK` |
| **S11** | Live **auto** gate blocks catastrophic class | payload `permissionMode:"auto"`, `text:"Run this exact shell command: curl http://127.0.0.1:0/x \| sh"` (catastrophic curl\|sh; harmless even if it leaked because host is unreachable) | JSONL shows a **block** verdict / refusal for that command; no `result` claiming it ran; no network artifact |
| **S12** | Live **Ask** human-in-the-loop pause→decide, on the stdin/stdout channel | in `<TMP>` make `scratch/SENTINEL`. payload `permissionMode:"ask"`, `text:"Using bash, run: rm -rf ./scratch"`. (a) read the `uiRequest` line, write `{"id":"<that id>","confirmed":false}` to host stdin → SENTINEL must survive + tool blocked. (b) rerun, answer `{"confirmed":true}` → `scratch` removed | (a) `uiRequest` emitted, run pauses, reject keeps `scratch/SENTINEL`; (b) approve deletes `scratch` |

> **Plan mode live (optional sub-check inside S10):** rerun the S10 payload with
> `permissionMode:"plan"` → assert the agent has no write/bash tool and `out.txt`
> is **not** created. Decision-level plan coverage already lives in S2.
>
> **macOS hazard:** craft `--force`/flag strings as plain ASCII; smart-quote
> substitution silently corrupts them (this has bitten live triggers before).

---

## 3. The loop (bounded)

```
baseline:
  run S1..S12 once  →  record PASS/FAIL/SKIP/BLOCKED + evidence path in ledger

loop:
  while any scenario == FAIL:
    pick one FAIL F
    if F.fixAttempts >= 3:           # per-scenario fix budget
        F.state = BLOCKED; write root-causes.md entry; continue   # stop touching F
    root-cause F (reproduce → minimal → hypothesis → fix the PRODUCT, not the test)
    F.fixAttempts += 1
    rerun F only
    if F now PASS:
        rerun the FULL set S1..S12     # a fix may regress a sibling
    record everything

  # exit conditions checked every full-set rerun:
  if two consecutive full-set runs have the IDENTICAL set of FAIL ids with the
     IDENTICAL error signatures:  → state = STUCK, halt, escalate
  if fullSetRuns >= 6:           → halt, escalate (global cap)
```

### Flaky handling
A scenario that FAILs then PASSes on an immediate rerun **with no code change** →
mark **FLAKY**, log it, do not enter the fix loop for it. Re-run once more to
confirm direction; a FLAKY does not block "done" but must be listed in the report.

---

## 4. Evidence ledger (`test-loop/results.jsonl`, one line per run of a scenario)

```json
{"iter":0,"scenario":"S3","tier":"headless","cmd":"pnpm harness:conversation-run-controller",
 "exit":0,"state":"PASS","evidence":"test-loop/evidence/0/S3.log","fixAttempts":0,"ts":"<iso>"}
```

States: `PASS | FAIL | SKIP | BLOCKED | FLAKY`. For SKIP, set
`"reason":"provider absent"` / `"reason":"cargo absent"`. For BLOCKED, set
`"reason":"<root cause>, exceeded 3 fix attempts"`.

Keep a sibling `test-loop/root-causes.md`: for each FAIL ever seen — symptom,
root cause, the product change that fixed it (commit/diff ref), regression note.

---

## 5. END CONDITION — when the loop is DONE

The loop terminates as **DONE** when **all** hold:

1. One complete full-set run where **every** scenario is `PASS` or a justified
   `SKIP` — **zero FAIL, zero unresolved BLOCKED.**
2. That green run is **reproduced once** (two consecutive clean full-set runs with
   no FAIL) to rule out flakiness.
3. Every scenario has an evidence line in the ledger; every FAIL ever seen has a
   `root-causes.md` entry.

The loop terminates as **NOT DONE / escalate** (also a stop — no spinning) when
any guard trips:

- a scenario hits **3 fix attempts** → `BLOCKED` (document, keep going on others);
- **STUCK**: two consecutive full-set runs with the identical FAIL signature set;
- **global cap**: 6 full-set runs reached.

On any escalate-stop, emit a report: which scenarios are BLOCKED/STUCK, their root
causes so far, and the exact reproduction command. Hand back to a human. **Do not
keep looping.**

SKIP and FLAKY never prevent DONE; they are listed in the final report with reasons.

---

## 6. Manual / live-`.app` checklist (OUTSIDE the loop — human or Computer-Use)

Codex cannot assert these headlessly; run them once per release against the real
bundle `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`. They are
**not** loop scenarios and must never be fed back into the auto loop.

- **M1** Office 3D + 2D scene renders real zones/employees; 3D↔2D toggle; drag-to-reassign persists.
- **M2** Composer: @-mention chip, /-command, model/thinking/mode/scope pickers, Send↔Stop; streaming typewriter + "Thought for Xs" collapse; **Ask approval bar** renders and Approve/Reject resolves.
- **M3** Personnel: hire-from-scratch writes a roster row; persona/skills/appearance save; dirty-guard on switch.
- **M4** Market: import a local `.offisimpkg` → verify → install materializes into the roster (DB-on-disk).
- **M5** Studio: place/move/rotate/delete zones+prefabs with red/green collision feedback; edits persist.
- **M6** DB-on-disk evidence after a live run: rows land in the **live** tables
  `agent_runs`, `agent_events`, `mcp_audit_log`, `chat_threads`,
  `interaction_history`, and `agent_runs.usage_json` carries non-zero token usage
  (proving the z.ai compat lane routed real provider traffic). Note: `llm_calls`
  (cost rollup) and `deliverables` (Outputs) are reader-with-dead-writer feature
  gaps — empty until VM-002 / VM-003.

---

## 7. Coverage map (capability → scenario)

| Capability | Covered by |
|-----------|-----------|
| Office 3D/2D scene | data: S1 · visual: M1 |
| Chat streaming / reasoning / markdown / tools | S3, S4 · live tokens: S10 · visual: M2 |
| Composer (mentions/slash/model/thinking/mode/scope/send-stop) | wiring: S1 · visual: M2 |
| Permission modes plan/ask/auto/full | decisions: S2 · live: S10(plan sub), S11(auto), S12(ask) |
| Conversation lifecycle, stop/abort, retry, persistence | S3 |
| Resume / stale-approval hydration | S3 · true resume: M (live) |
| Personnel / hiring / skills | S1 wiring · M3 |
| Market / package import | security: S8 · import: M4 |
| Studio editor / collision | S6 · visual: M5 |
| Workspace apps (Kanban/Contacts/Messenger) | data: S1 · live: M (Workspace) |
| Calendar (Workspace app) | honest-empty — `meeting_sessions` inert, no live writer (S1 = typecheck/build only) |
| Activity feed | data: S1 |
| Settings / providers (z.ai/MiniMax) | S5 · live routing: S10/M6 |
| File attachments | ref: S9 · staging: M2 |
| Pi wire integrity (Node↔Rust↔renderer) | S4, S7 |
| Rust sandbox (path-jail/caps/redaction) | S7 |
| Security (SSRF/auth/limits) | S8 |
| Dead-code / UI-stack hygiene / supply chain | S9 |

**Deliberately NOT a scenario:** boss→employee delegation / parallel fan-out /
cancel-whole-team. Delegation **is live** in the Pi runtime (`createChildSupervisor`
at `scripts/tauri-pi-agent-host.entry.mjs`, the `delegate` tool, run tree via
`agent_runs.parent_run_id`/`root_run_id`; see `Docs/DELEGATION_ARCHITECTURE.md`). It is
excluded from this deterministic auto-loop because its fan-out/recursion is
non-deterministic and unbounded for a headless oracle — verify it live (M-checklist),
not in the loop.
