## Context

The office scene already has ceremony choreography, employee state badges, dispatch/handoff flow lines, and a 2D canvas fallback. The missing layer is per-employee presentation: runtime events are visible in global bubbles or rails, but the scene does not consistently show which employee is acting, waiting, handing off, blocked, or reporting.

The change must stay on the default Offisim harness/gateway path. Presentation consumes existing runtime events and scene intents; it must not add a model lane, freeform character dialogue, or SDK-native employee runtime.

## Goals / Non-Goals

**Goals:**
- Make employee work legible in 3D and 2D from the same cue model.
- Use short, privacy-safe event templates plus bounded LLM stream previews for boss/manager/reporting only.
- Keep one active main bubble per employee with deterministic priority and TTL behavior.
- Preserve existing ceremony, movement, drag, fallback, and theme-token boundaries.
- Clean stale presentation state on company switch, scene unmount, abort-like terminal resets, and cue expiry.

**Non-Goals:**
- No freeform roleplay text.
- No new employee runtime, provider choice, model transport, or SDK lane.
- No storage schema or durable database migration.
- No rewrite of ceremony phase logic; employee presentation is a sibling state layer.

## Decisions

1. Add a reusable employee presentation cue module in `packages/ui-office/src/runtime/employee-performance-cues.ts`.

   The module owns cue types, priorities, TTL defaults, safe text truncation, runtime/scene intent mapping helpers, and state reduction. Keeping this outside React views makes 3D and 2D read the same business truth.

2. Extend `SceneIntentDispatcher` to emit normalized presentation intents for existing event domains.

   Runtime events stay the source of truth. The dispatcher maps `task.assignment.dispatched`, `employee.state.changed`, `tool.execution.telemetry`, `interaction.*`, `handoff.*`, `graph.node.entered`, and `llm.stream.chunk` into cue-ready scene intents. Existing ceremony intents remain intact for movement/phase behavior.

3. Add a hook-level presentation state beside ceremony, not inside ceremony.

   Ceremony describes team-level phases. Employee cues describe per-person actions. Keeping them separate avoids coupling bubbles to meeting text and makes company switch cleanup explicit.

4. Render employee cues through the existing 3D marker and 2D canvas snapshot.

   3D uses the current employee marker, Html overlay, state rings, and existing flow-line layer. 2D extends `EmployeeRenderData` with a bubble field and draws it in `draw-employees`, preserving the ordered layer pipeline.

5. Use deterministic priority: failed/blocked > waiting for user > review/report > active tool > dispatch/handoff > ambient.

   The reducer keeps only the highest-priority active cue per employee. Lower-priority cues can replace only after the prior cue expires or resolves, so transient tool chatter does not hide user-actionable states.

## Risks / Trade-offs

- [Risk] Too many bubbles can clutter the office → Keep one main bubble per employee, cap text length, collapse far 3D markers to icon/badge, and skip inactive cues after TTL.
- [Risk] LLM chunks may leak sensitive or long content → Only boss/manager/reporting chunks are eligible, redact secrets/code-like content, and truncate aggressively.
- [Risk] 2D and 3D drift in meaning → Both consume the same `EmployeePresentationState` and only differ in rendering detail.
- [Risk] Old cues survive company switch or aborted work → Presentation hook resets on `companyId`, unmount, explicit clear intents, terminal employee states, and TTL sweeps.
- [Risk] Rendering changes affect release desktop performance → Keep data small, reuse existing render loops, and rely on existing 3D performance fallback.

## Migration Plan

1. Add OpenSpec contract and task checklist.
2. Implement cue model, scene intent mapping, and presentation hook.
3. Wire 3D and 2D renderers to the shared cue state.
4. Run OpenSpec validation and build gates.
5. Run release `.app` verification with Computer Use. If release verification is blocked, leave verification tasks unchecked and report the blocker.
