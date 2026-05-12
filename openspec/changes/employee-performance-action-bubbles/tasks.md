## 1. Cue Contract

- [x] 1.1 Add the employee performance cue model, priority, TTL, safe text handling, and reducer helpers.
  - PASS: `packages/ui-office/src/runtime/employee-performance-cues.ts` owns cue types, priorities, TTLs, sanitization/redaction, reducer-style store cleanup, and primary cue selection.
- [x] 1.2 Extend scene intents and dispatcher mappings for task dispatch, employee state, tool telemetry, interactions, handoff, reporting, and bounded LLM stream preview.
  - PASS: `scene-intents.ts` adds `scene.employee.performance.*`; `scene-intent-dispatcher.ts` maps dispatch/tool/interaction/handoff/state/reporting/abort events.
- [x] 1.3 Add presentation state hook cleanup for TTL expiry, company switch, idle reset, interaction resolution, and handoff completion.
  - PASS: `useEmployeePerformanceCues(activeCompanyId)` resets by company, sweeps TTLs, clears idle/abort/interaction/handoff sources, and is mounted above 2D/3D in `SceneCanvas`.

## 2. Scene Rendering

- [x] 2.1 Wire 3D employee markers to shared cue state with action bubbles, compact far badges, and existing route/flow-line behavior.
  - PASS: `Office3DView` passes shared cue state to `Office3DEmployeeLayer`; `EmployeeMarker` renders cue bubbles/compact badges while existing flow-line logic remains in `useOffice3DViewState`.
- [x] 2.2 Wire 2D snapshot/render data to shared cue state and draw per-employee bubbles or category badges in the employee layer.
  - PASS: `use-scene-snapshot.ts` adds per-employee cue data; `draw-employees.ts` renders anchored cue bubbles and degraded category dots.
- [x] 2.3 Preserve cue meaning across 3D crash/performance fallback, 3D retry, view switch, drag, and reduced-motion paths.
  - PASS: cue state lives in `SceneCanvas`, above both lazy 3D and 2D views, so toggling 3D/2D reuses the same active cue map.

## 3. Verification

- [x] 3.1 Validate OpenSpec with `openspec validate employee-performance-action-bubbles --strict`.
  - PASS: command completed successfully on 2026-05-12.
- [x] 3.2 Run build gates: `pnpm --filter @offisim/ui-office build` and `pnpm --filter @offisim/desktop build`.
  - PASS: both commands completed successfully; desktop built `/apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`.
- [ ] 3.3 Run release `.app` verification with Computer Use and record evidence for multi-employee, tool action, waiting, handoff, blocked, 2D fallback, and cleanup behavior.
  - PARTIAL: release `.app` launched via exact current worktree path and Computer Use attached to the real window.
  - PASS evidence: a live task produced failed/blocked employee cues in 3D; switching to 2D preserved the same failed employee cue as an anchored 2D bubble.
  - PASS evidence: after the legacy `codex-engine:sdk-native-full-power` default was sanitized, a release `.app` task ran through MiniMax-M2.7 on the Offisim gateway harness and completed a deliverable.
  - PASS evidence: release `.app` full-chain verification created manager planning, Sophie -> Alex handoff, Alex workspace inspection, Alex -> Sophie handoff, 3D handoff/waiting bubbles, 3D reporting/blocked feedback, and MiniMax-M2.7 harness status.
  - PASS evidence: `mcp_audit_log` recorded real Offisim harness tool calls for `bash` (`pwd && ls -la`) and `read_file` (`package.json`) by Alex; later Sophie tool rounds also appeared and failed visibly instead of being hidden.
  - PASS evidence: release `.app` 2D -> 3D -> selected-3D retry now keeps URL, toggle state, accessibility tree, and rendered scene aligned; inactive 3D/2D layers are no longer left mounted as ghost views.
  - PASS evidence: company switch cleared old handoff/blocked scene cues from the stage instead of leaving stale route or bubble overlays.
  - BLOCKED evidence: the full-chain run failed before final report/evidence-file write with `MAX_TOOL_ROUNDS_EXHAUSTED`, so `tmp/offisim-performance-cue-release-check.md` was not produced by the in-app team.
  - BLOCKED evidence: the UI displayed "Waiting for your input to continue.", but no `active_thread_interactions` row was created; true approval/question interaction cleanup still needs a dedicated runtime event pass before this task can be checked.
