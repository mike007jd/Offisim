# Contributing To Offisim

## Development Baseline

Required:

- Node.js >=22.19.0
- `corepack` enabled
- `pnpm@11.13.1`

Optional:

- Rust and Tauri prerequisites, if you build `apps/desktop`
- PostgreSQL, if you run `apps/platform`

Start with [`Docs/00_start_here/LOCAL_DEVELOPMENT.md`](../Docs/00_start_here/LOCAL_DEVELOPMENT.md).

## Branching

- Base branch: `main`
- Feature branches: `feature/<name>` or `fix/<name>`
- Keep pull requests focused; avoid unrelated cleanup in the same PR

## Pull Request Recommendations

For manual verification before opening a PR, run the checks relevant to your change locally.

## Commit Style

Use conventional commits when practical:

- `feat:`
- `fix:`
- `docs:`
- `refactor:`
- `chore:`

## Code Style

- Formatting and linting are enforced with Biome
- TypeScript should remain strict and explicit
- Prefer focused files and narrow responsibilities
- Do not introduce hidden install hooks, bundled secrets, or provider-locked behavior

## Architecture Boundaries

Read these before major changes:

- [`CLAUDE.md`](../CLAUDE.md) — repo-wide AI operating rules and architectural context
- Per-package `CLAUDE.md` where present (`packages/core/CLAUDE.md`, `apps/desktop/CLAUDE.md`, `apps/platform/CLAUDE.md`)

## Verification Guidance

- Offisim does not maintain ordinary source-level product test suites; runtime and product invariants live in repository harnesses and `pnpm validate`.
- Validate changes in the real runtime surface affected by the change.
- For UI/runtime work, include brief manual verification notes when relevant.

## Reporting Security Issues

Do not file public issues for vulnerabilities. Follow [`SECURITY.md`](../SECURITY.md).
