## ADDED Requirements

### Requirement: useSceneOrchestrator is a thin composition hook
`packages/ui-office/src/hooks/useSceneOrchestrator.ts` SHALL contain no more than 150 non-blank, non-comment lines and SHALL only: (a) accept orchestrator deps, (b) call sub-hooks and sub-modules, (c) re-export the public symbols listed in `design.md` D1. Module-level mutable state (Maps, counters) SHALL NOT live in this file.

#### Scenario: File size gate
- **WHEN** the refactor is complete
- **THEN** `wc -l packages/ui-office/src/hooks/useSceneOrchestrator.ts` returns at most 150 lines excluding blanks and `//` comments

#### Scenario: No mutable module state in orchestrator barrel
- **WHEN** grepping `useSceneOrchestrator.ts` for top-level mutable `Map` / `Set` declarations
- **THEN** zero matches are found — all module-level state has moved to `runtime/movement-handle-registry.ts` and `runtime/zone-slot-counter.ts`

### Requirement: Movement handle registry is a standalone module
The movement handle registry (`companyHandles` Map + `registerMovementHandle` / `unregisterMovementHandle` / `getMovementHandle` / `getMovementDebugInfo`) SHALL live in `packages/ui-office/src/runtime/movement-handle-registry.ts`. The file SHALL be the single source of truth for the registry singleton.

#### Scenario: Single-point ownership
- **WHEN** grepping the repo for `companyHandles` declarations (`const companyHandles` / `let companyHandles`)
- **THEN** exactly one match exists, in `runtime/movement-handle-registry.ts`

#### Scenario: Public API preserved at old import path
- **WHEN** a consumer imports `registerMovementHandle` / `unregisterMovementHandle` / `getMovementHandle` / `getMovementDebugInfo` from `'../hooks/useSceneOrchestrator'` (old path)
- **THEN** the import resolves and returns the same function identity as importing directly from `runtime/movement-handle-registry`

### Requirement: Zone slot counter is a standalone module
The zone slot counter (`zoneSlotCounters` Map + `getNextSlot` / `resetSlotCounters`) SHALL live in `packages/ui-office/src/runtime/zone-slot-counter.ts`.

#### Scenario: Single-point ownership
- **WHEN** grepping the repo for `zoneSlotCounters` declarations
- **THEN** exactly one match exists, in `runtime/zone-slot-counter.ts`

### Requirement: Ceremony state types and idle constant are standalone
`CeremonyState`, `CeremonyPhase`, `WaitingRelationship`, `createIdleCeremonyState`, and `IDLE_CEREMONY` SHALL live in `packages/ui-office/src/hooks/useCeremonyState.ts` (or the equivalent new path chosen during implementation). They SHALL continue to be importable from `'../hooks/useSceneOrchestrator'` via re-export.

#### Scenario: Type re-export preserved
- **WHEN** `packages/ui-office/src/components/scene/Office3DView.tsx` imports `type { CeremonyState }` from `'../../hooks/useSceneOrchestrator.js'`
- **THEN** the build resolves the type without modification to the importer

### Requirement: Event bindings hook is internal
The event binding hook (`useCeremonyEventBindings` or equivalent) SHALL NOT be part of the public surface from `useSceneOrchestrator.ts`. Other modules SHALL NOT import it.

#### Scenario: Internal-only export
- **WHEN** grepping the repo for `useCeremonyEventBindings` imports outside `hooks/useSceneOrchestrator.ts` or its tests
- **THEN** zero matches exist

### Requirement: Behavior is unchanged after refactor
Live-observed ceremony phase transitions, bubble text content, and movement handle lifecycle SHALL be identical before and after the refactor for the same input (same live task, same agents, same zones).

#### Scenario: Ceremony phase progression
- **WHEN** sending a task `"Write a one-sentence tagline for a coffee shop"` with the same MiniMax provider and same employee roster
- **THEN** the ceremony bubble text sequence passes through `gathering → analyzing → planning → dispatching → working → reporting → dismissing → idle` identically to pre-refactor main

#### Scenario: Movement handle registration on employee mount
- **WHEN** an employee is rendered in 3D view
- **THEN** `registerMovementHandle(companyId, employeeId, handle)` is called exactly as before the refactor, and `getMovementHandle(companyId, employeeId)` returns the same handle reference

### Requirement: Public symbol list is preserved
The full set of symbols exported by `hooks/useSceneOrchestrator.ts` pre-refactor SHALL remain exported post-refactor, even if their implementation lives in new modules.

#### Scenario: Export parity
- **WHEN** comparing `grep '^export' packages/ui-office/src/hooks/useSceneOrchestrator.ts` pre-change vs post-change
- **THEN** every exported name from pre-change is still exported post-change (types + values); new helpers may additionally be exported but none is removed
