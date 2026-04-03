# Offisim Test Patterns

> **When to use:** Creating or editing tests under `packages/*/src/__tests__`, or adding coverage for repositories, runtime orchestration, zones, renderer layout, or UI-office hooks/components.

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

## Renderer / Zone Rules

- Prefer testing layout helpers like `computeFloorPlan()` over canvas-level rendering.
- For zone-related tests, assert both assignment and ID shape.
  - Role resolves to an existing zone.
  - Persisted `zone_id` matches `companyId::slug`.

## Good Defaults

- One behavioral reason per test.
- Verify the user-visible effect or persisted row, not internal implementation trivia.
- When adding a new bugfix, write the failing regression assertion first, then patch the code.
