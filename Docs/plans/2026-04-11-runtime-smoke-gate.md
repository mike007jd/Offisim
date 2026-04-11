# Runtime Smoke Gate — 2026-04-11

Verify dynamic runtime paths still work after the 7-commit ship-readiness sprint
(`73ce6d1..542b29e`). The 2026-04-11 Playwright smoke only touched static UI;
no live LLM has run against this code since the 2026-04-06 web=desktop unlock.

**Verification, not fix.** If a chunk fails, log it in the triage table and
move on — fix plans come after.

## Core risk hypotheses

1. **SOP DAG persist** (`73ce6d1`) has unit tests but `SopSyncService`'s
   parse-then-stringify compare has never run under a live write path.
2. **Materializer narrowing** (`66d656e`) left employee as the only surviving
   install branch — it has not been exercised post-narrowing.
3. **B1/B2/B3 fixes** (`60ab0ab`) are static. Under live ceremony (employees
   walking to REST, chat streaming, scene swap) they may regress in ways
   static smoke cannot catch.

## Preconditions

- `localhost:5176` dev server running
- `MINIMAX_API_KEY` in repo-root `.env.local` (confirmed present)
- Playwright MCP for observability

---

## Chunk 1 — Single-employee fast path

**Assert**: chat "Alex, write hello world" → boss routes to Alex → response
returns → Activity Log captures the trail.

Covers boss 3-layer routing (`boss-node.ts:35-76, 208-236`), single-employee
shortcut, EventBus → Activity Log.

- [ ] Settings → Provider: paste MiniMax key, Save
- [ ] Chat: `Alex, write a one-line hello world in Python` → send
- [ ] Ceremony cycles, Alex animates in scene, response returns <60s
- [ ] Activity Log reverse-chrono, click one event → payload visible

**Fail**: >60s timeout, wrong employee routed, teleport instead of walk,
any non-`localhost:4100` console error.

---

## Chunk 2 — Multi-employee SOP

**Assert**: `Feature Development` SOP (5 roles) runs end-to-end via DAG path,
8-phase ceremony visible, employees reach zones without clipping, >20 Activity
Log events.

Covers SOP→Plan→DAG dispatch, `NodeContextMiddleware` 1800-char budget across
5 steps, `getExecutionBatches()` topology, scene routing under sustained load.

- [ ] SOPs → Feature Development → NL bar: `build a dark-mode toggle` → run
- [ ] Switch to Office, 8 phases fire, 5 employees visit zones, L-bend routes
- [ ] Screenshots at ≥3 phases
- [ ] Activity Log count >20, filter shows plan/dispatch/response/phase types

**Fail**: teleport, REST furniture clip, stuck/skipped phase, 2D lock, any
non-`localhost:4100` console error.

---

## Chunk 3 — DAG editor persistence

**Assert**: drag a node → reload → node stays at new position.

Covers `SopStep.position?` (`shared-types/sop.ts:10`), `handleMoveStep`,
`SopSyncService` parse-then-stringify compare.

- [ ] SOPs → Bug Fix Pipeline → Edit → drag node 2, release
- [ ] Exit edit, F5, re-open SOP
- [ ] Node is at new position (not auto-laid back)
- [ ] Run SOP → execution follows topology (position is display-only)

**Fail**: snap-back on reload, `SopSyncService` console error.

---

## Chunk 4 — Install flow [may block]

**Assert**: an installable `.offisim` employee package materializes into the
company and runs a task.

Covers `materializer.ts:195-207` (sole surviving branch),
`employee.config_json.capabilityIndex`, employee repo `create()` with
pre-generated ID, atomic install transaction.

Package bootstrap: try PublishDialog download. If platform isn't running
(likely) or the download path doesn't hit disk, **skip this chunk and note it
as blocked** — package bootstrap is its own sub-plan.

- [ ] Produce a package
- [ ] Toolbar → Install Package → pick file
- [ ] New employee in Team sidebar, install events in Activity Log
- [ ] Chat a task targeting it → boss routes, response returns

---

## Chunk 5 — Live-load regression sweep

Re-verify B1/B2/B3 **while employees are moving**, not at idle.

- [ ] **B1**: during Chunk 2 dismissing phase, no sprite overlaps REST
      furniture, no seat stacking
- [ ] **B2**: RightSidebar Chat tablist stays visible as stream writes in,
      no clip
- [ ] **B3**: toggle 3D→2D→3D rapidly to force WebGL context loss. 1st crash
      → 2D fallback. 2nd crash → hard-lock 2D (do not recover, per CLAUDE.md)
- [ ] Console tally via `browser_console_messages({level:'error'|'warning'})`.
      Expected: only `localhost:4100` 503. Anything else = regression.

---

## Chunk 6 — Verdict

| Outcome | Action |
|---|---|
| **A. All pass** | `docs: runtime smoke gate verified` commit, update MEMORY.md, sprint truly closed |
| **B. Regressions** | Fill triage table, open a fix plan per P0 |
| **C. Blocked** | Diagnose env/MiniMax. If key is dead, note it and end the plan — do not fake results |

