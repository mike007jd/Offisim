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

Release assets such as screenshots and GIFs can live under `docs/assets/screenshots/` as they are produced.

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
- `packages/asset-schema` / `install-core` / `registry-client` / `db-*` / `shared-types` / `channels` / `doc-engine` — contracts and support layers

## Document map

### Root guidance

- `README.md` — this file; project truth and document routing
- `Docs/00_start_here/LOCAL_DEVELOPMENT.md` — new-machine setup, prerequisites, env, and local startup commands

### Human rules

- `spec/PROJECT_CONSTITUTION.md` — highest-level non-negotiable rules
- `spec/ENGINEERING_RULES.md` — architecture, state, contracts, implementation boundaries
- `spec/UX_RULES.md` — interaction, install trust, accessibility, motion principles
- `spec/DESIGN_RULES.md` — visual language and presentation guardrails

### Contracts and schema snapshots

- `Docs/02_contracts_and_schemas/offisim_openapi.yaml`
- `Docs/02_contracts_and_schemas/offisim_install_state_machine.md`
- `Docs/02_contracts_and_schemas/offisim_manifest.schema.json`
- `Docs/02_contracts_and_schemas/offisim_manifest_example.json`
- `Docs/02_contracts_and_schemas/offisim_local_runtime_schema.sql`
- `Docs/02_contracts_and_schemas/offisim_platform_registry_schema.sql`

`Docs/02_contracts_and_schemas/` should track the current public contract surface and schema snapshots.
Implementation truth still lives in the mounted route files and Drizzle schema/migrations.

### Migration packs

- `Docs/03_migrations/offisim_migrations_local_v0.1/`
- `Docs/03_migrations/offisim_migrations_platform_v0.1/`

### Runtime experience / game-grade presentation docs

- `Docs/04_runtime_experience/OFFISIM_RUNTIME_EXPERIENCE_GDD.md`
- `Docs/04_runtime_experience/SCENE_STATE_MATRIX.md`
- `Docs/04_runtime_experience/ANIMATION_BACKLOG.md`

## Recommended reading order for AI agents

1. `README.md`
2. `spec/PROJECT_CONSTITUTION.md`
3. the rest of `/spec`
4. relevant files under `Docs/02_contracts_and_schemas/`
5. `Docs/04_runtime_experience/` when the task touches scene, animation, install trust presentation, or runtime feedback
6. `Docs/03_migrations/` when the task touches persistence

## Document precedence

When two documents overlap, use this order:

1. `spec/PROJECT_CONSTITUTION.md`
2. machine-readable contracts and schemas in `Docs/02_contracts_and_schemas/`
3. `spec/ENGINEERING_RULES.md`
4. `spec/UX_RULES.md`
5. `spec/DESIGN_RULES.md`
6. `Docs/04_runtime_experience/*`

## Task routing

If a task is about...

- **runtime behavior, orchestration, local state, installs** → start with `ENGINEERING_RULES`, contracts, and schemas
- **visual language or marketplace presentation** → start with `DESIGN_RULES`
- **user flows, trust, readability, accessibility** → start with `UX_RULES`
- **office scene animation or rich feedback** → start with the GDD, then `SCENE_STATE_MATRIX`, then `ANIMATION_BACKLOG`
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
