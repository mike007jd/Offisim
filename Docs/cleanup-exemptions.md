# Cleanup Exemptions

Checked at: 2026-07-21 NZST.

This file records dead-code/dead-doc candidates that were reviewed and should not
be re-opened as deletion targets without new evidence.

## Dead Code Tool Hints

| Candidate | Decision | Evidence |
|---|---|---|
| `.gitnexus/run.cjs` in `knip.json` | Keep | GitNexus project rules in `AGENTS.md` / `CLAUDE.md` point humans to this runner when the index needs refresh. Knip reports only a configuration hint because the file is ignored by the source graph and may be absent in some worktrees. |
| `PI_WIRE_CONTRACT_EXAMPLES` binding | Converted, not deleted | The export was dead, but the examples are still valuable as a renderer-side `satisfies PiAgentHostEvent` compile guard. It is now a no-binding typecheck expression so `tsc` keeps the guard and `knip` no longer sees an exported API. |
| `MOTION_DURATION` / `MOTION_EASE` knip unused exports | Keep | Required by `scripts/harness-motion-tokens.mjs` and `check-ui-framework-hygiene.mjs` `requiredChecks`. They are the token-mirror contract for `motionPresets` / `motion.css`, not dead symbols. |
| `knip.json` `ignoreBinaries: security` | Removed 2026-07-21 | Stale config hint; release-publish invokes `/usr/bin/security` by absolute path, so knip never saw a bare `security` binary. |

## Public/Internal Export Cleanup

The 2026-06-29 cleanup removed only unused export surfaces or truly unreferenced
fixtures after monorepo, docs, scripts, dynamic-string, and GitNexus checks.
Remaining package `exports` in `packages/*/package.json` are treated as public
API until a separate downstream review proves otherwise.

## 2026-07-01 Hygiene Pass

| Candidate | Decision | Evidence |
|---|---|---|
| Tauri command names, permission allowlists, and renderer `invoke(commandName)` paths | Keep | These are runtime string contracts rather than import graph edges; deleting by grep would miss registered commands and permission entries. |
| `apps/desktop/src-tauri/resources/**` and engine host bundles | Keep | Generated API host resources (`pi-agent-host.mjs` and related) are bundled by Tauri release config and verified by engine-specific harnesses. Codex/Claude orchestration uses user-installed CLIs on PATH — not a pinned Codex sidecar binary. `knip.json` intentionally ignores generated release artifacts. |
| DB schema baseline | Keep | `local_db.rs` uses `include_str!` for `schema.sql`; historical local migration SQL was removed after confirming Offisim has no launched user-data upgrade contract. |
| `packages/prefab` | Keep | It is pure shared prefab logic used by desktop renderer and platform, not a standalone web product or shared visual UI package. |
| `packages/dramaturgy` | Keep | It owns deterministic Office projection logic outside the shared type contracts. |
| Historical second-runtime scorecard and inert-storage ledger | Archive/keep | The scorecard is historical NO-GO evidence and was moved out of the active architecture path. Inert SQLite tables remain documented until a deliberate baseline cleanup removes or rewires them. |

## 2026-07-21 Dead Code / Docs Cleanup Loop

| Candidate | Decision | Evidence |
|---|---|---|
| Connect Calendar/Meetings CSS (`.off-ws-cal*`, `.off-ws-evt*`, `.off-ws-meet*`, `.off-ws-attendee*`) | Quarantined | Zero TSX mounts after `CalendarApp` removal; gate-unprovable → `Docs/_quarantine/dead-code-2026-07-21/`. |
| `MemoryService` / `MemoryUpdateQueueService` / `DeliverablePersistenceService` / `mapDeliverablePayloadToRow` / `SummarizationMiddleware` / `NodeContextMiddleware` / `AgentContextPackService` / `recordedLlmCall*` / `RecordedSystemLlmCaller` | Keep (stop — PUBLIC_API) | Zero live `new` from desktop/platform, but exported from `@offisim/core` (`./`, `./services`, `./browser`, `./middleware`). Loop forbids silent PUBLIC_API deletion; needs explicit authorization + ledger-aligned baseline plan. Note: `memory_entries` / `deliverables` tables have **other** live writers — do not conflate with these services. |
| `LibraryDocumentRepository` / `library_documents` | Keep (stop — PUBLIC_API + schema) | FULLY-INERT behaviorally; still on `@offisim/core` export surface + `RuntimeRepositories` + baseline schema. Gate cannot prove safe table drop. |
| `MeetingSessionRepository.create` / `meetings.create` | Keep writer dead; KEEP table | Writer has zero callers; Board `activity-data.ts` still SELECTs `meeting_sessions`. Ledger FULLY-INERT label conflicts with live reader — fix ledger before any table drop. |
| `deep-link-install` Rust emit without TS listener | Keep (implementation closed; release-live pending) | Source implementation closed 2026-07-21: retained OS `offisim://install` contract; cold-start queue handshake (`DeepLinkState` queues until the renderer listens, then `deep_link_mark_renderer_ready` drains once); Market resolves the exact current `listing_id` + version and stops at package detail; only a separate user click on **Install** may download or materialize. Locked by `pnpm harness:deep-link-install`. **Release-live pending:** macOS `/Applications` bundled-app OS-level cold-start and running-app deep-link verification still requires separate authorization and must not be claimed from harness-only evidence. |
| `ConversationBudgetService` | Keep | Harness `harness-staged-compaction.mts` instantiates it; not production-wired but gate-reachable. |
| `dev-lab` / `character-lab.html` | Keep | Intentional knip entry / dev-only character lab; not release `.app` path. |
| Vite `polyfills/*`, Tauri event/command string contracts, sidecar resource paths | Keep | Non-static life; SECURITY_KEEPLIST adjacent. |
| Superseded ADRs (`2026-06-18-pi-agent-only-runtime`, `2026-06-25-pi-0.80-compat-spike`, `DELEGATION_ARCHITECTURE`, `codex-functional-test-loop`) | Keep paths | `check-docs-truth.mjs` SUPERSEDE graph requires stable paths; decision history retained. Do not move without updating the truth gate. |
| `pnpm qa:loop` / `run-functional-test-loop.mjs` | Keep script; do not treat as release gate | Superseded methodology; not in `pnpm validate` / `release-gates.mjs`. |
| Contacts/Approvals/Workplace orphan CSS in `connect.css` (`.off-ws-ct-*`, `.off-ws-oa-*`, `.off-ws-wp-*`) | Deferred | Same class of residue as Calendar; not dual-skeptic'd this pass — next round. |
