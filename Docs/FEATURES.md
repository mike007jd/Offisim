# Feature Catalog

Checked at: 2026-06-18 NZST

This catalog documents the product features that are currently expected to be
maintained for Offisim 1.0. Each feature entry names the user value, owner
paths, persistence/contracts, and verification.

## Company Lifecycle

Purpose: create, choose, rename, archive, and delete local AI companies.

Owner paths:

- `apps/desktop/renderer/src/surfaces/lifecycle`
- `apps/desktop/renderer/src/app/ui-state.ts`
- `packages/db-local/src/schema.sql`
- `apps/desktop/src-tauri/src/local_paths.rs`

Data/contracts:

- Company, employee, project, zone, layout, prefab, thread, run history, and
  workspace cleanup are local data concerns.
- Deleting a company must not silently delete arbitrary user project roots.

Verification:

- release `.app` company create/delete flow
- local SQLite count checks when deep delete changes
- `cargo test --locked` for workspace/path deletion guards

## Office Workbench

Purpose: the primary desktop working view: chat rail, team dock, project panel,
2D/3D office theater, and run state visualization.

Owner paths:

- `apps/desktop/renderer/src/surfaces/office`
- `apps/desktop/renderer/src/assistant/runtime`
- `packages/renderer`
- `Docs/design/offisim-office-layout-v3-prototype.html`

Data/contracts:

- Active company/project/thread selection lives in renderer UI state and local
  repositories.
- Pi events are projected into messages, run activity, and scene state.

Verification:

- `pnpm --filter @offisim/desktop-renderer build`
- release `.app` chat/workbench smoke when UI behavior changes
- `pnpm check:ui-hygiene`

## Pi Agent Runtime

Purpose: execute real AI work through the bundled official Pi Agent runtime.

Owner paths:

- `scripts/tauri-pi-agent-host.entry.mjs`
- `scripts/build-pi-agent-host.mjs`
- `scripts/harness-pi-agent-host.mjs`
- `apps/desktop/src-tauri/src/pi_agent_host.rs`
- `Docs/HARNESS_ARCHITECTURE.md`

Data/contracts:

- Pi owns provider auth, model registry, sessions, compaction, tool loop,
  streaming protocol, retries, and provider errors.
- Offisim owns cwd binding, desktop event projection, and product persistence.
- Settings may show Pi status and a single advanced model override; it must not
  restore an Offisim provider/model catalog.

Verification:

- `pnpm harness:pi-agent-host`
- `pnpm build:pi-agent-host`
- release `.app` launch from exact worktree path

## Workspace Files, Shell, Git, and Attachments

Purpose: let local AI work inspect and mutate project files with a hardened
desktop boundary.

Owner paths:

- `apps/desktop/src-tauri/src/builtin_tools.rs`
- `apps/desktop/src-tauri/src/git.rs`
- `apps/desktop/src-tauri/src/shell_classifier.rs`
- `apps/desktop/src-tauri/src/attachment_store.rs`
- `apps/desktop/renderer/src/surfaces/workspace`
- `packages/core/src/tools`

Data/contracts:

- Project reads/writes must stay inside the resolved workspace root.
- Attachment reads require matching company/thread scope.
- Shell and git output must be redacted before crossing into UI-visible logs.

Verification:

- `cargo test --locked`
- `pnpm harness:chat-attachment-roundtrip` when attachment flow changes
- release `.app` workspace panel checks when user flow changes

## Workspace Apps

Purpose: provide focused operational views around a company workspace:
Messenger, Calendar, Contacts, Workplace, and Assistant Thread. Calendar is
honest-empty in 1.0 — `meeting_sessions` is inert with no live writer (see
`Docs/contracts/inert-storage-ledger.md`); it must not imply scheduled execution.

Owner paths:

- `apps/desktop/renderer/src/surfaces/workspace`
- `apps/desktop/renderer/src/surfaces/activity`
- local repositories exposed through `apps/desktop/renderer/src/data`

Data/contracts:

- Activity and approvals mirror local runtime events via `agent_events` (Pi tool
  activity surfaces there) and interaction requests via `interaction_history`. The
  legacy `tool_calls` / `mcp_audit_log` tables are inert and are not the source.
- Calendar and Contacts are local views; they must not imply hosted execution.

Verification:

- `pnpm validate`
- release `.app` checks for user-visible state changes

## Personnel

Purpose: manage internal/external employee presentation, profile, runtime
policy, skills, memory, appearance, and history.

