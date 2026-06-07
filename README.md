# Offisim

![License](https://img.shields.io/badge/license-MIT-0f172a)
![Release](https://img.shields.io/badge/version-1.0.0--rc.1-2563eb)

Offisim is a **local-first, open-source AI company runtime** plus a **platform/registry backend** for installable assets.

The product is not a generic SaaS dashboard and not a literal game engine. It uses an office metaphor and game-grade presentation to make multi-agent work understandable, trustworthy, and alive.

Run an AI company on your own machine: multi-agent orchestration, spatial office UI, installable assets, and a local-first runtime that keeps execution close to the user.

## Release Quick Start

Recommended Docker flow:

```bash
docker compose -f docker/docker-compose.yml up --build
```

## Quick Start

If you are pulling this repo onto a new machine, start here:

1. Install `Node.js 20+` and enable `corepack`.
2. Install `pnpm@10.15.1`.
3. If you plan to run the desktop app, install Rust/Cargo and the Tauri system prerequisites for your OS.
4. If you plan to run the platform API, install PostgreSQL and create a local database.
5. Copy `.env.example` to `.env.local` and fill in the values you need.
6. Run `pnpm install` from the repo root.

Common local entrypoints:

- Recommended desktop flow: `pnpm --filter @offisim/desktop dev`
- Desktop renderer dev server only: `pnpm --filter @offisim/desktop-renderer dev`
- Platform API: `pnpm --filter @offisim/platform dev`
- Docker stack: `docker compose -f docker/docker-compose.yml up --build`

## Validation Policy

Offisim does not keep a broad product unit-test suite. Release validation is a
smaller set of retained gates that must match the risk of the change:

- deterministic harness scenarios for graph/runtime/permission/planner/LLM replay invariants
- aggregated security harnesses for P0/P1 platform, marketplace, local-tool, attachment, registry, provider-list, and web fetch/search boundaries
- targeted Rust safety checks for desktop credential transport, sidecars, workspace containment, local shell/git/path commands, and install materialization
- platform migration generation/drift checks for `apps/platform` / `packages/db-platform`
- package builds for the desktop renderer before any desktop verification
- release `.app` live verification from the current worktree path for desktop runtime behavior

Do not reintroduce broad `vitest`, Playwright, `pnpm test`, `test:ai`, or ad-hoc
smoke suites as product gates. Temporary local exploration is allowed, but
release evidence must name the deterministic harness/Rust/platform/build/live
gate that actually proved the behavior.

For desktop release verification, dev webviews, dev servers, localhost browser
results, and old bundle-id launches are not sufficient. Build the desktop
renderer and `@offisim/desktop`, launch the exact release `.app` path from this
worktree, and record the app path/hash plus Computer Use or equivalent
release-app evidence.

Detailed machine setup, env notes, and startup combinations live in `Docs/00_start_here/LOCAL_DEVELOPMENT.md`.
Deployment-specific guidance lives in `Docs/00_start_here/DEPLOYMENT.md`.
Release gate commands and evidence requirements live in `Docs/00_start_here/RELEASE_GATES.md`.

For platform-backed local or deployed usage, the most important environment variables are:

- `DATABASE_URL`
- `CORS_ORIGINS`
- `BETTER_AUTH_SECRET`
- provider API keys such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENROUTER_API_KEY`

## Naming Note

The product and package scope are branded as `Offisim` / `@offisim/*`.

## Core product truths

1. **Multi-agent collaboration is the product core.**
   Boss, Manager, PM, employees, meetings, queueing, interrupts, resume, and reporting are first-class.
2. **Execution lives in the user's local runtime.**
   The marketplace is a registry and distribution surface, not the user's execution plane.
3. **Model choice belongs to the user.**
   Marketplace assets may recommend model profiles, but must not hard-bind the product to one provider, one model, or one coding runtime.
4. **Packages are declarative and auditable.**
   1.0 does not allow install hooks, postinstall scripts, embedded secrets, or hidden shell bootstrap behavior.
5. **Desktop is the product environment.**
   Offisim ships as a Tauri desktop app with an internal WebView renderer, not a standalone web runtime.

## Repository / project shape

Current application/package shape:

- `apps/desktop` — Tauri 2 desktop app and release target
- `apps/desktop/renderer` — internal Vite + React WebView renderer owned by the desktop app; currently a clean new-design mount point
- `apps/platform` — registry/auth/review/install support API
- `packages/core` — orchestration kernel and runtime domain logic
- `packages/renderer` — scene tokens, layout engine, prefab/state logic
- `packages/asset-schema` / `install-core` / `registry-client` / `db-*` / `shared-types` / `doc-engine` — contracts and support layers

## Document map

### Root guidance

- `README.md` — this file; project truth and document routing
- `Docs/00_start_here/LOCAL_DEVELOPMENT.md` — new-machine setup, prerequisites, env, and local startup commands
- `Docs/00_start_here/DEPLOYMENT.md` — platform/registry backend deployment (Docker) and desktop distribution
- `Docs/00_start_here/RELEASE_GATES.md` — the gate commands and evidence requirements for a release

### AI operating rules

- `CLAUDE.md` — primary AI working instructions (root + per-package under `packages/*/CLAUDE.md`, `apps/*/CLAUDE.md`)

### Live contracts (code is the source of truth)

- Package manifest schema → `packages/asset-schema/src/schema/manifest-1.0.0.json` + `packages/asset-schema/src/manifest.types.ts`
- Install state machine → `packages/install-core/src/state-machine.ts` + `packages/shared-types/src/install.ts`
- Platform HTTP API → `apps/platform/src/routes/`
- Local SQLite schema → `packages/db-local/src/schema.ts` + `packages/db-local/src/schema.sql`
- Platform Postgres schema → `packages/db-platform/src/schema.ts`
- A2A JSON-RPC → `packages/core/src/a2a/`
- LangGraph kernel state → `packages/core/src/graph/state.ts`

### Working notes (evolving, not authoritative)

- `Docs/UI_FRAMEWORK_STACK.md` — the approved renderer UI stack (source of truth for new UI work)
- `Docs/design/` — per-surface HTML prototype specs (Office, Settings, Market, Personnel, Activity, Workspace, lifecycle, states)
- `Docs/design/spacing-density.md` — spacing token reference

## Recommended reading order for AI agents

1. `README.md`
2. `CLAUDE.md` (root + relevant package CLAUDE.md)
3. Code paths listed under **Live contracts** for the affected surface
4. `packages/db-local/src/schema.sql` or `packages/db-platform/src/schema.ts` when the task touches persistence

## Document precedence

When two sources overlap, use this order:

1. Code + `git log` — the only live truth
2. `CLAUDE.md` (root and per-package)
3. `Docs/` working notes (informational only, do not treat as contracts)

## Task routing

If a task is about...

- **runtime behavior, orchestration, local state, installs** → start with `CLAUDE.md`, the **Live contracts** above, and `packages/db-local/src/schema.sql`
- **visual language or marketplace presentation** → start with `Docs/UI_FRAMEWORK_STACK.md` and `Docs/design/`
- **user flows, trust, readability, accessibility** → start with the per-surface prototypes in `Docs/design/`
- **office scene / layout / prefabs** → start with `packages/renderer` (scene tokens, layout engine, prefab/state logic) and `Docs/design/offisim-office-layout-v3-prototype.html`
- **platform publish / listing / versions / reviews** → start with `apps/platform/src/routes/` and `packages/db-platform/src/schema.ts`

## Important guardrails

- Do not accidentally turn Offisim into a hosted SaaS execution plane.
- Do not hardcode provider-specific model assumptions into marketplace assets.
- Do not place secrets in assets.
- Do not add install hooks or postinstall scripts in 1.0.
- Do not treat the product as a literal game, but do preserve game-grade presentation quality where it improves clarity and trust.

## Contributing

See [`.github/CONTRIBUTING.md`](./.github/CONTRIBUTING.md).

## License

MIT. See [`LICENSE`](./LICENSE).
