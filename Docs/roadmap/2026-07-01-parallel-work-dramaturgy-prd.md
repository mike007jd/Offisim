# Parallel Work Dramaturgy PRD

## Current Time Baseline
- Checked at: 2026-07-01 23:10 NZST.
- Scope: Offisim desktop Office scene, employee workload projection, agent run tree, and generic dramaturgy display.
- Status: Product requirements document. This document does not authorize a new runtime, provider lane, or sub-agent identity model.

## Product Decision
Offisim should not introduce a new sub-agent roster, swarm schema, worker lifecycle, or long-lived worker identity. The existing model is correct:

- `employee` is the stable visible identity.
- `agent_run` is the temporary cognition/work instance.
- delegated child runs belong under an employee identity.
- the Office scene should show one employee body with concurrent work represented as count, grouped status, flow packets, artifact delivery, and resource/error markers.

The product goal is to make the current employee workload and dramaturgy layer read as a high-quality parallel work theater.

## Problem
When one employee owns many concurrent runs, the current UI already avoids duplicating the employee, but the visible expression is still too thin:

- `activeCount` shows concurrency but not composition.
- `workloadChips` show up to three individual run labels, which breaks down at high concurrency.
- flow packets exist, but fan-out and fan-in do not yet read as organized work movement.
- artifact delivery exists as a scene count, but not as a clear "claim/open the result" interaction.
- resource and failure states are present, but high-severity states need stronger visual hierarchy.
- there is no lightweight drilldown for "what are these 58 active runs doing?" without turning workers into individually managed entities.

## Source Truth In Current Code
The requirement must build on the current implementation, not replace it.

| Area | Existing source truth | Product reading |
|---|---|---|
| Neutral run vocabulary | `packages/shared-types/src/events/agent-run.ts` | `AgentRunEvent` already expresses root/parent/run tree, employee ownership, work kind, artifacts, approval, tools, and terminal states. |
| Stable employee workload | `apps/desktop/renderer/src/assistant/runtime/conversation-run-projections.ts` | concurrent active runs collapse into one employee actor with `activeCount`, `waitingCount`, `workloadChips`, and dominant beat. |
| Dramaturgy intent | `packages/shared-types/src/dramaturgy/beat-composer.ts` | `SceneBeat` already carries `visual`, `flow`, `artifact`, and `resource` intents. This is the right generic work grammar. |
| 2D expression | `apps/desktop/renderer/src/surfaces/office/scene/OfficeScene2D.tsx` | 2D already has flow lines, packets, active count, risk marker, workload chips, and delivery shelf count. |
| 3D expression | `apps/desktop/renderer/src/surfaces/office/scene/OfficeScene3D.tsx` | 3D already has active count, workload bubble, resource marker, flow lines, and a passive Delivery shelf count. |
| Output opening | `apps/desktop/renderer/src/surfaces/office/stage-viewer/StageViewer.tsx` | `openStageView` and deliverable auto-open already exist; artifact claim should reuse this path. |

## Goals
1. Make large parallel work readable at a glance.
2. Keep employee identity stable: one employee, one body, many temporary runs.
3. Make artifacts feel delivered into the workspace, not only logged in a panel.
4. Make blocked/approval/resource failures impossible to miss without overwhelming normal work.
5. Provide drilldown for active runs while avoiding worker-by-worker management.
6. Preserve deterministic projection: scene UI derives from run/event facts, not model-written animation commands.

## Non-Goals
- Do not create persistent sub-agent identities.
- Do not render dozens or hundreds of worker bodies.
- Do not add `delegationBatchId`, batch schema, or swarm lifecycle as the first step.
- Do not replace Pi Agent runtime.
- Do not introduce LangGraph, CrewAI, Mastra, Temporal, or other workflow engines for this UI iteration.
- Do not add task-specific animations such as "developer walks to computer" or "designer draws board" as core logic.
- Do not expose controls to individually configure every child run.

## Primary User Experience
Default scene view:

- The user sees the employee as the stable owner of work.
- When one employee has multiple runs, the employee label shows `xN`.
- The employee workload bubble shows a grouped distribution instead of only the first three runs when the count is high.
- Blocked, approval, failed tool, token/budget/context/permission problems visually outrank normal work.
- Artifacts move toward a delivery/output area and accumulate as claimable output chips.
- The user can click an employee, a workload bubble, or a delivery chip to inspect details.

Drilldown view:

- Opens as a lightweight drawer or panel, not a new management console.
- Groups the employee's active runs by `workKind`, status, and issue type.
- Shows run count, newest meaningful beat, artifact count, approval count, and failure/resource summary.
- Allows opening existing logs, output, preview, files, or review views through `openStageView`.
- Does not allow configuring individual workers, changing their persona, or manually managing lifecycle.

## Workload Bubble Requirements
### Small concurrency
For 1-3 active runs:

- keep the current chip model.
- show labels derived from current beat facts: `Read`, `Compute`, `Review`, `Approval`, `Artifact`, or resource label.

### Medium concurrency
For 4-12 active runs:

- show `xN` plus up to 4 grouped chips.
- grouped chips must prefer high-signal states in this order:
  1. blocked/resource/failure
  2. approval/waiting
  3. artifact/done
  4. dominant work kind distribution

### Large concurrency
For 13+ active runs:

- show `xN` plus grouped distribution.
- examples:
  - `Research 24`
  - `Generate 16`
  - `Review 9`
  - `Blocked 3`
- do not list individual run labels in the default scene.
- keep the bubble within fixed dimensions; overflow opens drilldown instead of expanding the scene.

## Flow Requirements
Flow should communicate work movement, not draw decorative lines.

