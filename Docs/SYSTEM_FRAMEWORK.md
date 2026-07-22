# System Framework

Checked at: 2026-07-22 NZST

This is the maintained system map for Offisim. It explains what runs where,
which layer owns each responsibility, and which files are the source of truth
when the implementation changes.

Engine wording below means **source implemented** unless a published
distribution is named. As of **2026-07-22**, `v1.1.2` is the latest stable
published release and its notarized, installed-distribution evidence includes
the post-`v1.1.1` Codex launch correction. Historical release `.app` evidence
keeps its original commit/hash; changes after the `v1.1.2` tag require new
current-worktree release `.app` evidence.

## Product Boundary

Offisim is a local-first desktop product with an optional registry backend.

- The desktop app is the product runtime.
- `DesktopAgentRuntimeGateway` is the only production engine entry. The Pi API
  engine plus Codex and Claude Code CLI orchestration adapters are implemented
  in current source.
- The platform API is registry/auth/install support, not the execution plane.
- The renderer is internal to the desktop app, not a standalone web product.

Do not restore a standalone launcher, standalone web runtime, partial provider
lane, raw model transport, or vendored runtime fork as a second production
path. Every engine and the dynamic Pi API model catalog belong behind the
single gateway defined by the current architecture decision.

## Runtime Layers

| Layer | Owner paths | Responsibility | Must not own |
|-------|-------------|----------------|--------------|
| Desktop renderer | `apps/desktop/renderer` | GUI shell, assistant-ui, 3D/2D work theater, AI Accounts/Models, Cost/Usage, Market, Personnel, Activity, Studio, Workspace | Raw credentials, native session files, canonical workspace authorization |
| Production gateway | `apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts`, neutral `agent_runtime_*` commands | Resolve one engine lane, its applicable API account/model/billing identity, and project neutral events | Mixing engines in one run or accepting renderer-asserted trust roots |
| Tauri shell | `apps/desktop/src-tauri` | Window lifecycle, local SQLite, command boundary, effective-workspace sandbox, shell/git/file safety, attachment store, MCP process bridge | Renderer-owned product state or unsealed credential projection |
| API adapter host | `scripts/tauri-pi-agent-host.entry.mjs`, `scripts/build-pi-agent-host.mjs`, `apps/desktop/src-tauri/src/pi_agent_host/` | Bundled API execution, tools, delegation, stream, provenance, and usage projection | Product identity or a parallel provider-settings surface |
| Codex orchestration host | `apps/desktop/src-tauri/src/codex_agent_host/` | Detect user CLI/login/version, spawn native app-server, project event stream, session/approval/Stop/recovery, task tokens/duration | Bundling Codex, choosing its model, or copying OAuth/session/global memory |
| Claude Code orchestration host | `scripts/tauri-claude-agent-host.entry.mjs`, `apps/desktop/src-tauri/src/claude_agent_host/` | Detect user Claude Code CLI/login/version, start print-mode `stream-json`, project reasoning/tool/file-operation events, Stop/recovery, task tokens/duration | Bundling Claude Code / Agent SDK, choosing its model, or copying OAuth/session/global memory |
| Local data contracts | `packages/db-local`, `packages/core/src/runtime/repositories.ts` | Company/project/conversation/activity/install/vault state and the current prelaunch schema baseline | Raw engine credentials or native Agent Home contents |
| Package/install contracts | `packages/asset-schema`, `packages/install-core`, `packages/registry-client`, `packages/shared-types` | Declarative package schema, install state machine, registry client validation, shared types | Install hooks, hidden postinstall execution |
| Prefab engine | `packages/prefab` | Office layout, prefab geometry/state, scene tokens shared by renderer surfaces | Product data ownership |
| Dramaturgy engine | `packages/dramaturgy` | Deterministic beats, staging, performance, modes, and ambient scheduling | Product projection ownership |
| Platform API | `apps/platform`, `packages/db-platform` | Auth, creator profiles, marketplace listing/search/review/publish/install support | Desktop execution, local shell/file access, native engine sessions |
| Doc engine | `packages/doc-engine` | Document parsing/render support and harness fixtures | Runtime chat loop |

