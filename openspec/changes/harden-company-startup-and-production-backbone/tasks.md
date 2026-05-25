## 1. Contract and Harness Setup

- [x] 1.1 Add shared runtime event payload types for `company.startup.requested`, `company.startup.started`, `company.startup.completed`, `company.startup.skipped`, and `company.startup.failed`.
- [x] 1.2 Add shared employee performance state types and reducer contracts for startup, drag/drop, and settle lifecycles.
- [x] 1.3 Add deterministic harness scenarios proving providerless startup emits no graph, task, tool, LLM stream, employee work, or deliverable events.
- [x] 1.4 Add deterministic harness scenarios for typed SOP run identity, natural artifact intent, null-workspace project creation, and bundle materialization rollback.

## 2. Company Startup Backbone

- [x] 2.1 Add per-company persisted startup ceremony state with requested/completed/skipped/failed/replay fields.
- [x] 2.2 Emit startup lifecycle request after successful template materialization.
- [x] 2.3 Emit startup lifecycle request after successful custom company creation, even when the company has no employees or SOPs.
- [x] 2.4 Ensure startup lifecycle does not write `first_task_sent`, `first_deliverable_seen`, task plan, deliverable, employee work-state, or graph-thread execution state.
- [x] 2.5 Add explicit replay support that marks startup lifecycle payloads as replay without resetting provider/readiness/work flags.

## 3. Providerless Truth Boundary

- [x] 3.1 Keep repos-only runtime able to create, switch, edit, and inspect companies without provider credentials.
- [x] 3.2 Fail real work attempts without provider through the existing typed runtime-not-ready path, not through fake demo execution.
- [x] 3.3 Add guards preventing no-provider startup/guide state from creating graph runs, task progress, canned model output, or demo deliverables.

## 4. Scene and Performance Backbone

- [x] 4.1 Patch ceremony phase derivation so `graph.node.entered` with `nodeName='pm_planner'` enters planning phase.
- [x] 4.2 Add startup lifecycle handling to scene orchestration as a non-work ceremony domain separate from active plan state.
- [x] 4.3 Add employee performance state bridge for greet/enter/sit/celebrate/settle startup states.
- [x] 4.4 Add employee drag/drop performance lifecycle for held/carried/drop-valid/drop-invalid/drop-accepted/drop-rejected/cancel/settle.
- [x] 4.5 Ensure performance state cleanup does not mutate ceremony phase or AI execution state.

## 5. SOP Run Identity

- [x] 5.1 Extend the runtime send-message/run-scope contract to carry `sopTemplateId` and a stable SOP definition/version snapshot reference.
- [x] 5.2 Update SOP Run invocation to pass typed SOP metadata while preserving chat-facing text as display/context only.
- [x] 5.3 Update Boss/PM planner SOP resolution to prefer typed SOP metadata over free-text name parsing.
- [x] 5.4 Add duplicate-name coverage proving the selected SOP id is used even when names collide.

## 6. Durable Artifact Intent

- [x] 6.1 Extend deliverable intent detection for natural production outputs: report, plan, brief, proposal, PRD, job description, deck, checklist, analysis, table, CSV, HTML page, and document.
- [x] 6.2 Preserve read-only/local-file operation priority so analysis/inspection of existing files does not force new deliverables.
- [x] 6.3 Attach deliverables to messages/output surfaces by explicit `taskRunId` / `runId` / run-scope identity before timestamp fallback.
- [x] 6.4 Update fixed starter/task prompt text only where needed to express real artifact intent without hidden UI-only behavior.

## 7. Project Creation Backbone

- [x] 7.1 Remove any create-flow validation that requires `workspace_root` in desktop mode.
- [x] 7.2 Ensure `ProjectService.createProject` and all repository backends persist `workspace_root = null` and still create the dedicated thread/lifecycle.
- [x] 7.3 Ensure workspace-dependent file/tool paths fail with typed workspace-binding-unavailable when the active project has no folder.
- [x] 7.4 Add regression coverage for pure text work under a null-workspace project when provider/runtime readiness is available.

## 8. Asset Materialization Backbone

- [x] 8.1 Add kind-specific materializer registry and unsupported-kind fail-closed behavior.
- [x] 8.2 Implement SOP asset materialization with source package/asset identity, version, validation, and upgrade-ready metadata.
- [x] 8.3 Implement company template asset registration without auto-creating or switching companies.
- [x] 8.4 Implement office layout and prefab asset validation/materialization with safe reference checks.
- [x] 8.5 Implement bundle dependency ordering, rollback IDs, all-or-error install behavior, and terminal install event emission only after full success.
- [x] 8.6 Extend export/package builders for SOP, company template, office layout, prefab, and bundle assets.

## 9. Verification

- [x] 9.1 Run `openspec validate harden-company-startup-and-production-backbone --strict`.
- [x] 9.2 Run the new deterministic harness scenarios for providerless startup, typed SOP runs, artifact intent, project null workspace, and asset materialization rollback.
- [x] 9.3 Run affected package builds for core/shared-types/desktop renderer/desktop as required by touched implementation.
- [x] 9.4 Run release `.app` verification only for non-UI runtime truths: no-provider no-fake-work, real startup lifecycle state, `pm_planner` planning phase, typed SOP dispatch, and null-workspace project behavior.
