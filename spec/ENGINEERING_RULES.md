# Engineering Rules

## Repository reality

This repo is **not** a greenfield default Next.js application.

Primary stack direction for this repository:

- pnpm monorepo
- TypeScript
- `apps/web`: Vite + React SPA
- `apps/desktop`: Tauri 2 desktop shell
- `apps/platform`: Hono + PostgreSQL
- `packages/core`: LangGraph-based orchestration kernel
- `packages/renderer`: scene tokens, layout engine, and prefab/state logic
- `packages/ui-office`: office shell with `Three.js` / React Three Fiber 3D views and SVG 2D views
- Tailwind CSS for DOM UI
- shadcn/ui primitives for DOM controls where they fit
- Lucide icons
- scene-native animation in office views plus CSS/native transitions for DOM UI
- CSS/native transitions for standard DOM UI unless a surface already chose a specific motion implementation

If a generic framework default conflicts with the repo’s actual architecture, the repo wins.

## Version policy

- Do not guess versions.
- Before adding or upgrading a dependency, verify the latest stable version from official documentation or the package registry.
- For existing packages, stay compatible with the current repo major versions unless an upgrade is explicitly requested.
- Do not introduce canary or beta releases by default.
- Do not perform opportunistic framework migrations while doing unrelated work.

## Architecture rules

### Monorepo boundaries

Keep concerns separated:

- runtime/UI shell
- office renderer
- orchestration/runtime logic
- asset/install contracts
- registry/platform services
- local DB and platform DB access layers

Do not collapse platform code into the runtime package.
Do not couple marketplace rendering concerns to office runtime code.

### App responsibilities

- `apps/web`: browser runtime shell, constrained by browser capabilities
- `apps/desktop`: full-capability reference environment
- `apps/platform`: APIs, workers, moderation, publish flow, registry metadata

### Package responsibilities

Prefer dedicated packages for clearly different concerns, such as:

- `ui-core`
- `ui-office`
- `asset-schema`
- `install-core`
- `registry-client`
- `db-local`
- `db-platform`

Promote a package only when the boundary is real.

## Multi-agent orchestration rules

- LangGraph is the orchestration kernel because multi-agent collaboration is the core product primitive.
- Use explicit graph topology, handoffs, subgraphs, interrupts, and resume points instead of ad hoc agent chains.
- Any feature that claims pause/resume, queueing, or replay must map back to persisted runtime state.
- Do not mirror graph state into random global UI state stores without a strong reason.
- Store durable checkpoints at meaningful workflow boundaries, not every minor UI event.

## Model and runtime rules

- Model/provider/runtime selection belongs to the user’s local runtime configuration.
- Employees are the primary model-carrying asset type.
- Skills, SOPs, templates, and layouts should remain model-agnostic by default.
- Marketplace assets may include recommended model profiles, but must not hard-lock the user to one provider or embed secrets.
- Optional coding runtimes (for example local coding agents) are implementation details of certain employee execution modes, not the central abstraction of the product.

## Asset / install / registry rules

- `listing`, `package version`, and `installed instance` are different concepts. Keep them separate in code and schema.
- Packages are declarative in 1.0.
- Do not add install hooks, postinstall scripts, hidden shell execution, or arbitrary binary bootstrap behavior.
- Manifest schema is the source of truth for package shape.
- Install flow changes must update:
  - manifest contract
  - install state machine
  - local schema if persistence changes
  - platform API/schema if publish or registry behavior changes

## Storage and persistence rules

- Desktop/Tauri-native persistence is the reference path for 1.0.
- Hosted Web must respect browser constraints.
- Keep local runtime persistence separate from platform registry persistence.
- Do not put user company execution state into platform tables by accident.
- Do not store secrets in marketplace packages or public registry payloads.

## UI implementation rules

- Tailwind is the default styling system for DOM UI.
- Reuse existing primitives before creating new ones.
- shadcn/ui is for DOM primitives, not the office canvas.
- Avoid CSS Modules unless a case is truly awkward in Tailwind.
- Avoid inline styles except for dynamic values that cannot be expressed cleanly.
- For office-scene rendering, keep visual constants centralized and data-driven across the `Three.js` 3D view and the `SVG` 2D fallback.

## State management rules

Default order of preference for DOM state:

1. local component state
2. lifted feature state
3. URL/search params for shareable state
4. dedicated store only when the problem truly crosses app boundaries

For runtime execution state:

- prefer repository + LangGraph persistence + explicit event streams
- do not introduce a global client store as a shadow runtime database

## Validation rules

Before declaring work complete, run the checks relevant to the touched scope.

Expected minimum:

- lint
- typecheck
- build for affected targets
- live runtime verification for the changed flow

Add these when relevant:

- manifest validator
- install planner / rollback verification
- migration dry run
- OpenAPI/schema validation
- renderer/runtime hand verification

If validation fails, fix it or explicitly surface the failure.

## Dependency policy

- Avoid adding libraries when the current stack already solves the problem.
- Do not add Framer Motion by default in this repo.
- Do not add a second styling system.
- Do not add a global state library unless the problem clearly requires it.
- Prefer smaller, focused libraries over broad toolkits.
- Prefer code generation from existing contracts over hand-maintained duplicate types when practical.

## Storybook policy

Do not add Storybook by default.

Add it only if one of these becomes true:

- shared UI packages are becoming a standalone reusable system
- multiple contributors need an isolated component development surface
- it is explicitly requested
## Scene feedback and event mapping

If a change affects runtime events, employee states, task lifecycle, install lifecycle,
or office-scene choreography, also read `/Docs/04_runtime_experience/SCENE_STATE_MATRIX.md`.

Engineering rule:

- scene feedback must be driven by explicit runtime/domain events
- avoid hidden animation logic that invents business state on the client
- keep theatrical presentation data-driven and degradable under performance pressure

Use that matrix as the live reference for exact scene-state mapping.
