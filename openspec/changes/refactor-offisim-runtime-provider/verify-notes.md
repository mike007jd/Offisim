# Runtime Provider Live Verify Notes

Date: 2026-04-18
Scope: `apps/web` live verification for tasks 7.1-7.6
Env:
- Dev server: `cd apps/web && pnpm dev`
- URL: `http://localhost:5176/`
- Browser provider config came from repo-root `.env.local` / Settings save path
- Primary company used: `Runtime QA A`
- Secondary company used for company-switch verification: `Runtime QA B`

## 7.1 Cold Start

- `pnpm dev` cold booted cleanly. Vite reported `ready in 199 ms` on first start.
- Full page reload with an active company restored the office without errors and landed in `Ready`.
- The app does not expose a dedicated visible `initializing` label on the office shell, so I verified the underlying init state through React fiber sampling during the same init path on Settings-triggered reinit:
  - pre-save: `version=1`, `isInitializing=false`
  - +48 ms after save: `version=2`, `isInitializing=true`
  - +135 ms after save: `version=3`, `isInitializing=false`
- I am treating that as evidence that the provider state machine still transitions through `initializing -> ready`, but note that I did not capture a separate cold-load-only UI label for `initializing`.

## 7.2 Task / Ceremony / Notification / Interaction

- Sent a live task in `Human` mode:
  - prompt: create a markdown launch brief deliverable for `Runtime QA A`
- Observed shared-event flow on the browser event bus:
  - `interaction.mode.changed` from `boss_proxy -> human_in_loop`
  - `graph.node.entered` for `boss`
  - `interaction.requested` with kind `agent_question`
  - `interaction.resolved`
  - subsequent `graph.node.entered/exited` for `boss`, `employee_direct_setup`, `employee`, `boss_summary`
  - `deliverable.created` for `runtime-qa-a-launch-brief.md`
- UI evidence:
  - footer showed `Awaiting clarification` while the interaction was pending
  - after response, footer moved to active execution states (`ANALYZING`, then `EXECUTING`)
  - employee status / scene activity changed while the task ran
  - deliverable rendered in chat on completion
- Result:
  - `interaction sync` works in a real task
  - scene/ceremony-driving graph events still fire
  - deliverable generation still works

### Notification Detail

- Deliverable toast path was observed from the live task.
- `NotificationBridge` itself was validated separately with a direct `plan.completed -> notification.created` bridge check.
- Important regression found:
  - after same-company `reinitRuntime()`, emitting `plan.completed` only produced `plan.completed`
  - `notification.created` did **not** fire
  - after a full page reload, the same manual `plan.completed` emission again produced `notification.created`
- This strongly suggests the bridge is deactivated during reinit and not re-activated afterward.

## 7.3 Settings Save / Reinit / Version

- Changed the Settings model from `MiniMax-M2.7-highspeed` to `MiniMax-M2.7`, saved, then later changed it back.
- Fiber sampling around save showed:
  - before save: `version=1`, `isInitializing=false`
  - +48 ms: `version=2`, `isInitializing=true`
  - +135 ms: `version=3`, `isInitializing=false`
- Footer model label updated to the saved model immediately after reinit completed.
- `interactionMode` remained `human_in_loop` across the reinit sequence.

## 7.4 Company Switch / Dispose / Rebuild / Leak Check

- Created a second company (`Runtime QA B`) and switched `Runtime QA B -> Runtime QA A`.
- Saved the old runtime bus before switching, then compared after switch.
- Observed:
  - old bus subscription count before switch: `204`
  - old bus subscription count after switch: `0`
  - old bus !== new bus
  - new bus subscription count after switch: `204`
- Interpretation:
  - old provider/runtime teardown did run
  - new provider/runtime was rebuilt
  - I did not see evidence of listener leakage across company remount

## 7.5 Unfinished Thread Detection

- I first tried to reproduce this naturally by starting a live task and reloading while it was routing/executing.
- After reload, `threads.findByCompany(...)` returned `[]`, and no unfinished banner appeared.
- So a normal browser reload did **not** leave a persisted `running` thread row in my run.
- To verify the detection hook/UI path itself, I then seeded a realistic `running` thread row plus linked project row in the live repo and reloaded.
- After reload, the banner rendered as expected:
  - `1 unfinished project`
  - `Resume Manual unfinished QA check`
