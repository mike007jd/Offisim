# Feature Catalog

Checked at: 2026-07-17 NZST

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
- `packages/prefab`
- `packages/dramaturgy`
- `Docs/design/offisim-office-layout-v3-prototype.html`

Data/contracts:

- Active company/project/thread selection lives in renderer UI state and local
  repositories.
- Neutral engine events are projected into messages, run activity, and scene
  state. The dense HUD and Office dramaturgy remain product behavior, not
  decorative diagnostics.

Verification:

- `pnpm --filter @offisim/desktop-renderer build`
- release `.app` chat/workbench smoke when UI behavior changes
- `pnpm check:ui-hygiene`

## AI Runtime Engines

Purpose: execute real AI work through one engine lane per Turn.

Owner paths:

- `scripts/tauri-pi-agent-host.entry.mjs`
- `scripts/build-pi-agent-host.mjs`
- `scripts/harness-pi-agent-host.mjs`
- `apps/desktop/src-tauri/src/pi_agent_host/`
- `apps/desktop/src-tauri/src/codex_agent_host/`
- `apps/desktop/src-tauri/src/claude_agent_host/`
- `apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts`
- `Docs/HARNESS_ARCHITECTURE.md`

Data/contracts:

- The production gateway ships the Pi API engine plus Codex and Claude Code CLI
  orchestration adapters.
- Each engine owns its native auth/session/compaction/tool loop. Offisim owns
  safe account/model metadata, effective-workspace authorization, Conversation
  persistence, and neutral desktop projection.
- API accounts show token usage plus actual or clearly estimated Cost. External
  CLI orchestration records task tokens and duration as “订阅内 · 无 API 成本”;
  it has no Offisim account-usage projection.
- API models use the exact ids in Pi configuration. Source/checkedAt is strict
  for Offisim-owned official entries and optional for user-configured models;
  external CLIs own their model selection.

Verification:

- `pnpm harness:pi-agent-host`
- `pnpm harness:codex-app-server-contract`
- `pnpm harness:claude-agent-host`
- `pnpm harness:runtime-conformance`
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
- `apps/desktop/renderer/src/surfaces/office/WorkspacePanel.tsx`
- `packages/core/src/tools`

Data/contracts:

- Project reads/writes must stay inside the resolved workspace root.
- Attachment reads require matching company/thread scope.
- Shell and git output must be redacted before crossing into UI-visible logs.

Verification:

- `cargo test --locked`
- `pnpm harness:chat-attachment-roundtrip` when attachment flow changes
- release `.app` workspace panel checks when user flow changes

## Company channels

Company channels are the daily communication area in Office's right conversation
rail. Project conversations and company-scoped direct/group channels appear as
two explicit groups; there is no separate Connect app launcher. Meetings appear
in the Board company timeline, while Personnel owns the employee directory.

Company-channel data remains a separate company-scoped domain from Office's
per-project assistant threads. Collaboration lives in its own
`collaboration_threads` / `collaboration_thread_members` /
`collaboration_messages` / `collaboration_read_state` tables plus a
`collaboration_turns` reply ledger — never `chat_threads`, never an `agent_runs`
or Mission row, and never bound to a project. UI co-location does not merge the
two storage/runtime contracts.

Company-channel replies use isolated no-tools collaboration. API accounts route
through `agent_runtime_collaborate`; Codex accounts route through the native
one-shot host with the same exact-target and isolation rules. Neither path binds
a project cwd or writes `agent_runs`. Direct, mentions and roundtable behavior
is preserved.
`meeting_sessions` remains honest historical storage with no live writer; real
rows are projected into the Board timeline and never imply scheduling.

Owner paths:

- `apps/desktop/renderer/src/surfaces/office/rail/connect` (company-channel UI,
  renderer query/service glue and presentation)
- `apps/desktop/renderer/src/surfaces/office/board/activity-data.ts` (company
  timeline, including meeting rows)
- `apps/desktop/renderer/src/runtime/collaboration` (no-tools transport + turn
  controller)
- `packages/core/src/runtime/collaboration/collaboration-service.ts` (domain
  repository over the collaboration tables)
- API `agent_runtime_collaborate` and the isolated Codex one-shot host

Data/contracts:

- The collaboration aggregate is company-scoped and isolated from Office: no
  `project_id`, no Mission/run, no crossover into the `chatThreads` repository.
- Every collaboration engine path must stay tool-free and project-unbound; it
  must not masquerade as a work runtime.
- Calendar and Contacts are local views; they must not imply hosted execution.

Verification:

- `pnpm validate`
- `pnpm harness:collaboration-repo-contract`
- `pnpm harness:pi-collaboration-runtime`
- `pnpm harness:connect-chat-flow`
- release `.app` checks for user-visible state changes

