# Offisim Test / Harness Patterns

> **When to use:** Creating or editing deterministic harness scenarios, migrating legacy tests, or adding focused coverage for repositories, runtime orchestration, zones, renderer layout, workspace navigation, or UI-office hooks/components.

Current architecture decision: Offisim is Tauri v2 desktop-only. Renderer code lives under `apps/desktop/renderer`; do not add product validation that treats standalone web as a product surface.

Use the repo's existing test scaffolds instead of inventing new fixtures.

## Core Patterns

### Memory-first unit tests
- Prefer `createMemoryRepositories()` for service tests.
- Pair it with `InMemoryEventBus` for deterministic event assertions.
- This is the default for service, repo, and template coverage.

### Runtime graph tests
- Use `createRuntimeContext()` or helpers under `packages/core/src/__tests__/helpers/`.
- Assert emitted events and persisted side effects, not just returned strings.

### Drizzle only when semantics matter
- Use Drizzle/integration tests for transaction guarantees, persistence compatibility, or SQL behavior.
- Do not pay the Drizzle cost for logic that memory repos already cover.

## UI-office Patterns

- Use the shared jsdom setup in `packages/ui-office/src/__tests__/setup.ts`.
- Mock `useOffisimRuntime`, `useCompanyCreation`, or context providers when the test only cares about rendering logic.
- Keep event buses fake and synchronous unless the test explicitly covers event streaming.

## Workspace IA Patterns

- Workspace session state coverage belongs to the desktop renderer target `apps/desktop/renderer/src/components/workspaces/`.
- `useWorkspaceSessionState.test.ts` — tests session state preservation across workspace switches.
- `useWorkspaceBackNavigation.test.ts` — tests browser history integration and back unwind ordering.
- `WorkspaceRouter.test.ts` — tests workspace exclusivity (exactly one workspace mounted at a time).
- `WorkspacePageShell.test.ts` — tests page shell rendering with header/loading/error states.
- `computeLayoutTier.test.ts` — tests responsive tier determinism (same width → same tier).
- For workspace state machine tests, use `createDefaultSessionState()` from `types.ts` as the baseline.
- Property-based tests (fast-check) are optional but encouraged for state machine invariants.

## Renderer / Zone Rules

- Prefer testing layout helpers like `computeFloorPlan()` over canvas-level rendering.
- For zone-related tests, assert both assignment and ID shape.
  - Role resolves to an existing zone.
  - Persisted `zone_id` matches `companyId::slug`.

## Good Defaults

- One behavioral reason per test.
- Verify the user-visible effect or persisted row, not internal implementation trivia.
- When adding a new bugfix, write the failing regression assertion first, then patch the code.
