# CLAUDE.md

This file is the CLAUDE entrypoint for this repository.

## Read first

Before changing code or specs, read in this order:

1. `README.md`
2. `CLAUDE.md`
3. `spec/PROJECT_CONSTITUTION.md`
4. the rest of `/spec`
5. the relevant contracts in `Docs/02_contracts_and_schemas/`

## Project

AI Company Simulator (AICS) is a local-first, open-source AI company runtime plus an official marketplace website for installable assets.

This is **not** a generic Next.js app.

Primary repo shape:

- `apps/web` — Vite + React SPA for the browser runtime shell
- `apps/desktop` — Tauri 2 desktop app (**1.0 reference environment**)
- `apps/market` — public marketplace website (Next.js App Router, SEO-oriented)
- `apps/platform` — platform API / workers / registry services
- `packages/core` — orchestration kernel, runtime domain logic, LLM gateway
- `packages/renderer` — PixiJS office scene runtime
- `packages/ui-*` — DOM UI packages for office chrome / market UI
- `packages/asset-schema` — manifest schema, validators, type contracts
- `packages/install-core` — install planner, compatibility checks, rollback flow
- `packages/registry-client` — marketplace read/write client contracts
- `packages/db-local` — local runtime schema / migrations
- `packages/db-platform` — platform registry schema / migrations

## Product truth

AICS is built around four non-negotiable ideas:

1. **Multi-agent collaboration is the product core.**
   Employees, Manager, PM, meetings, handoffs, queueing, interrupts, resume, and reporting are first-class.
2. **Model choice belongs to the user’s local runtime.**
   Packages may recommend model profiles, but they must not hard-bind the product to one provider, one model, or one coding runtime.
3. **The marketplace is a registry + distribution surface, not the user’s execution plane.**
   Listings are public website pages; packages are installable assets; installed instances live in the user’s local runtime.
4. **Packages are declarative and auditable.**
   1.0 does not allow install hooks, postinstall scripts, or embedded secrets.

## Read selectively for narrow work

- Architecture / folders / dependency choices / validation:
  - `spec/ENGINEERING_RULES.md`
- Visual system / tokens / office-vs-market visual language:
  - `spec/DESIGN_RULES.md`
- Interaction / install review flows / motion / accessibility:
  - `spec/UX_RULES.md`
- Non-negotiable project principles:
  - `spec/PROJECT_CONSTITUTION.md`
- Office scene feedback, runtime presentation, animation logic, and procedural-art systems:
  - `Docs/04_runtime_experience/AICS_RUNTIME_EXPERIENCE_GDD.md`
  - `Docs/04_runtime_experience/SCENE_STATE_MATRIX.md`
  - `Docs/04_runtime_experience/ANIMATION_BACKLOG.md`

## Contracts

Read these when work touches behavior defined by contracts:

- Asset manifest / package fields:
  - `Docs/02_contracts_and_schemas/aics_manifest.schema.json`
- Install flow / import states / rollback:
  - `Docs/02_contracts_and_schemas/aics_install_state_machine.md`
- Marketplace and publish APIs:
  - `Docs/02_contracts_and_schemas/aics_openapi.yaml`
- Local runtime DB:
  - `Docs/02_contracts_and_schemas/aics_local_runtime_schema.sql`
- Platform registry DB:
  - `Docs/02_contracts_and_schemas/aics_platform_registry_schema.sql`
- Migration sequence:
  - `Docs/03_migrations/aics_migrations_local_v0.1/`
  - `Docs/03_migrations/aics_migrations_platform_v0.1/`

If a feature changes runtime behavior **and** contracts, update both.

## Critical implementation rules

- Do not treat `apps/web` as a Next.js app.
- `apps/market` is the only place where Next.js is intentional.
- Do not introduce Framer Motion as the default animation system.
  - Office/runtime motion belongs in PixiJS + GSAP.
  - DOM chrome should prefer CSS/native transitions unless a specific surface already chose another approach.
- Do not move core company execution into a hosted SaaS dependency by accident.
- Do not hardcode provider-specific model assumptions inside employee packages, SOP packages, or templates.
- Do not place secrets inside marketplace assets.
- Do not add install hooks, postinstall scripts, arbitrary shell execution, or hidden network bootstrap logic to packages.
- Do not collapse `listing`, `package version`, and `installed instance` into one concept.
- Desktop is the reference environment for 1.0.
  Hosted Web is a constrained environment and must not assume direct access to local files, local MCPs, or local CLIs.
- Reuse existing repo packages and primitives before adding new abstractions.
- Keep code readable, explicit, and easy for another agent to continue.

## Validation rules

Before marking work complete, run the checks relevant to the touched scope.

Expected minimum:

- lint
- typecheck
- tests for changed logic
- build for affected apps/packages

Add these when relevant:

- manifest validation
- install-planner / compatibility tests
- migration dry run
- API schema validation
- scene/runtime smoke test for touched Pixi flows

Do not claim success if validation is knowingly broken.

## Session handoff rules

When a session completes its assigned work (a plan, a phase, a feature), it must NOT end with just “done”. Instead, it must provide a **handoff block** containing:

1. **What was completed** — list of commits, tags, key files changed
2. **Current repo health** — build / lint / test status (run and show output)
3. **What should happen next** — concrete next phase/task with rationale
4. **Starter prompt for next session** — a copy-pasteable prompt the user can give to a new Claude session to continue the work without re-explaining context

This ensures continuity across sessions. The `docs/plans/` directory is the persistent bridge between sessions — design docs and implementation plans live there.

## Working style

- Prefer small production-grade changes over broad speculative rewrites.
- Prefer direct edits over adding “temporary” parallel systems.
- Prefer updating contracts and code together when behavior changes.
- Prefer explicit trade-offs in comments / PR text over hidden cleverness.
- If a generic web best practice conflicts with repo reality, **repo reality wins**.
