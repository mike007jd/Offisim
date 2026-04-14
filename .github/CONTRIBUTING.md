# Contributing To Offisim

## Development Baseline

Required:

- Node.js 20+
- `corepack` enabled
- `pnpm@10`

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

- [`spec/PROJECT_CONSTITUTION.md`](../spec/PROJECT_CONSTITUTION.md)
- [`spec/ENGINEERING_RULES.md`](../spec/ENGINEERING_RULES.md)
- [`spec/UX_RULES.md`](../spec/UX_RULES.md)
- [`spec/DESIGN_RULES.md`](../spec/DESIGN_RULES.md)

## Verification Guidance

- Offisim no longer maintains automated test suites.
- Validate changes in the real runtime surface affected by the change.
- For UI/runtime work, include brief manual verification notes when relevant.

## Reporting Security Issues

Do not file public issues for vulnerabilities. Follow [`SECURITY.md`](../SECURITY.md).
