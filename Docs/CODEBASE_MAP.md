# Codebase Map

Checked at: 2026-07-16 NZST

This map is for maintainers deciding where a change belongs. Keep it aligned
with package ownership; do not use old audit or plan files as architecture
truth.

## Top-Level Applications

| Path | Purpose | Notes |
|------|---------|-------|
| `apps/desktop` | Tauri 2 desktop app, release bundle, Rust command boundary | Product runtime and final release target |
| `apps/desktop/renderer` | Internal Vite/React renderer for the Tauri WebView | Owns user-facing surfaces and design implementation |
| `apps/platform` | Hono platform API for registry/auth/publish/install support | Optional service, single-process deployment in 1.0 |

## Shared Packages

| Package | Purpose |
|---------|---------|
| `@offisim/asset-schema` | Package manifest schema and generated validator |
| `@offisim/core` | Local domain contracts, repositories, tools, install/audit/runtime support types |
| `@offisim/db-local` | Local SQLite schema and Drizzle definitions |
| `@offisim/db-platform` | Platform Postgres schema and Drizzle definitions |
| `@offisim/doc-engine` | Document parsing/render helpers and parser fixtures |
| `@offisim/install-core` | Local install state machine and materialization contracts |
| `@offisim/registry-client` | Registry client validation helpers |
| `@offisim/renderer` | Office scene/layout/prefab primitives |
| `@offisim/shared-types` | Cross-package shared types |

## Renderer Surfaces

User-visible terms differ from internal route/surface keys; keep them mapped.

| User-visible surface | Owner path | Internal key |
|----------------------|------------|--------------|
| Office (real AI work) | `apps/desktop/renderer/src/surfaces/office` | `office` |
| Office company channels | `apps/desktop/renderer/src/surfaces/office/rail/connect` | `office` rail |
| Loops (work-loop definitions) | `apps/desktop/renderer/src/surfaces/mission` | `mission` (legacy) |
| Personnel / Settings / Market / Studio / Activity | `apps/desktop/renderer/src/surfaces/<name>` | matches name |

Company-channel collaboration and Loops remain isolated from project chat/runtime:

| Concern | Where it lives |
|---------|----------------|
| Company-channel renderer glue | `apps/desktop/renderer/src/surfaces/office/rail/connect/collaboration-data.ts` |
| Connect no-tools runtime + turn controller | `apps/desktop/renderer/src/runtime/collaboration` |
| Connect domain repository | `packages/core/src/runtime/collaboration/collaboration-service.ts` |
| Connect no-tools host capabilities | API `agent_runtime_collaborate` plus the isolated native Codex/Claude one-shot hosts |
| Loops editor / library / graph | `apps/desktop/renderer/src/surfaces/mission/loops` (graph in `loops/graph`, `LoopGraphPanel.tsx`) |
| Loops domain (service, profiles, IR adapter) | `packages/core/src/loops` (+ `packages/shared-types/src/loops/ir.ts`) |
| Versioned Prompt Enhance | `apps/desktop/renderer/src/assistant/enhance` |

## Script Families

| Script family | Purpose |
|---------------|---------|
| `scripts/release-gates.mjs` | Single source of truth for release gate command list |
| `scripts/run-clean-release.mjs` | Release evidence runner and desktop build entrypoint |
| `scripts/build-pi-agent-host.mjs` | Bundles official Pi Agent host and Node runtime into the desktop app |
| `scripts/prepare-codex-app-server.mjs` / `scripts/check-codex-app-server-artifact.mjs` | Prepare and verify the pinned native Codex sidecar artifact |
| `scripts/build-claude-agent-host.mjs` / `scripts/claude-workspace-guard.mjs` | Bundle the official Claude SDK host and enforce Project-folder tool boundaries |
| `scripts/harness-*.mjs` / `*.mts` | Targeted retained harnesses; use only current root `package.json` scripts as release evidence |
| `scripts/check-*.mjs` | Drift/hygiene checks for UI, platform/Tauri origin coupling, migrations, attachments |
| `scripts/harness-collaboration-repo-contract.mts`, `scripts/harness-pi-collaboration-runtime.mts`, `scripts/harness-connect-chat-flow.mts` | Connect/collaboration domain, no-tools runtime, and chat-flow harnesses |
| `scripts/harness-loop-*.mts`, `scripts/harness-prompt-enhance.mts` | Loop compiler/repository/mission-adapter/graph-projection/office-invocation/authoring + versioned Enhance harnesses |

