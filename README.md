# AI Company Simulator (AICS)

AICS is a **local-first, open-source AI company runtime** plus an **official marketplace website** for installable assets.

The product is not a generic SaaS dashboard and not a literal game engine. It uses an office metaphor and game-grade presentation to make multi-agent work understandable, trustworthy, and alive.

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

Planned application/package shape:

- `apps/web` — Vite + React runtime shell in browser
- `apps/desktop` — Tauri 2 desktop app (**reference environment**)
- `apps/market` — public marketplace website (Next.js App Router)
- `apps/platform` — APIs, workers, registry, moderation, publish flow
- `packages/core` — orchestration kernel and runtime domain logic
- `packages/renderer` — PixiJS office scene runtime
- `packages/asset-schema` / `install-core` / `registry-client` / `db-*` — contracts and platform/runtime support layers

## Document map

### Root guidance

- `README.md` — this file; project truth and document routing
- `AGENTS.md` — Codex-oriented repo instructions
- `CLAUDE.md` — Claude Code-oriented repo instructions
- `GEMINI.md` — Gemini-oriented repo instructions

### Human rules

- `spec/PROJECT_CONSTITUTION.md` — highest-level non-negotiable rules
- `spec/ENGINEERING_RULES.md` — architecture, state, contracts, implementation boundaries
- `spec/UX_RULES.md` — interaction, install trust, accessibility, motion principles
- `spec/DESIGN_RULES.md` — visual language and presentation guardrails

### Current product / architecture specs

- `Docs/01_current_specs/AI_Company_Simulator_PRD_v1.6_updated.docx`
- `Docs/01_current_specs/AI_Company_Simulator_TechStack_v1.5_updated.docx`
- `Docs/01_current_specs/AI_Company_Simulator_Asset_and_Schema_Spec_v0.1.docx`

### Contracts and schemas

- `Docs/02_contracts_and_schemas/aics_openapi.yaml`
- `Docs/02_contracts_and_schemas/aics_install_state_machine.md`
- `Docs/02_contracts_and_schemas/aics_manifest.schema.json`
- `Docs/02_contracts_and_schemas/aics_manifest_example.json`
- `Docs/02_contracts_and_schemas/aics_local_runtime_schema.sql`
- `Docs/02_contracts_and_schemas/aics_platform_registry_schema.sql`

### Migration packs

- `Docs/03_migrations/aics_migrations_local_v0.1/`
- `Docs/03_migrations/aics_migrations_platform_v0.1/`

### Runtime experience / game-grade presentation docs

- `Docs/04_runtime_experience/AICS_RUNTIME_EXPERIENCE_GDD.md`
- `Docs/04_runtime_experience/SCENE_STATE_MATRIX.md`
- `Docs/04_runtime_experience/ANIMATION_BACKLOG.md`

## Recommended reading order for AI agents

1. `README.md`
2. `AGENTS.md` or the tool-specific entry file (`CLAUDE.md`, `GEMINI.md`)
3. `spec/PROJECT_CONSTITUTION.md`
4. the rest of `/spec`
5. relevant files under `Docs/02_contracts_and_schemas/`
6. the three docs in `Docs/01_current_specs/`
7. `Docs/04_runtime_experience/` when the task touches scene, animation, install trust presentation, or runtime feedback
8. `Docs/03_migrations/` when the task touches persistence

## Document precedence

When two documents overlap, use this order:

1. `spec/PROJECT_CONSTITUTION.md`
2. machine-readable contracts and schemas in `Docs/02_contracts_and_schemas/`
3. `spec/ENGINEERING_RULES.md`
4. `spec/UX_RULES.md`
5. `spec/DESIGN_RULES.md`
6. `Docs/04_runtime_experience/*`
7. the broader product/architecture docs in `Docs/01_current_specs/`

## Task routing

If a task is about...

- **runtime behavior, orchestration, local state, installs** → start with `ENGINEERING_RULES`, contracts, and schemas
- **visual language or marketplace presentation** → start with `DESIGN_RULES`
- **user flows, trust, readability, accessibility** → start with `UX_RULES`
- **office scene animation or rich feedback** → start with the GDD, then `SCENE_STATE_MATRIX`, then `ANIMATION_BACKLOG`
- **platform publish / listing / versions / reviews** → start with OpenAPI and platform schema

## Important guardrails

- Do not accidentally turn AICS into a hosted SaaS execution plane.
- Do not hardcode provider-specific model assumptions into marketplace assets.
- Do not place secrets in assets.
- Do not add install hooks or postinstall scripts in 1.0.
- Do not treat the product as a literal game, but do preserve game-grade presentation quality where it improves clarity and trust.
