# Runtime Smoke Gate — Handoff (2026-04-11)

This file exists so the next session can pick up without re-reading the whole
smoke gate plan or re-running the smoke test. Read this first, then decide
whether to pull the full verdict from `2026-04-11-runtime-smoke-gate.md`.

## What was done

Ran Chunks 1, 2 (partial), 3, 5 of `Docs/plans/2026-04-11-runtime-smoke-gate.md`
against live MiniMax. Chunk 4 deferred (install bootstrap is its own sub-plan).

## What passed

1. **Boss routing** — single-employee fast path correctly routes "Alex, write
   hello world" to Alex Chen (not Sophie PM). Response in 3s. 28 events.
2. **SOP→Plan→DAG dispatch** — Feature Development SOP ran step 1 (Sophie/PM)
   → step 2 (Zara/UX) via real DAG path, not single-employee shortcut.
   8-phase ceremony visible, "Manager present".
3. **DAG persist** — dragged a node, reloaded page, node stayed at new
   position. `SopSyncService` parse-then-stringify compare works live.
   **Core risk hypothesis from commit `73ce6d1` is disproven.**
4. **B2 bug fix** (RightSidebar Chat tablist) — stays visible during live
   stream, no clipping.
5. **3D↔2D scene swap** — both directions clean, no lock.

## What needs action (ordered by severity)

### P1 — R1: Activity Log duplicate React keys

**Symptom**: every time Activity Log renders after a task with an LLM call,
React dev console fires `Encountered two children with the same key`. Keys
follow pattern `<timestamp>-lc-<uuid>` where `-lc-` prefix marks LLM-call
events. Reproduced twice (6 errors on first run, 1 fresh error on second run).
Scales with LLM call count.

**Not a crash**, but:
- React dev warning means prod can silently duplicate/omit children
- Activity Log is the audit trail for AI ops — duplication = false audit
- Chunk 1 audit showed 28 events for a single task; 6 of those were duplicated
  react children, so ~20% of events render twice or misrender

**Suspected cause**: the Activity Log store subscribes to multiple event
prefixes (per CLAUDE.md: "`primeEventLogStore` creates 20 subscriptions,
`EVENT_PREFIXES` + `TYPE_PREFIX_MAP`"). The same LLM-call event is landing
twice — either emitted under two prefixes that both feed the store, or
re-emitted on stream start + stream finish without dedup.

**Where to start**:
1. `packages/ui-office/src/lib/event-log-store.ts` (or wherever
   `primeEventLogStore` / `disposeEventLogStore` live — grep it)
2. Check `EVENT_PREFIXES` and `TYPE_PREFIX_MAP` definitions — does `llm.*` or
   `llm_call.*` get captured by both a generic and a specific prefix?
3. Check the React render key — probably in `ActivityLogWorkspace` or
   similar. If the key is `event.timestamp + '-' + event.actor` and the store
   contains the same event twice, the reducer is where to dedup (not the
   render key).

**Don't do**: add a `new Set()` dedup in the render layer. That papers over
the double-ingestion. Find where the event hits the store twice.

**Test**: after fix, re-run smoke Chunk 1 (send "Alex, write hello world"
via chat → open Activity Log → check console). Expect 0 duplicate-key errors.

### P2 — R2: Spurious "SOP deleted" toast

**Symptom**: navigate Office → SOPs while a SOP dispatch is running in
background → toast "The selected SOP was deleted" fires twice. SOPs are not
actually deleted. State watcher comparing against a stale snapshot.

**Where**: `SopViewSurface.tsx` (or whichever component owns SOP selection
state). Likely a `useEffect` that sees `selectedSopId` not in `sops[]` during
a reconciliation race and fires `toast.error('SOP deleted')` without
checking whether the SOP is really gone.

**Fix shape**: either (a) guard the delete-toast on `sops.length > 0 &&
!sops.find(s => s.id === selectedSopId)` so an empty list doesn't trigger,
or (b) check against the persistence layer instead of in-memory state, or
(c) drop the watcher entirely if the SOP list is sourced from the same
selector (can't drift).

### P2 — R3: Step 2 MiniMax stall (investigate, don't blindly fix)

**Symptom**: Feature Development SOP step 2 (Zara/UX) ran for >100s with no
token growth, latency climbed without progress. Step 1 completed in ~15s
normally.

**Could be**:
- MiniMax thinking-model generating a huge chain-of-thought (no streamed
  output until thinking is done). User's `feedback_minimax_thinking_tokens`
  memory says MiniMax tokens behave this way.
- Real stream hang

**Don't fix yet**. Reproduce with a non-thinking provider (OpenRouter,
Anthropic direct) to isolate. If only MiniMax does it, this is an expected
thinking-model latency quirk, not a regression — document and close.

### P3 — R4: Footer "0 of 0 employees" copy

**Symptom**: After a Boss-direct-answer (Boss answered without dispatching),
footer shows "0 of 0 employees" instead of "0 of 8 employees". Counter is
"active / participants-in-last-run" not "active / total". Cosmetic.

**Fix**: change footer to always show total company employee count for the
denominator. Inline fix. Only touch if a P1 fix happens to land in the
footer component.

## Environment state at handoff

- dev server: `localhost:5176` running (Vite + React dev mode)
- MiniMax key: saved in Settings, persists across reloads
- Runtime: currently idle (post-Chunk 5 completion)
- Background SOP: there was a Feature Development SOP dispatched during
  Chunk 2 but page reload in Chunk 3 killed it. Safe to ignore.
- Screenshots: 11 PNGs under `.playwright-mcp/gate-chunk*.png` (gitignored)

## File pointers

- Full plan + triage: `Docs/plans/2026-04-11-runtime-smoke-gate.md`
- This handoff: `Docs/plans/2026-04-11-runtime-smoke-handoff.md`
- R1 starting point: grep `primeEventLogStore`, `disposeEventLogStore`,
  `EVENT_PREFIXES`, `TYPE_PREFIX_MAP` under `packages/ui-office/src/`
- R2 starting point: `packages/ui-office/src/components/sop/SopViewSurface.tsx`
  — look for "deleted" string
- CLAUDE.md invariants (still current): `primeEventLogStore` 20
  subscriptions, `EVENT_PREFIXES` + `TYPE_PREFIX_MAP` must stay in sync

## Suggested next session start

```
Read Docs/plans/2026-04-11-runtime-smoke-handoff.md. Fix R1 (Activity Log
duplicate keys) first — it's P1. Find where the LLM-call event is ingested
twice into the event log store. Verify with smoke Chunk 1 re-run.
```

## Out of scope for the fix session

- Chunk 4 install flow (its own bootstrap plan needed)
- R3 MiniMax stall diagnosis (needs non-thinking provider, not a code fix)
- Scene V2, ACP, bundle size (standing deferrals from sprint closure)
- Re-running Chunk 2 end-to-end — expensive (~3 min per step × 5 steps on
  thinking model); only rerun if R1 fix depends on it