- Conclusion:
  - `useUnfinishedThreadDetection()` and `ResumeBar` rendering work when a `running` thread exists at startup
  - I did **not** successfully prove that a normal in-browser interruption currently leaves such a row behind

## 7.6 Pending Interaction Semantics Check

- This was the focused check for the `hydratePending + setInteractionModeState(getMode())` move into `useInteractionSync(... useEffect([runtime]))`.
- I manually injected a synthetic pending `plan_review` interaction, confirmed it was present in provider state:
  - before save: `pendingKind=plan_review`, `pendingId=ix-manual-persist`
  - footer showed `Awaiting plan review`
- Then I triggered Settings save / reinit back to `MiniMax-M2.7-highspeed` and sampled every 20 ms.
- Observed:
  - +48 ms: `version=2`, `isInitializing=true`, pending still `plan_review`
  - +135 ms onward: `version=3`, `isInitializing=false`, pending still `plan_review`
  - footer still showed `Awaiting plan review` after reinit settled
- Conclusion:
  - I did **not** observe a semantic regression from moving the hydrate step into `useEffect([runtime])`
  - the pending interaction survived reinit and remained visible, which matches the intended byte-identical behavior

## Summary

- Passed:
  - task execution / interaction sync
  - Settings-triggered reinit version bump and init transition
  - company switch teardown/rebuild without listener leak
  - pending interaction persistence across reinit
  - unfinished-thread detection UI path, when a `running` thread row exists
- Regressions / gaps:
  - same-company `reinitRuntime()` appears to kill `NotificationBridge` without re-activating it
  - natural browser interruption did not leave a persisted `running` thread in my run, so 7.5 is only partially validated end-to-end

## Retest Addendum

Date: 2026-04-18
Reason: re-test after `useRuntimeInit.ts` changed `reinit()` to omit both `eventBus` and `notificationBridge` from `disposeRuntime(...)`

- Re-tested on a fresh browser session with a newly created company (`Retest Runtime Company`).
- Triggered same-company reinit through Settings save and sampled provider state through React fiber:
  - before: `version=1`, `isInitializing=false`
  - first post-save sample: `version=2`, `isInitializing=true`
  - settled sample: `version=3`, `isInitializing=false`
  - company/thread identity stayed stable across the reinit
- After reinit settled, manually emitted `plan.completed` on `window.__OFFISIM_DEBUG__.eventBus`.
- Observed event sequence:
  - `notification.created`
  - `plan.completed`
- Result:
  - the notification bridge now survives same-company `reinitRuntime()`
  - the previously observed reinit regression is fixed

Updated interpretation:
- 7.2 notification-bridge verification is now green after retest.
- 7.5 remains "verified hook/UI path, with orthogonal persistence gap" rather than a regression in this refactor.

## Follow-up Fix (2026-04-18)

### Fixed: reinit no longer deactivates shared NotificationBridge

- **Root cause**: `reinit()` passed `notificationBridge` to `disposeRuntime`, which called `deactivate()` on the shared bridge. Because `useNotificationBridge`'s `useEffect` is keyed `[eventBus, companyId, bridgeRef]`, a same-company reinit did not change any dep, so the effect didn't re-fire → bridge stayed deactivated permanently.
- **Fix**: `apps/web/src/runtime/hooks/useRuntimeInit.ts` `reinit()` now omits `notificationBridge` (alongside the already-omitted `eventBus`) from `disposeRuntime`. Both are keyed to the Provider's lifetime, not the runtime's, and must survive reinit. The final unmount dispose still passes the bridge for cleanup (and at that point `useNotificationBridge`'s own LIFO cleanup has already deactivated it and nulled the ref, so it's a safe no-op).
- **Note**: this was a pre-existing bug in the original 731-line Provider (`reinitRuntime` passed `notificationBridge` there too) that only surfaced now because live reinit was actually tested end-to-end.

### Retest needed
- **7.2 re-check**: after same-company `reinitRuntime()`, emit `plan.completed` and confirm `notification.created` still fires (expected: fires now).