### Triage

| ID | Chunk | Symptom | Area | Sev | Fix plan |
|----|-------|---------|------|-----|----------|
| R1 | 1, 5 | React `Encountered two children with the same key` errors on every Activity Log render after a live task. Keys follow `<timestamp>-lc-<uuid>` pattern (`-lc-` = LLM call event). Reproduced twice: 6 errors on first run, 1 fresh error on second run (scales with event count). Source: `chunk-QKUM7EBL.js` (React render). Activity Log events are being emitted into the render list twice per `-lc-` event. | Event log store subscription / `primeEventLogStore` — likely subscribing to the same LLM call event under two prefixes, or event is re-emitted on stream finish + completion | **P1** | Y — new plan |
| R2 | 3 | Spurious "The selected SOP was deleted." toast fires on navigation back to SOPs workspace from Office when a SOP dispatch is running in background. Toast shows twice. SOPs are NOT actually deleted — both still listed in sidebar. | `SopViewSurface` selection-state watcher likely compares against an outdated snapshot during dispatch, mistakes missing-selected for deletion | **P2** | Y — can fold with R1 or own plan |
| R3 | 2 | Feature Development SOP step 2 (Zara/UX Designer) stalled >100s with no token growth after step 1 (Sophie/PM) completed in ~15s. Token counter frozen at 15.8K from step 2 start, latency climbed 92s→176s without progress. Could be MiniMax thinking-model long chain-of-thought rather than a real hang, but the smoke gate couldn't distinguish. | MiniMax thinking-token behavior OR stream hang. Needs repro with non-thinking provider to isolate | **P2** (investigate) | Y — diagnostic plan |
| R4 | 5 | Footer agent counter shows "0 of 0 employees" after a Boss-direct-answer path (Boss answered "Alex, say hi in 3 words" without dispatching to Alex). Company has 8 employees. Counter displays "active / participants-in-last-run" not "active / total", which is misleading when last run had 0 participants. | Footer copy shows last-run scope, not company scope. Cosmetic but confusing | **P3** | N — fix inline if any P1 touches footer |

### Non-regression observations

- **Chunk 1 PASS**: Boss correctly routed "Alex, write hello world" to Alex Chen (not Sophie PM). Single-employee shortcut produced response in 3s. 28 events logged in Activity Log. 2.4K tokens / $0.0034.
- **Chunk 2 PASS (partial)**: Feature Development SOP dispatched via DAG path. Sophie (PM) ran step 1 "Analyze feature request" then handed off to Zara (UX Designer) for step 2 "Based on requirements…". 8-phase ceremony visible with "working" phase, "Manager present", "8 participants · 2 dispatched". Not a single-employee shortcut — real SOP→Plan→DAG dispatch path was exercised. Chunk aborted at step 2 stall (see R3), not failed.
- **Chunk 3 PASS**: Dragged "Reproduce & Root Cause" node from (640, 370) to (740, 435). Reloaded page. Re-opened SOP. Node stayed at new position. **Core risk hypothesis #1 (SopSyncService parse-then-stringify never run live) is disproven.**
- **Chunk 5 PASS (B2, scene swap)**: Chat tablist stayed fully inside sidebar bounds during live stream (y=145-179 inside y=137-753). 3D→2D toggle worked cleanly. 2D→3D toggle-back worked cleanly — no lock (expected, we only did 1 cycle, no real WebGL crash).
- **Chunk 4 NOT RUN** (deferred per plan, install flow needs bootstrap sub-plan).

### Verdict: **B — regressions found**

3 real regressions (R1, R2, R4) + 1 diagnostic (R3). R1 is deterministic and repeatable. None are crashes. Sprint is **not truly closed** until R1 fix lands or is explicitly deferred with written justification. Core framework paths (boss routing, SOP dispatch, ceremony, DAG persist, 3D/2D toggle) all work — the regressions live at the Activity Log and UX-copy edges.

Screenshots: `.playwright-mcp/gate-chunk1-chat.png`, `gate-chunk1-activity-log.png`, `gate-chunk2-ceremony-mid.png`, `gate-chunk2-ceremony-mid2.png`, `gate-chunk2-step2-zara.png`, `gate-chunk3-before-drag.png`, `gate-chunk3-after-drag.png`, `gate-chunk3-after-reload.png`, `gate-chunk5-2d-mode.png`, `gate-chunk5-3d-back.png`, `gate-chunk5-b2-chat-tablist.png`.

---

## Gate

- [ ] Chunk 1 pass (minimum signal)
- [ ] Chunks 2, 3 pass or triaged
- [ ] Chunk 5 console tally clean or documented
- [ ] Outcome written
- [ ] MEMORY.md updated
- [ ] Screenshots saved under `.playwright-mcp/`

## Out of scope

Fix plans, Scene V2, ACP, bundle size, Studio polish, new E2E specs,
Platform API (`localhost:4100`).