## Local SQLite Baseline

Local schema version: the `LOCAL_SCHEMA_VERSION` constant in
`apps/desktop/src-tauri/src/local_db.rs` is the single truth source (docs do
not restate the number). Fresh databases apply the current
baseline `packages/db-local/src/schema.sql` directly and are stamped by
`apps/desktop/src-tauri/src/local_db.rs`.

`packages/db-local/src/migrations/` intentionally contains no historical
migration SQL. Offisim is prelaunch, so old local/dev databases with another
version, or tables without a `PRAGMA user_version` stamp, are disposable and
should be deleted/rebuilt from the current baseline.

## Documentation Ownership

| Document | Role |
|----------|------|
| `README.md` | Project overview and document router |
| `Docs/SYSTEM_FRAMEWORK.md` | Maintained architecture map |
| `Docs/FEATURES.md` | Maintained feature catalog |
| `Docs/CODEBASE_MAP.md` | Maintained package/code ownership map |
| `Docs/HARNESS_ARCHITECTURE.md` | Production gateway, engine hosts, and runtime gates |
| `Docs/architecture/2026-07-13-engine-neutral-ai-accounts.md` | Current engine/account/session/workspace decision |
| `Docs/document-truth-ledger.md` | Current, retained, superseded, and deletion decisions for documentation |
| `Docs/architecture/2026-06-18-pi-agent-only-runtime.md` | Superseded Pi-only implementation history |
| `Docs/architecture/2026-06-26-collaboration-domain-boundary.md` | Connect collaboration domain + no-tools runtime ADR |
| `Docs/architecture/2026-06-26-loop-domain-mission-adapter.md` | Loop IR / immutable revisions / Mission send-time adapter ADR |
| `Docs/architecture/2026-06-26-enhance-profile-contract.md` | Versioned Prompt Enhance profile contract ADR |
| `Docs/architecture/2026-06-26-loop-graph-react-flow-elk.md` | Loop nested-graph view (React Flow + ELK) ADR |
| `Docs/00_start_here/LOCAL_DEVELOPMENT.md` | Local setup and dev entrypoints |
| `Docs/00_start_here/DEPLOYMENT.md` | Platform/desktop deployment notes |
| `Docs/00_start_here/RELEASE_GATES.md` | Release gates and evidence rules |
| `Docs/UI_FRAMEWORK_STACK.md` | Approved renderer UI framework stack |
| `Docs/design/.v3-dna-brief.md` + `offisim-office-layout-v3-prototype.html` | Current V3 design language and canonical specimen |
| Other `Docs/design/*-prototype.html` files | Historical/reference specimens only when their visible superseded banner says so |

## Files That Look Disposable But Are Not

- `packages/doc-engine/harness/fixtures/*.pdf` and `*.png` are parser fixtures.
- `apps/desktop/src-tauri/icons/*.png` are app bundle icons.
- `.github/` templates and workflows are release/project governance.
- `.claude/skills/gitnexus/*` are project skill instructions generated for
  code intelligence and may be refreshed by GitNexus.
- `.gitnexus/` is ignored local index state; keep it locally when using
  GitNexus, but never commit it.

## Disposable Local Artifacts

These are safe to remove when cleaning a workspace:

- `.playwright-mcp/`
- `.playwright-cli/`
- `feedbacks/`
- `output/`
- `.turbo/`
- `.DS_Store`
- `*.log`

Do not delete `node_modules/`, `apps/desktop/src-tauri/target/`, or `.gitnexus/`
as part of ordinary documentation cleanup; they are ignored local build/tooling
state and may be needed for verification.

## Cleanup Rule

Before deleting a tracked document or source file:

1. Check tracked references with `rg`.
2. Confirm the file is not listed in `README.md`, `Docs/*`, release scripts, CI,
   or package exports.
3. Delete only when a skeptic pass proves no unique decision, contract, or
   evidence value; otherwise add a visible historical/superseded banner and a
   current replacement link.
4. Record the disposition in `Docs/document-truth-ledger.md` and keep current
   source-of-truth docs short and linked from README.
