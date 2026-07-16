# System Framework

Checked at: 2026-07-13 AEST

This is the maintained system map for Offisim. It explains what runs where,
which layer owns each responsibility, and which files are the source of truth
when the implementation changes.

## Product Boundary

Offisim is a local-first desktop product with an optional registry backend.

- The desktop app is the product runtime.
- Pi Agent is the current bundled engine implementation behind the production
  `DesktopAgentRuntime` gateway.
- The platform API is registry/auth/install support, not the execution plane.
- The renderer is internal to the desktop app, not a standalone web product.

Do not restore a standalone launcher, standalone web runtime, parallel provider
execution plane, ad-hoc Claude/Codex sidecar lane, OpenAI Agents lane, or
vendored Pi fork as the main runtime path. Engine-neutral Accounts and the exact
model catalog belong behind the single production gateway defined by the
current architecture target.

## Runtime Layers

| Layer | Owner paths | Responsibility | Must not own |
|-------|-------------|----------------|--------------|
| Desktop renderer | `apps/desktop/renderer` | GUI shell, assistant-ui chat surface, 3D/2D office theater, Settings, Market, Personnel, Activity, Studio, Workspace apps | Provider SDK transports, model catalog freshness, local filesystem reads outside Tauri commands |
| Tauri shell | `apps/desktop/src-tauri` | Window lifecycle, local SQLite setup, command boundary, workspace sandbox, shell/git/file safety, attachment store, MCP process bridge | AI model/provider logic |
| Pi Agent host | `scripts/tauri-pi-agent-host.entry.mjs`, `apps/desktop/src-tauri/src/pi_agent_host/` | Runs bundled `@earendil-works/pi-coding-agent`, forwards JSONL events, exposes status, binds cwd/session/config paths | Offisim-specific business persistence or UI state |
| Local data contracts | `packages/db-local`, `packages/core/src/runtime/repositories.ts` | Company/project/thread/activity/install/vault state and local schema migrations | Provider credentials |
| Package/install contracts | `packages/asset-schema`, `packages/install-core`, `packages/registry-client`, `packages/shared-types` | Declarative package schema, install state machine, registry client validation, shared types | Install hooks, hidden postinstall execution |
| Scene engine | `packages/renderer` | Office layout, prefab geometry/state, scene tokens shared by renderer surfaces | Product data ownership |
| Platform API | `apps/platform`, `packages/db-platform` | Auth, creator profiles, marketplace listing/search/review/publish/install support | Desktop execution, local shell/file access, Pi sessions |
| Doc engine | `packages/doc-engine` | Document parsing/render support and harness fixtures | Runtime chat loop |

## Main Flows

### Chat / AI Work

1. User writes in the desktop renderer.
2. Renderer persists the user turn into local thread state.
3. Renderer calls the runtime-neutral `agent_runtime_execute` gateway.
4. Tauri resolves the selected project workspace as cwd and starts the bundled
   Pi Agent host.
5. Pi Agent owns model selection, session storage, compaction, tool loop,
   stream protocol, retries, and provider auth.
6. Tauri forwards Pi JSONL events to the renderer.
7. Renderer projects those events into assistant-ui messages, run state,
   activity telemetry, and the office theater.

Source of truth:

- `Docs/HARNESS_ARCHITECTURE.md`
- `Docs/architecture/2026-07-13-engine-neutral-ai-accounts.md` (current target)
- `Docs/architecture/2026-06-18-pi-agent-only-runtime.md` (historical/current Pi implementation)
- `apps/desktop/src-tauri/src/pi_agent_host/`
- `scripts/tauri-pi-agent-host.entry.mjs`
- `apps/desktop/renderer/src/assistant/runtime/desktop-chat-runtime.ts`

### Workspace / File / Shell Tools

Project file reads, writes, shell, and git access go through Tauri commands and
Rust-side guards. The renderer must not directly read project folders with a
browser filesystem plugin.

Source of truth:

- `apps/desktop/src-tauri/src/builtin_tools.rs`
- `apps/desktop/src-tauri/src/git.rs`
- `apps/desktop/src-tauri/src/local_paths.rs`
- `apps/desktop/src-tauri/src/shell_classifier.rs`
- `packages/core/src/tools`

### Marketplace / Install

Marketplace browsing and publishing are platform concerns. Local installation
materialization is desktop/local-runtime work. 1.0 install support is complete
for skill and employee packages; company templates, office layout packs, and
prefab packs remain preview-only.

Source of truth:

- `README.md` marketplace scope
- `packages/asset-schema/src/schema/manifest-1.0.0.json`
- `packages/install-core/src/state-machine.ts`
- `apps/platform/src/routes/market.ts`
- `apps/platform/src/routes/publish.ts`
- `apps/platform/src/routes/install.ts`

### Platform Deployment

The platform is a single Node process in 1.0. Horizontal scaling requires a
shared rate-limit store before deployment topology changes.

Source of truth:

- `Docs/00_start_here/DEPLOYMENT.md`
- `Docs/platform-deployment-gates.md`
- `apps/platform/src/app.ts`
- `apps/platform/src/startup.ts`
- `apps/platform/src/middleware/rate-limit.ts`

## Persistence

| Store | Location | Purpose |
|-------|----------|---------|
| Local SQLite | Tauri app data, schema in `packages/db-local/src/schema.sql` | Companies, projects, threads, employees, events, install state, vault metadata |
| Pi Agent files | `~/.pi/agent/` by default | Provider auth, model registry, Pi sessions |
| Platform Postgres | `packages/db-platform/src/schema.ts` | Users, creators, listings, versions, reviews, install receipts |
| Workspace folders | User-selected project roots and Offisim-managed company workspaces | Actual project files and deliverables |

## Change Rules

- UI changes start from `Docs/UI_FRAMEWORK_STACK.md` and the relevant surface
  under `apps/desktop/renderer/src/surfaces`.
- Runtime changes start from `Docs/HARNESS_ARCHITECTURE.md` and
  `Docs/architecture/2026-07-13-engine-neutral-ai-accounts.md`. The current Pi
  adapter remains the only shipped engine until another complete adapter passes
  conformance and release `.app` verification; no run may mix engine lanes.
- Desktop command changes must preserve Rust-side workspace containment and run
  `cargo test --locked` in `apps/desktop/src-tauri`.
- Platform route changes must run platform migration/auth/security gates when
  they touch auth, database shape, or request boundaries.
- Documentation changes must update README routing if a new source of truth is
  introduced.

## Verification Map

| Change area | Minimum gates |
|-------------|---------------|
| Docs only | `git diff --check`, relevant grep/reference checks |
| Renderer UI | `pnpm validate`, `pnpm lint`, `pnpm check:ui-hygiene`, desktop renderer build; release `.app` live verification when behavior changes |
| Pi Agent host | `pnpm harness:pi-agent-host`, `pnpm build:pi-agent-host`, desktop release build |
| Tauri/Rust | `cargo test --locked` in `apps/desktop/src-tauri`, desktop release build |
| Platform API | `pnpm security:harness`, `pnpm platform:migration:drift` when schema changes |
| Release-bound change | Full `Docs/00_start_here/RELEASE_GATES.md` core gates plus release `.app` evidence |