## Main Flows

### Chat / AI Work

1. User writes in the desktop renderer.
2. Renderer persists the user turn into local thread state.
3. Renderer calls the runtime-neutral `agent_runtime_execute` gateway.
4. Tauri validates the backend-issued effective task workspace and starts the
   selected complete API, Codex, or Claude Code adapter.
5. The selected engine owns native model execution, session storage,
   compaction, tool loop, stream protocol, retries, and native auth.
6. Tauri forwards the engine's safe neutral event projection to the renderer.
7. Renderer projects those events into assistant-ui messages, run state,
   activity telemetry, and the office theater.

Source of truth:

- `Docs/HARNESS_ARCHITECTURE.md`
- `Docs/architecture/2026-07-13-engine-neutral-ai-accounts.md` (current decision)
- `Docs/architecture/2026-06-18-pi-agent-only-runtime.md` (superseded history)
- `apps/desktop/src-tauri/src/pi_agent_host/`
- `apps/desktop/src-tauri/src/codex_agent_host/`
- `apps/desktop/src-tauri/src/claude_agent_host/`
- `scripts/tauri-pi-agent-host.entry.mjs`
- `scripts/tauri-claude-agent-host.entry.mjs`
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
| Local SQLite | Tauri app data, schema in `packages/db-local/src/schema.sql` | Projects catalog, Offisim Conversations, runs, employees, events, safe account/model metadata, install state, vault metadata |
| Native Agent Home / Session / Memory | Engine-owned locations | Native auth, session, compaction, global memory; Offisim keeps only opaque refs and safe status |
| Platform Postgres | `packages/db-platform/src/schema.ts` + `packages/db-platform/schema.sql` | Typed schema plus the single fresh-volume baseline for users, creators, listings, versions, reviews, and install receipts |
| Effective task workspace | Backend-authorized canonical folder for one Turn | Actual task files and deliverables without silently rewriting the Projects catalog |

## Change Rules

- UI changes start from `Docs/UI_FRAMEWORK_STACK.md` and the relevant surface
  under `apps/desktop/renderer/src/surfaces`.
- Runtime changes start from `Docs/HARNESS_ARCHITECTURE.md` and
  `Docs/architecture/2026-07-13-engine-neutral-ai-accounts.md`. API, Codex, and
  Claude Code are source implemented. No run may mix engine lanes. Published
  `v1.1.2` has exact release-app/distribution evidence; later worktree changes
  require their own release `.app` verification before they are called shipped.
- Desktop command changes must preserve Rust-side workspace containment and run
  `cargo test --locked` in `apps/desktop/src-tauri`.
- Platform route changes must run platform migration/auth/security gates when
  they touch auth, database shape, or request boundaries.
- Documentation changes must update README routing if a new source of truth is
  introduced.

## Verification Map

| Change area | Minimum gates |
|-------------|---------------|
| Docs only | `pnpm check:docs-truth`, `git diff --check` |
| Renderer UI | `pnpm validate`, `pnpm lint`, `pnpm check:ui-hygiene`, desktop renderer build; release `.app` live verification when behavior changes |
| API adapter host | `pnpm harness:pi-agent-host`, `pnpm build:pi-agent-host`, desktop release build |
| Codex orchestration host | `pnpm harness:codex-app-server-contract`, desktop release build |
| Claude Code orchestration host | `pnpm harness:claude-agent-host`, desktop release build |
| Tauri/Rust | `cargo test --locked` in `apps/desktop/src-tauri`, desktop release build |
| Platform API | `pnpm security:harness`, `pnpm platform:migration:drift` when schema changes |
| Release-bound change | Full `Docs/00_start_here/RELEASE_GATES.md` core gates plus release `.app` evidence |
