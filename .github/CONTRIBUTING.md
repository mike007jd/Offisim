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

## Pull Request Requirements

Before opening a PR, run:

```bash
pnpm lint
pnpm typecheck
pnpm --filter '!@offisim/desktop' --filter '!@offisim/launcher' test
```

If your change touches desktop packaging, also run:

```bash
pnpm --filter @offisim/desktop build
```

## Commit Style

Use conventional commits when practical:

- `feat:`
- `fix:`
- `docs:`
- `refactor:`
- `test:`
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

## Testing Guidance

- Add or update unit tests for behavior changes
- Prefer targeted regression tests before implementation for bug fixes
- For UI-heavy changes, include manual verification notes

## Reporting Security Issues

Do not file public issues for vulnerabilities. Follow [`SECURITY.md`](../SECURITY.md).
