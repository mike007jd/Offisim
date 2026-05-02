## Context

Offisim already has the visible product surface for project workspace binding, employee rosters, and runtime engine lanes, but the runtime contract is still split across stale state, partial adapters, and protocol ledgers. The result is a confusing product truth: the UI can show a bound workspace folder and an employee roster while the runtime still reports no workspace root or no employee database access; gateway lane can show real tool progress while SDK lane only emitted a placeholder.

The repository rules matter for this change:
- Truth comes from code and git log first, then CLAUDE.md, then OpenSpec, then docs.
- Workspace file/shell work must route through internal gateway tools and must be verified in the Tauri release `.app` when it touches desktop builtin tools or workspace roots.
- SDK lanes are text/reasoning-only for Offisim 1.0 and must not expose Offisim file, shell, memory, todo, skill, or MCP tools.
- Harness scenarios are for graph, runtime, permission, and replay invariants; they do not replace live product verification.
- Archive work must pass the three-way archive gate: specs, tasks, and protocol/document ledgers must agree before archiving.

## Goals / Non-Goals

**Goals:**
- Make the active project the single source of truth for desktop builtin tool workspace roots.
- Keep runtime context synchronized with active project and active company changes.
- Make Boss team-chat roster behavior match the employee list shown to the user.
- Preserve and spec-lock the current Boss defensive routing fixes already present in the working tree.
- Make SDK lane activity truthful by removing synthetic accepted-task rows and mapping trusted host tool lifecycle events only if a future legal sidecar emits them.
- Convert protocol drift into durable decision artifacts instead of repeating the same “should we migrate?” debate.
- Finish the remaining release `.app` verification and archive work for the three listed backend/runtime changes.
- Clean only the stale live-verify directory that belongs to an already archived change.

**Non-Goals:**
- No implementation during the propose step.
- No `close-frontend-ux-debt` work: chat attachments, contributor avatars, frontend archive cleanup, outcome formatter text, and frontend-specific MEMORY cleanup stay in that parallel change.
- No doubled-boss-bubble investigation or fix; `.live-verify/fix-doubled-boss-bubble/` stays untouched until there is a reproducible UI bug.
- No provider swap or key-change workaround for MiniMax auth failures; implementation must first check whether `.env.local` `MINIMAX_*` values are injected into `VITE_MINIMAX_*`.
- No migration from SSE MCP transport to Streamable HTTP in this change unless the decision doc discovers a blocker that makes current behavior unusable.

## Decisions

### D1 Decision: Active project pointer drives Rust builtin tool roots

`activateProject()` SHALL become the product-level state transition: after updating DB status, it emits a project-activated event and synchronizes runtime context `activeProjectId`. The desktop builtin tool layer SHALL resolve roots by that active project ID, either through explicit IPC context propagation or an active-project pointer owned by trusted desktop state. It SHALL NOT scan every project row and treat all historical `workspace_root` values as valid roots.

Alternative considered: keep all bound project roots readable so tool calls work even if active context is stale. Rejected because it turns a project switch into a widening sandbox and lets the previous project's root remain accessible after the user has moved context.

### D1 Decision: Path-escape defense becomes contract, not incidental code

The in-progress `tauri-skill-install-adapters.ts` defense against `..` path escape SHALL be captured as a requirement. Workspace-root binding is not only about finding the right folder; it also needs explicit protection against relative-path breakout from UI/skill install adapters.

Alternative considered: leave the adapter defense as implementation detail. Rejected because the same class of bug is exactly what the workspace sandbox is meant to prevent.

### D2 Decision: Runtime company context follows the active company

Boss prompt assembly SHALL read employees for the runtime context's active company, and that runtime `companyId` SHALL update whenever the UI/product state changes active company. This makes `repos.employees.findByCompany(runtimeCtx.companyId)` and the employee list use the same company boundary.

Alternative considered: have Boss directly query UI state or selected company from a component store. Rejected because core runtime must remain UI-independent and deterministic under harness replay.

### D2 Decision: Preserve the three defensive Boss fixes

The existing working-tree fixes are treated as part of the runtime contract:
- empty-roster diagnostic suppression is per `EventBus`, not a global set;
- skill mutation employee routing excludes `is_external === 1`;
- defensive override only rescues LLM `direct_reply` wrong-routes for skill mutation, not every Boss response.

Alternative considered: drop these as incidental cleanup and only fix `companyId`. Rejected because they close real cross-session, external-routing, and over-override failure modes adjacent to the roster bug.

### D3 Decision: SDK lane activity must be truthful, not simulated

Under the Offisim 1.0 boundary, Claude Agent SDK and Codex Agent SDK lanes are text/reasoning-only and cannot execute Offisim tools. The runtime SHALL NOT add file, shell, memory, todo, skill, or MCP tool exposure to those SDK sidecars only to manufacture activity parity. If a trusted host later emits legal tool lifecycle events, TypeScript adapters SHALL translate those events into the same runtime activity structure used by gateway lane.

