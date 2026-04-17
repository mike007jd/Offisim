## ADDED Requirements

### Requirement: useCeremonyEventBindings is a thin composition hook

`packages/ui-office/src/hooks/useCeremonyEventBindings.ts` SHALL contain no more than 150 non-blank, non-comment lines and SHALL only: (a) accept `CeremonyEventBindingDeps`, (b) call sub-hooks from `packages/ui-office/src/lib/ceremony/` (scene-state / scheduling / phase-actions / event-coordination), (c) subscribe each `event-handlers/*` factory with its deps and collect unsubscribe functions, (d) return void. Inline event handler bodies, phase action bodies, scene-state ref initialization, or module-level mutable state SHALL NOT live in this file.

#### Scenario: File size gate
- **WHEN** `grep -cvE '^\s*(//|$|/\*|\*)' packages/ui-office/src/hooks/useCeremonyEventBindings.ts` is run after refactor
- **THEN** the non-blank, non-comment line count is at most 150

#### Scenario: No inline event subscription bodies
- **WHEN** grepping `useCeremonyEventBindings.ts` for `eventBus.on(` or `sceneIntentBus.on(`
- **THEN** exactly zero matches exist — all `.on(` subscriptions live in `event-handlers/` modules

### Requirement: Phase actions live in a standalone module

The four ceremony phase action factories — `createGatherAll`, `createDispatchEmployee`, `createStartEndCeremony`, `createStartDismissPhase` — SHALL live in `packages/ui-office/src/lib/ceremony/ceremony-phase-actions.ts`. Each factory SHALL accept its dependencies (refs, setters, `ceremonyVersionRef`, registry, helpers) and return the phase action callable. The functions `gatherAll`, `dispatchEmployee`, `startEndCeremony`, `startDismissPhase` SHALL NOT have bodies in `useCeremonyEventBindings.ts`.

#### Scenario: Single-point ownership of phase actions
- **WHEN** grepping `packages/ui-office/src` for `function gatherAll` / `function dispatchEmployee` / `function startEndCeremony` / `function startDismissPhase` OR for the factory names `createGatherAll` / `createDispatchEmployee` / `createStartEndCeremony` / `createStartDismissPhase`
- **THEN** all matches are inside `packages/ui-office/src/lib/ceremony/ceremony-phase-actions.ts`

#### Scenario: Barrel uses phase action factories
- **WHEN** reading `useCeremonyEventBindings.ts`
- **THEN** it imports `createGatherAll` / `createDispatchEmployee` / `createStartEndCeremony` / `createStartDismissPhase` from `../lib/ceremony/ceremony-phase-actions` and wraps each into a `useCallback`

### Requirement: Scene-state refs live in a standalone hook

Assigned-work / approval-hold / clarification-hold scene-state refs — `assignedWorkPositionsRef`, `assignedWorkApproachPositionsRef`, `assignedWorkZoneIdsRef`, `approvalHoldPositionsRef`, `clarificationHoldPositionsRef`, `registryRef` — together with the `SeatRegistry.build` effect and the shared `clearAssignedSceneState` callback SHALL live in `packages/ui-office/src/lib/ceremony/ceremony-scene-state.ts`, exported as a hook `useCeremonySceneState`.

#### Scenario: Ref declarations relocated
- **WHEN** grepping `useCeremonyEventBindings.ts` for `useRef<Map<string,` declarations of `assignedWorkPositionsRef` / `assignedWorkApproachPositionsRef` / `assignedWorkZoneIdsRef` / `approvalHoldPositionsRef` / `clarificationHoldPositionsRef`
- **THEN** zero matches exist in `useCeremonyEventBindings.ts` — all declarations live in `ceremony-scene-state.ts`

#### Scenario: SeatRegistry build effect relocated
- **WHEN** grepping the ceremony hook subtree (`packages/ui-office/src/hooks/useCeremony*.ts` and `packages/ui-office/src/lib/ceremony/**`) for `SeatRegistry.build(` call sites
- **THEN** exactly one match exists, in `ceremony-scene-state.ts` — scene-rendering views (`Office3DView` / `Office2DCanvasView`) continue to build their own registries for layout, out of this refactor's scope

### Requirement: Event handlers are single-responsibility modules

The ceremony event subscription bodies SHALL be split into one module per event prefix in `packages/ui-office/src/lib/ceremony/event-handlers/`:
- `node-phase-transitions.ts` — subscribes `graph.node.entered`
- `task-dispatch.ts` — subscribes `task.assignment.dispatched` and `scene.task.dispatched`
- `llm-chunk-stream.ts` — subscribes `llm.stream.chunk`
- `plan-created.ts` — subscribes `plan.created`
- `tool-telemetry.ts` — subscribes `tool.execution.telemetry`
- `interaction-approval.ts` — subscribes `interaction.requested`, `interaction.resolved`, `interaction.restored`
- `handoff.ts` — subscribes `handoff.initiated`, `handoff.completed`
- `employee-stalled.ts` — subscribes employee escalation / stalled events

Each module SHALL export a factory of signature `subscribe<Name>(buses, deps) => () => void`. Each factory SHALL return an unsubscribe function. No module SHALL import another `event-handlers/*` module.

#### Scenario: One file per event prefix
- **WHEN** listing `packages/ui-office/src/lib/ceremony/event-handlers/`
- **THEN** exactly these 8 files exist: `node-phase-transitions.ts`, `task-dispatch.ts`, `llm-chunk-stream.ts`, `plan-created.ts`, `tool-telemetry.ts`, `interaction-approval.ts`, `handoff.ts`, `employee-stalled.ts`

#### Scenario: Handler factories return unsubscribe
- **WHEN** the barrel calls `const unsub = subscribeNodePhaseTransitions(eventBus, deps)`
- **THEN** `unsub` is a zero-argument function that calls the underlying `eventBus.on(...)` unsubscribe when invoked

