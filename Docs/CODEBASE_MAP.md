# Codebase Map

Checked at: 2026-06-18 NZST

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

## Script Families

| Script family | Purpose |
|---------------|---------|
| `scripts/release-gates.mjs` | Single source of truth for release gate command list |
| `scripts/run-clean-release.mjs` | Release evidence runner and desktop build entrypoint |
| `scripts/build-pi-agent-host.mjs` | Bundles official Pi Agent host and Node runtime into the desktop app |
| `scripts/harness-*.mjs` / `*.mts` | Targeted retained harnesses; use only current root `package.json` scripts as release evidence |
| `scripts/check-*.mjs` | Drift/hygiene checks for UI, platform/Tauri origin coupling, migrations, attachments |

## Documentation Ownership

| Document | Role |
|----------|------|
| `README.md` | Project overview and document router |
| `Docs/SYSTEM_FRAMEWORK.md` | Maintained architecture map |
| `Docs/FEATURES.md` | Maintained feature catalog |
| `Docs/CODEBASE_MAP.md` | Maintained package/code ownership map |
| `Docs/HARNESS_ARCHITECTURE.md` | Pi Agent Host runtime architecture |
| `Docs/architecture/2026-06-18-pi-agent-only-runtime.md` | Runtime boundary decision record |
| `Docs/00_start_here/LOCAL_DEVELOPMENT.md` | Local setup and dev entrypoints |
| `Docs/00_start_here/DEPLOYMENT.md` | Platform/desktop deployment notes |
| `Docs/00_start_here/RELEASE_GATES.md` | Release gates and evidence rules |
| `Docs/UI_FRAMEWORK_STACK.md` | Approved renderer UI framework stack |
| `Docs/design/` | Surface design prototypes and density notes |

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
3. Prefer deleting stale process notes over keeping them with warning banners.
4. Keep current source-of-truth docs short and linked from README.
