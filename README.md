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
- Browser runtime only: `pnpm --filter @offisim/web dev`
- Platform API: `pnpm --filter @offisim/platform dev`
- Docker stack: `docker compose -f docker/docker-compose.yml up --build`

## Validation Policy

The repository no longer keeps automated test suites or scripted smoke flows.

Validation now happens in live runtime:

- run the affected app/package directly
- verify the exact UI/runtime behavior by hand
- keep evidence in commit notes or handoff notes when a phase is closed

Do not reintroduce `vitest`, `playwright`, `pnpm test`, `test:ai`, or ad-hoc smoke scripts.

Detailed machine setup, env notes, and startup combinations live in `Docs/00_start_here/LOCAL_DEVELOPMENT.md`.
Deployment-specific guidance lives in `Docs/00_start_here/DEPLOYMENT.md`.

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
5. **Desktop is the 1.0 reference environment.**
   Hosted Web remains supported but constrained by browser capabilities.

## Repository / project shape

Current application/package shape:

- `apps/web` — Vite + React runtime shell in browser
- `apps/desktop` — Tauri 2 desktop app (**reference environment**)
- `apps/platform` — registry/auth/review/install support API
- `packages/core` — orchestration kernel and runtime domain logic
- `packages/renderer` — scene tokens, layout engine, prefab/state logic
- `packages/ui-office` — office shell and scene views (`Three.js` 3D + `SVG` 2D)
- `packages/ui-core` — shared DOM primitives
- `packages/asset-schema` / `install-core` / `registry-client` / `db-*` / `shared-types` / `doc-engine` — contracts and support layers

## Document map

### Root guidance

- `README.md` — this file; project truth and document routing
- `Docs/00_start_here/LOCAL_DEVELOPMENT.md` — new-machine setup, prerequisites, env, and local startup commands

### AI operating rules

- `CLAUDE.md` — primary AI working instructions (root + per-package under `packages/*/CLAUDE.md`, `apps/*/CLAUDE.md`)

### Capability specs

- `openspec/specs/` — capability specifications (rebuild in progress; will grow as stable capabilities are locked down)
- `openspec/changes/` — active change proposals

### Live contracts (code is the source of truth)

- Package manifest schema → `packages/asset-schema/src/schema/manifest-1.0.0.json` + `packages/asset-schema/src/manifest.types.ts`
- Install state machine → `packages/install-core/src/state-machine.ts` + `packages/shared-types/src/install.ts`
- Platform HTTP API → `apps/platform/src/routes/`
- Local SQLite schema → `packages/db-local/src/schema.ts` + `packages/db-local/src/schema.sql`
- Platform Postgres schema → `packages/db-platform/src/schema.ts`
- A2A JSON-RPC → `packages/core/src/a2a/`
- LangGraph kernel state → `packages/core/src/graph/state.ts`

### Working notes (evolving, not authoritative)

- `Docs/04_runtime_experience/` — scene / chat / runtime UX notes still in flux
- `Docs/design/spacing-density.md`

## Recommended reading order for AI agents

1. `README.md`
2. `CLAUDE.md` (root + relevant package CLAUDE.md)
3. `openspec/specs/` for the capability being touched
4. Code paths listed under **Live contracts** for the affected surface
5. `packages/db-local/src/schema.sql` or `packages/db-platform/src/schema.ts` when the task touches persistence

## Document precedence

When two sources overlap, use this order:

1. Code + `git log` — the only live truth
2. `CLAUDE.md` (root and per-package)
3. `openspec/specs/` for the affected capability
4. `Docs/` working notes (informational only, do not treat as contracts)

## Task routing

If a task is about...

- **runtime behavior, orchestration, local state, installs** → start with `ENGINEERING_RULES`, contracts, and schemas
- **visual language or marketplace presentation** → start with `DESIGN_RULES`
- **user flows, trust, readability, accessibility** → start with `UX_RULES`
- **office scene animation or rich feedback** → start with the GDD, then `SCENE_STATE_MATRIX`
- **platform publish / listing / versions / reviews** → start with OpenAPI and platform schema

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
