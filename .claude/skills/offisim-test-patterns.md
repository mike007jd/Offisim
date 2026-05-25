# Offisim Test / Harness Patterns

> **When to use:** Creating or editing deterministic harness scenarios, migrating legacy tests, or adding focused coverage for repositories, runtime orchestration, zones, or desktop renderer integration.

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

## Desktop Renderer Reset

- The previous shared UI-package test surface has been removed.
- Do not add tests or fixtures that assume the previous workspace shell, router, scene, chat rail, or component library still exists.
- New UI work should define its own focused verification path after the new design is implemented.

## Renderer / Zone Rules

- Prefer testing layout helpers like `computeFloorPlan()` over canvas-level rendering.
- For zone-related tests, assert both assignment and ID shape.
  - Role resolves to an existing zone.
  - Persisted `zone_id` matches `companyId::slug`.

## Good Defaults

- One behavioral reason per test.
- Verify the user-visible effect or persisted row, not internal implementation trivia.
- When adding a new bugfix, write the failing regression assertion first, then patch the code.