Owner paths:

- `apps/desktop/renderer/src/surfaces/personnel`
- `packages/core/src/runtime/repositories.ts`
- `packages/core/src/skills`
- `packages/core/src/services/memory-service.ts`

Data/contracts:

- Employees shape context, roster, presentation, skills, and memory.
- They do not create separate model lanes; AI runtime remains Pi Agent.

Verification:

- `pnpm validate`
- release `.app` Personnel surface check when tabs or persistence change

## Settings

Purpose: expose local runtime policy, Pi Agent status/config, MCP servers, and
external employee setup.

Owner paths:

- `apps/desktop/renderer/src/surfaces/settings`
- `apps/desktop/src-tauri/src/pi_agent_host.rs`
- `apps/desktop/src-tauri/src/mcp_bridge`
- `Docs/UI_FRAMEWORK_STACK.md`

Data/contracts:

- Pi auth/model/session status comes from Pi-owned config paths.
- MCP is a tool layer, not the main chat/runtime protocol.
- Settings must not expose old provider catalog, provider freshness, or SDK
  lane mental models.

Verification:

- `pnpm harness:review-fixes`
- `pnpm harness:pi-agent-host`
- `pnpm check:ui-hygiene`

## Market

Purpose: browse, preview, publish, review, and install supported marketplace
assets.

Owner paths:

- `apps/desktop/renderer/src/surfaces/market`
- `packages/asset-schema`
- `packages/install-core`
- `packages/registry-client`
- `apps/platform/src/routes/market.ts`
- `apps/platform/src/routes/publish.ts`
- `apps/platform/src/routes/install.ts`

Data/contracts:

- Skill and employee packages have install support in 1.0.
- Company templates, office layout packs, and prefab packs are preview-only.
- Package manifests are declarative; install hooks and hidden scripts are not
  allowed.

Verification:

- `pnpm security:harness`
- `pnpm platform:migration:drift` when platform schema changes
- install-core or registry-client targeted harnesses when install contracts move

## Studio

Purpose: edit and inspect office layout/prefab placement with collision and zone
rules.

Owner paths:

- `apps/desktop/renderer/src/surfaces/studio`
- `packages/renderer`
- `scripts/harness-studio-placement.mjs`

Data/contracts:

- Placement and collision rules are deterministic and shared with the scene
  layer.
- Studio is not a separate product or game editor; it exists to maintain
  Offisim office layout state.

Verification:

- `pnpm harness:studio-placement`
- `pnpm check:ui-hygiene`

## Activity and Approvals

Purpose: make tool calls, failures, approvals, and runtime events auditable and
recoverable.

Owner paths:

- `apps/desktop/renderer/src/surfaces/activity`
- `apps/desktop/renderer/src/assistant/parts/PermissionApprovalBar.tsx`
- `packages/core/src/mcp`
- `apps/desktop/src-tauri/src/redaction.rs`

Data/contracts:

- Sensitive output is redacted before display.
- Approvals must be visible and actionable; failure summaries should not hide
  behind raw payloads.

Verification:

- `pnpm security:harness`
- `cargo test --locked`
- release `.app` live check for approval UX changes

## Platform / Registry Backend

Purpose: support hosted auth, marketplace search/detail, creator registration,
publish workflow, reviews, install receipts, and library views.

Owner paths:

- `apps/platform/src/app.ts`
- `apps/platform/src/routes`
- `apps/platform/src/middleware`
- `packages/db-platform/src/schema.ts`
- `Docs/00_start_here/DEPLOYMENT.md`

Data/contracts:

- Hono app uses secure headers, CORS, request id, general/auth/publish/install
  rate limits, optional auth, and route-level ownership checks.
- 1.0 assumes a single Node process; multi-replica deployment requires a shared
  rate-limit store first.

Verification:

- `pnpm security:harness`
- `pnpm platform:migration:drift` when schema changes
- deployment review against `Docs/platform-deployment-gates.md`

## Document Engine

Purpose: parse and validate user/package document assets.

Owner paths:

- `packages/doc-engine`
- `scripts/harness-doc-engine-parsers.mjs`

Data/contracts:

- Parser fixtures under `packages/doc-engine/harness/fixtures` are intentional
  test assets, even when they look like screenshots or sample PDFs.

Verification:

- `pnpm harness:doc-engine`
- `pnpm security:harness` for CSV/doc security coverage
