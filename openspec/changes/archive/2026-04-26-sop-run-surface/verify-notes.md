# sop-run-surface live verify notes

Date: 2026-04-26
Target: web dev server at `http://localhost:5176/`

## Environment

- Started `pnpm --filter @offisim/web dev -- --host 127.0.0.1 --port 5176`.
- Initial real-provider verification was blocked by MiniMax account/model access:
  `your current token plan not support model, MiniMax-M2.7-highspeed (2061)`.
- MiniMax configuration was switched to `MiniMax-M2.7` globally (env / catalog /
  provider-config defaults). The provider-backed SOP run then reached natural
  `plan.created`, `step_advance`, and `step_dispatcher` events with the footer
  showing `Model: MiniMax-M2.7`.
- The natural run stopped on a separate runtime error:
  `Graph execution failed in node "step_dispatcher": Recursion limit of 25 reached without hitting a stop condition.`
  This is a LangGraph dispatch-loop ceiling, not a SOP surface regression.
- To verify the SOP surface contract past provider/runtime gates, Playwright held
  the local `/api/llm-proxy` request so `isRunning` stayed true, then emitted
  DEV `window.__OFFISIM_DEBUG__.eventBus` plan/task/employee events. This drives
  the same runtime event inputs consumed by `PlanStepStoreProvider`,
  `useSopRuntimeState`, and `SopRunProgressStrip`.

## Evidence (transcripts captured during the live verify session)

- 7.1 initial missing-role surface
  - `7.1 initial no researcher chip count=1`; inspector `Role gap` row present.
- 7.2 role filled (employee.created)
  - `7.2 after employee.created warning count=0, Role gap count=2`.
- 7.3 role deleted (employee.deleted)
  - `7.3 after employee.deleted warning count=1, Role gap count=3`.
- 7.4 run strip mounts on selected SOP
  - Strip body: `Running step 1 of 5 · Requirements Analysis · 0/5 tasks`.
- 7.5 run strip updates as `plan.step.started` advances
  - Strip body: `Running step 2 of 5 · UI/UX Design · 1/5 tasks`.
- 7.6 failed step surface
  - `failed chip count=1`; inspector `Last error` section visible with the
    injected failure description.
- 7.7 just-finished and clear window
  - Terminal copy: `Run completed · 2 of 5 steps`. After ~3.6s the strip count
    dropped back to 0 (auto-clear window honored).
- 7.8 non-selected SOP scoping
  - With Feature Development selected and a Bug Fix plan injected, strip count
    on the visible surface stayed at 0.

## Result

Live verify passes for the SOP surface event contract. Switching the
default model from `MiniMax-M2.7-highspeed` to `MiniMax-M2.7` restores
provider-backed dispatch, and the SOP run now reaches natural plan/step
execution. Full natural completion is blocked by a separate runtime issue
(`step_dispatcher` LangGraph recursion limit 25), which is independent of
this capability and is recorded as a follow-up.
