# Offisim Test / Harness Patterns

> **When to use:** Creating or editing deterministic harness scenarios, or adding focused coverage for repositories, runtime orchestration, zones, or desktop renderer integration.

Current architecture decision: Offisim is Tauri v2 desktop-only. Renderer code lives under `apps/desktop/renderer`; do not add product validation that treats standalone web as a product surface.

There is no vitest/jest in this repo and no `.test`/`.spec` files. All verification is plain Node harness scripts (`scripts/harness-*.mjs` / `*.mts`) wired into `package.json` and run through `pnpm validate` or a focused `pnpm harness:*` target. Use the repo's existing harness scaffolds instead of inventing new fixtures.

## Core Patterns

### Memory-first harnesses
- Prefer `createMemoryRepositories()` for service-level scenarios.
- Pair it with `InMemoryEventBus` for deterministic event assertions.
- This is the default for service, repo, and template coverage.

### Runtime orchestration harnesses
- Use `createRuntimeContext()` as the building block for runtime scenarios.
- Assert emitted events and persisted side effects, not just returned strings.

### Real SQLite only when semantics matter
- Reach for a real-database harness for transaction guarantees, persistence compatibility, or SQL behavior.
- Do not pay that cost for logic the memory repos already cover.

## Desktop Renderer Reset

- The previous shared UI-package verification surface has been removed.
- Do not add harnesses or fixtures that assume the previous workspace shell, router, scene, chat rail, or component library still exists.
- New UI work should define its own focused verification path after the new design is implemented.

## Renderer / Zone Rules

- Prefer exercising pure layout/projection helpers over canvas-level rendering.
- For zone-related checks, assert both assignment and ID shape.
  - Role resolves to an existing zone.
  - Persisted `zone_id` matches `companyId::slug`.

## Good Defaults

- One behavioral reason per scenario.
- Verify the user-visible effect or persisted row, not internal implementation trivia.
- When fixing a bug, add the failing regression assertion to the relevant harness first, then patch the code.