- Delegation/fan-out: lines should visually originate from the owner employee and spread toward work targets.
- Join/fan-in: completion or review beats should visually converge back to owner/review/delivery.
- Tool/resource problems: route to the tool/resource target with a higher-risk tone.
- Artifact flow: route to delivery/output target.
- Reduce noise by showing only the latest/highest-signal beats, using current `slice(-8)` behavior as the baseline.
- Reduced-motion mode must preserve state visibility without moving packets.

## Artifact Delivery Requirements
Artifacts should feel like delivered work.

- Use `SceneBeat.artifact` as the source signal.
- Keep delivery count in both 2D and 3D.
- Upgrade delivery shelf from passive count to claimable output surface.
- For each recent artifact, expose a compact chip with title/kind when space allows.
- Clicking a claimable artifact opens:
  - `kind: 'output'` when `deliverableId` is available.
  - `kind: 'file'` when only a path is available and it is workspace-readable.
  - `kind: 'preview'` when it is a browser/HTML preview artifact.
  - fallback to logs when only event detail exists.
- Do not create a separate artifact persistence path. Reuse deliverables repo and existing StageViewer behavior.

## Resource And Exception Requirements
Resource state must be immediately legible.

- `approval requested`: waiting marker, approval chip, and drilldown priority.
- `tool failed`: risk marker and tool/log open action.
- `token exhausted`: exhausted marker; should not look like a normal warning.
- `budget`: warning or blocked marker depending on severity.
- `permission`: blocked marker with approval/security implication.
- `context`: context/resource marker with recovery hint in drilldown.
- `runtime`: runtime blocked marker and logs action.

The actor should not keep playing a normal working state when the dominant unresolved state is blocked.

## Drilldown Requirements
The drilldown is a read/inspect layer.

Minimum content:

- employee name and role.
- total active run count.
- status distribution: running, waiting, failed, completed artifact signals.
- work kind distribution.
- latest dominant beat.
- artifacts list.
- approval requests.
- failures/resource issues.
- run rows with objective summary where available.

Minimum actions:

- open output.
- open preview.
- open logs.
- open changed file/review.
- jump to thread.

Forbidden actions in this iteration:

- edit child worker prompt/persona.
- manually spawn or terminate individual child workers from this drawer.
- rename temporary runs as if they are employees.

## Projection/Data Requirements
The implementation should extend existing projection, not the runtime model.

Preferred direction:

- Add aggregated workload distribution to `EmployeeWorkloadProjection`.
- Derive distribution from existing fields:
  - `employeeId`
  - `rootRunId`
  - `parentRunId`
  - `runId`
  - `workKind`
  - run phase/status
  - `SceneBeat.visual`
  - `SceneBeat.resource`
  - `SceneBeat.artifact`
- Keep `workloadChips` for small counts, but add a grouped summary for large counts.
- Do not add `delegationBatchId` unless grouping cannot be derived reliably from current run tree fields.

Potential shape:

- `workloadSummary.total`
- `workloadSummary.byWorkKind`
- `workloadSummary.byStatus`
- `workloadSummary.priorityIssues`
- `workloadSummary.artifactCount`
- `workloadSummary.approvalCount`

This shape is a projection, not persisted runtime truth.

## Visual Quality Requirements
- The scene must remain dense, readable, and professional.
- No nested cards inside scene overlays.
- No large decorative animation that obscures work state.
- Text must not overflow chips, bubbles, badges, or shelf labels.
- `xN`, issue marker, and artifact delivery must remain legible in both 2D and 3D.
- High-concurrency view must not cause layout shifting around employee labels.
- Motion must be purposeful and bounded; packets communicate work transfer, not celebration.

## Acceptance Criteria
Functional acceptance:

- One employee with 1 active run shows one actor and one small work state.
- One employee with 3 active runs shows one actor, `x3`, and up to 3 chips.
- One employee with 58 active runs shows one actor, `x58`, and grouped distribution.
- Blocked/approval/resource states outrank normal work in the bubble.
- Artifact event creates visible delivery state in 2D and 3D.
- Clicking a delivery artifact opens the correct StageViewer surface.
- Clicking employee workload opens the drilldown without creating new employee identities.
- 2D and 3D read from the same workload/beat facts.

Regression acceptance:

- No duplicate employee bodies are created for child runs.
- No new runtime/provider lane appears.
- No model-authored animation commands are introduced.
- Reduced-motion mode still shows counts, chips, issues, and artifacts.
- Existing deliverables rail and auto-open behavior continue to work.

## Suggested Implementation Slice
1. Extend workload projection with grouped summary.
2. Update 2D and 3D workload bubble rendering for grouped summary.
3. Make 3D/2D delivery shelf interactive and artifact-aware.
4. Add lightweight employee workload drilldown.
5. Strengthen resource marker hierarchy.
6. Add deterministic harness coverage for small/medium/large concurrency, artifact claim, and blocked priority.

## Verification Plan
- `pnpm harness:agent-run-projection`
- `pnpm harness:beat-composer`
- `pnpm harness:conversation-run-controller`
- `pnpm harness:office-projection`
- `pnpm harness:dramaturgy-stress`
- `pnpm --filter @offisim/desktop-renderer typecheck`
- `pnpm --filter @offisim/desktop-renderer build`
- `pnpm validate`
- release `.app` build and Computer Use verification for 2D/3D Office scene interaction.

## Final Requirement Statement
In Offisim's Office scene, represent parallel AI work as: one stable employee body, N temporary run instances, grouped workload distribution, meaningful flow packets, claimable artifact delivery, and prioritized exception markers. The implementation must improve the current projection and rendering layer without changing the underlying employee/run identity boundary.