## Loops

Loops are saveable, versioned, reusable work-loop definitions: a user describes a
repeatable process in natural language, Enhance sharpens it, a compiler profile
turns it into a generic Loop IR, the IR projects as a read-only nested graph, and
Save stores an immutable revision. Loops are authoring artifacts — they describe
how work should run, they do not run it. A Run (Mission) is created only when a
Loop is used at Office Send (PR-10). The nav label is "Loops"; the internal
route/surface key remains `mission` until the app-state schema is renamed.

Mission is the internal execution-compatibility engine, not a user-facing creation
model: the user no longer creates a Mission directly. A Loop revision compiles to
a generic `LoopIR` (business truth), and a `LoopExecutionPacket` adapter maps a
pinned revision onto the existing Mission engine only at send time. See
`Docs/architecture/2026-06-26-loop-domain-mission-adapter.md` and
`Docs/architecture/2026-06-26-loop-graph-react-flow-elk.md` (graph view).

Surface: Library (saved Loops) + a graph-centric NL editor (≤3 clarifying
questions, immutable versions, "Use in Office") + Runs (read-only persisted
execution records, including those created from Loop sends).

Owner paths:

- `apps/desktop/renderer/src/surfaces/mission/loops` (Library, NL editor, version
  panel, Runs, authoring machine)
- `apps/desktop/renderer/src/surfaces/mission/loops/graph` (`LoopGraphPanel`,
  read-only IR projection over `@xyflow/react` + `elkjs`)
- `packages/core/src/loops` (loop service, compiler profiles, validate,
  `mission-adapter.ts` → `LoopExecutionPacket`)
- `packages/core/src/loops/compiler-profiles/software-development` (first built-in
  profile, bundled from the fleet-development-loop assets)
- `packages/shared-types/src/loops/ir.ts` (generic `LoopIR` v1 contract)
- `apps/desktop/renderer/src/assistant/enhance` (versioned `loop_design` Enhance
  profile)

Data/contracts:

- Loop state lives in `loop_definitions` / `loop_revisions` (immutable) /
  `loop_skill_bindings` / `loop_invocations` in the current prelaunch schema
  baseline. Save creates a revision and never a Mission, thread, or run.
- `loop_revisions.compiled_ir_json` is the stored business truth; the graph is a
  pure read-only view and never written back.
- `loop_invocations` is written only at Office Send materialization (PR-10),
  which reuses the Office thread — no orphan thread or run.
- Compiler profiles are pure: same IR for the same input + profile version.

Verification:

- `pnpm validate`
- `pnpm harness:loop-compiler`
- `pnpm harness:loop-repository`
- `pnpm harness:loop-mission-adapter`
- `pnpm harness:loop-graph-projection`
- `pnpm harness:loop-office-invocation`
- `pnpm harness:loop-authoring-flow`
- `pnpm harness:prompt-enhance`
- release `.app` Loops authoring + Use-in-Office check when user flow changes

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
- Employee bindings choose either a Pi API account/model or an external CLI
  orchestration engine through the production gateway; they never create a
  parallel transport lane.

Verification:

- `pnpm validate`
- release `.app` Personnel surface check when tabs or persistence change

## Settings

Purpose: expose AI Accounts, Models, truthful Usage/Cost, local runtime policy,
MCP servers, and external employee setup.

Owner paths:

- `apps/desktop/renderer/src/surfaces/settings`
- `apps/desktop/src-tauri/src/pi_agent_host/`
- `apps/desktop/src-tauri/src/codex_agent_host/`
- `apps/desktop/src-tauri/src/mcp_bridge`
- `Docs/UI_FRAMEWORK_STACK.md`

Data/contracts:

- The API section edits Pi-managed provider/model/endpoint/API-key configuration
  and returns only safe summaries. The orchestration section exposes CLI
  install/login/version status and official guidance without copying raw auth or
  session files.
- API models are friendly-name-first records backed by configured exact ids;
  official provenance is strict while user-authored source metadata is optional.
- API runs show token usage and Cost; external CLI runs show task token count,
  duration, and “订阅内 · 无 API 成本”.
- MCP is a tool layer, not the main chat/runtime protocol.
- Settings must not expose auth-file paths, OAuth tokens, SDK lane badges, or
  runtime implementation names as the product model.

Verification:

- `pnpm harness:review-fixes`
- `pnpm harness:pi-agent-host`
- `pnpm harness:ai-account-configuration`
- `pnpm harness:ai-account-usage`
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
- `packages/prefab`
- `packages/dramaturgy`
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

- `apps/desktop/renderer/src/surfaces/office/board/activity-data.ts`
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