Alternative considered: infer or fake SDK tool progress from accepted tasks or final text. Rejected because inferred progress is not reliable evidence and would imply tool execution that the product boundary forbids.

### D3 Decision: Remove the placeholder event

`tauri-engine-adapters.ts` SHALL stop yielding the placeholder “engine accepted the assigned task” event. The activity feed should show real stream, tool, completion, or error events, not a synthetic substitute.

Alternative considered: keep placeholder plus tool events. Rejected because it would double-count activity and keep a misleading success-looking row when no tool has started.

### D4 Decision: Protocol drift is resolved by decision files plus ledger sync

This change adds three durable protocol/document capabilities:
- `mcp-transport-decision` records current `@modelcontextprotocol/sdk` docs from Context7, migration cost to `StreamableHTTPClientTransport`, why this change does or does not migrate, and the trigger for migration.
- `langgraph-fork-tracking` records how `apps/web/src/lib/tauri-checkpoint.ts` differs from upstream SqliteSaver, how pnpm patches relate, and the quarterly upstream comparison checklist.
- `provider-lane-matrix` records provider × lane evidence, smoke script entry points, and which rows are verified, pending, or unsupported.

Alternative considered: only update `openspec/protocols-ledger.md`. Rejected because the ledger row is too compressed to carry migration evidence and will drift again without dedicated decision artifacts.

### D5 Decision: Old change archive is part of this runtime closure

`close-runtime-routing-and-workspace-debt` stays open only because release `.app` verification and memory cleanup are incomplete. This change SHALL finish tasks 13.1-13.4 and 14.3, write evidence into that change's `.live-verify/`, run the archive-gate checks, and archive it.

Alternative considered: leave archive cleanup to a separate housekeeping change. Rejected because the open tasks are the same workspace/runtime product surface and would keep the release truth ambiguous.

### D6 Decision: Two completed backend changes archive after gate checks

`2026-04-29-sandbox-honesty-and-kanban-cas` and `roadmap-debt-reconciliation` are already task-complete, but still require explicit archive-gate checks. This change SHALL archive them only after confirming specs, tasks, and ledger/docs still match code reality.

Alternative considered: archive them immediately based on task checkboxes. Rejected because repository policy requires the three-way check even when an agent previously marked a change archive-ready.

### D7 Decision: Cleanup is targeted

`.live-verify/runtime-context-and-tool-routing/` SHALL be deleted because its owning change is already archived. `.live-verify/fix-doubled-boss-bubble/` SHALL remain untouched because it belongs to a separate frontend reproduction path.

Alternative considered: clean every old `.live-verify` directory. Rejected because live evidence is part of audit history unless its owning change is confirmed archived and stale.

## Risks / Trade-offs

- [Risk] Active-project-only sandboxing may reveal callers that depended on old roots staying readable after a project switch. → Mitigation: fail closed, add `switch-project-rebinds-workspace-root`, and verify old-root access is blocked.
- [Risk] Runtime `companyId` updates could race with Boss prompt assembly during company switch. → Mitigation: context sync is part of the active-company transition, and harness covers multi-company non-leakage.
- [Risk] SDK tool parity cannot be proven while SDK lanes are text/reasoning-only. → Mitigation: keep the placeholder removed, keep future trusted event mapping narrow, and leave SDK tool parity tasks blocked rather than faking evidence.
- [Risk] Protocol decision docs can become stale if not tied to archive checks. → Mitigation: tasks include protocols-ledger sync and the change's own archive three-check gate.
- [Risk] Archive tasks may uncover stale specs outside the apparent D5/D6 scope. → Mitigation: fix only ledger/spec drift required to archive those changes; surface unrelated drift as open work rather than silently expanding scope.

## Migration Plan

1. Update specs and decision docs first so implementation follows the new runtime contract.
2. Implement D1-D2 runtime changes and D3 activity-honesty changes in the build order required by the repo: shared-types if event/types change, then ui-core only if needed, core, ui-office, web, desktop.
3. Add deterministic harness and record-replay scenarios before live verification; leave SDK tool parity replay blocked unless a legal SDK tool path exists.
4. Run serial build gates and harness gates.
5. Run Tauri release `.app` live verification for workspace file-tree and builtin tool behavior; browser/dev webview evidence is not acceptable for those tasks.
6. Complete D5 memory cleanup, D5 archive gate, and archive `close-runtime-routing-and-workspace-debt`.
7. Run archive gates and archive D6 changes.
8. Delete only `.live-verify/runtime-context-and-tool-routing/`.
9. Run this change's own archive preflight: specs, tasks, protocol ledger, provider-lane matrix, decision docs, and memory entries must all agree before archive.

Rollback is straightforward for runtime code before archive: revert the implementation commits and keep this proposal open. After archiving old changes, rollback requires restoring archived change directories only if their archive evidence is proven wrong.

## Open Questions

- None requiring PM sign-off in the proposal stage. Implementation must still record the MCP Context7 source snapshot date, exact live-verify evidence paths, and any provider smoke rows that remain pending because credentials or external services are unavailable.