#### Scenario: No cross-handler imports
- **WHEN** grepping `packages/ui-office/src/lib/ceremony/event-handlers/*.ts` for `from './` imports of sibling handlers
- **THEN** zero matches exist — handlers are peers, not layered

### Requirement: Shared handler state is passed via explicit refs

Mutable state shared across event handlers — currently closure-scoped as `hasActivePlan` and `lastLlmChunk` inside the 580-line `useEffect` — SHALL be exposed as explicit `MutableRefObject<T>` values through a coordination module `packages/ui-office/src/lib/ceremony/ceremony-event-coordination.ts`. The coordination module SHALL export a hook `useCeremonyEventCoordination()` returning `{ hasActivePlanRef, lastLlmChunkRef }` (and any future cross-handler refs). Handlers SHALL read and write only through these refs; module-level mutable state for these values SHALL NOT exist anywhere in the codebase.

#### Scenario: No closure-scoped shared state
- **WHEN** grepping `useCeremonyEventBindings.ts` for `let hasActivePlan` or `let lastLlmChunk`
- **THEN** zero matches exist — both live behind refs from `useCeremonyEventCoordination`

#### Scenario: Manager re-entry resets hasActivePlanRef
- **WHEN** `graph.node.entered` fires with `nodeName: 'manager'` while `hasActivePlanRef.current === true`
- **THEN** the `node-phase-transitions` handler sets `hasActivePlanRef.current = false` before starting the new gathering phase — identical to pre-refactor behavior

#### Scenario: Boss summary streaming updates lastLlmChunkRef
- **WHEN** the `llm-chunk-stream` handler receives a chunk with `nodeName: 'boss_summary'` and non-empty content
- **THEN** it writes the accumulated text to `lastLlmChunkRef.current` — the `node-phase-transitions` handler reads this ref when firing `startEndCeremony`

### Requirement: Ceremony version guard is preserved in every async callback

Every handler factory and phase action SHALL accept `ceremonyVersionRef: MutableRefObject<number>` and SHALL guard every `safeTimeout` / async continuation with `if (ceremonyVersionRef.current !== version) return`. The guard logic SHALL NOT be removed, inlined-away, or replaced by alternative cancellation mechanisms in the refactor.

#### Scenario: Every async callback guards the version
- **WHEN** reading any `safeTimeout(() => { ... })` call body in `packages/ui-office/src/lib/ceremony/**/*.ts`
- **THEN** the body begins with `if (ceremonyVersionRef.current !== version) return;` (or equivalent short-circuit) before any state mutation, movement command, or ceremony-reset call — unless the callback was already unconditional pre-refactor

#### Scenario: Version increments on manager re-entry
- **WHEN** the `node-phase-transitions` handler observes a second `graph.node.entered` with `nodeName: 'manager'` during an active ceremony
- **THEN** `ceremonyVersionRef.current` increments by 1 before any state mutation, causing all pending safeTimeout callbacks from the prior ceremony to short-circuit

### Requirement: Observable ceremony behavior is unchanged after refactor

For identical input (same live task, same agents, same zones, same provider / model), the user-visible ceremony behavior SHALL be byte-identical before and after the refactor across: phase transition sequence, bubble text content at each phase, manager presence positions, employee movement routes, interaction hold positions, handoff visuals, and waiting relationship state.

#### Scenario: Full ceremony phase sequence
- **WHEN** sending a live task `"Write a one-sentence tagline for a coffee shop"` with the same MiniMax provider and same employee roster
- **THEN** the ceremony phases progress through `gathering → analyzing → planning → dispatching → working → reporting → dismissing` in the same order and with the same bubble text at each phase as pre-refactor

#### Scenario: Boss summary streaming bubble text
- **WHEN** the boss summary LLM stream produces chunks during the `reporting` phase
- **THEN** the ceremony bubble text updates live with `truncate(accumulatedBossText, 50)` — identical to pre-refactor

#### Scenario: Tool telemetry working animation
- **WHEN** `tool.execution.telemetry` fires with `status: 'started'` for a dispatched employee during `working` phase
- **THEN** the employee's 3D handle moves to `buildWorkActivityTarget(basePosition, toolCategory, obstacles)` and the bubble shows `describeWorkingToolActivity(payload)` — identical to pre-refactor

#### Scenario: Interaction approval hold position
- **WHEN** `interaction.requested` fires with `kind: 'permission_request'` for a dispatched employee
- **THEN** the employee moves via `buildReturnToMeetingRoute` to `buildApprovalHoldTarget(meetingCenter, index)` — identical to pre-refactor

#### Scenario: Manager re-entry interrupts ongoing ceremony
- **WHEN** `graph.node.entered: manager` fires while phase is `working`
- **THEN** all movement handles stop, all employees move to rest, scene state is cleared, and a new `gathering` phase starts after a 300ms delay — identical to pre-refactor

### Requirement: Public API of useSceneOrchestrator is unchanged

The `useCeremonyEventBindings` hook SHALL continue to be an internal export of the `hooks/useSceneOrchestrator.ts` barrel family, not imported by consumers outside that family. The public export list of `useSceneOrchestrator.ts` SHALL remain identical to pre-refactor.

#### Scenario: Event bindings hook remains internal
- **WHEN** grepping the repository for `useCeremonyEventBindings` imports
- **THEN** matches exist only within `packages/ui-office/src/hooks/` and `packages/ui-office/src/lib/ceremony/` — no consumer imports

#### Scenario: Public export parity
- **WHEN** comparing `grep '^export' packages/ui-office/src/hooks/useSceneOrchestrator.ts` pre-change vs post-change
- **THEN** every exported name pre-change is still exported post-change — no removals
