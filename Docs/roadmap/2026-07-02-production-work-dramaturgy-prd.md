# Fable Production Work Dramaturgy Requirements

> **Historical / superseded (2026-07-16):** delivery input retained for design
> history. Use the [current Codex-alignment plan](./2026-07-13-ui-ux-consistency-pass/plan.md),
> [feature catalog](../FEATURES.md), and [Office art bible](../design/office-art-bible.md).

## Current Time Baseline
- Checked at: 2026-07-02 12:39 NZST.
- Scope: post-cleanup Offisim desktop Office scene, deterministic work dramaturgy, 2D/3D work theater, and production-grade UI/UX behavior.
- Audience: Fable implementation handoff.
- Status: production-quality requirement document for a prelaunch product. This supersedes the remaining open items in `2026-07-01-parallel-work-dramaturgy-prd.md`. `2026-07-01-universal-work-dramaturgy-iteration-plan.md` is a completed validation record, not an active directive source; its deferred items are not backlog unless restated here.

## Product Context
Offisim has just been cleaned. It is still a prelaunch product: no real users, no production data, and no historical compatibility contract. This work must not be implemented as small patches on top of old vibe-coding layers.

The correct delivery standard is a clean production baseline:

- no compatibility work for old local state.
- no migration layer for abandoned scene assumptions.
- no temporary/fallback UX that becomes permanent debt.
- no "MVP first, improve later" completion claim.
- no duplicated interpretation of the same runtime facts across 2D, 3D, drilldown, and delivery surfaces.

The goal is not to decorate the existing scene. The goal is to turn the Office scene into a coherent, fact-driven work dramaturgy system.

## Current Baseline
The first parallel-work slice already exists and should be treated as the baseline:

- `SceneBeat` carries `visual`, `flow`, `artifact`, and `resource` intent.
- `ArtifactIntent` preserves artifact `path`.
- `EmployeeWorkloadProjection` has `workloadSummary`.
- grouped workload chips support small / medium / large concurrency.
- blocked/resource/failure/approval issues outrank ordinary work in summary and dominant selection.
- failed child runs can remain visible while their issue beat is live.
- 2D and 3D share `projectOfficeStaging`.
- 2D and 3D delivery shelves can expose the latest claimable artifact.
- current characters are procedural placeholders with no production asset contract; the final presentation must be materially better, judged by the Character And Animation Requirements checklist.

Fable should not re-solve the identity model. The model is already correct:

- employee = stable visible identity.
- agent run = temporary work instance.
- delegated child runs belong under an employee.
- one employee body may represent many temporary runs.

## Product Goal
Make Offisim's Office scene feel like a high-quality AI work operations theater:

- one stable employee body.
- N temporary runs shown as count, grouped state, flow, delivery, and exception signals.
- work movement that reads as organized fan-out / fan-in, not random lines.
- artifacts that feel delivered and claimable.
- blocked, approval, failed tool, token/budget/context/permission/runtime states that are impossible to miss.
- character and scene animation that feels alive but stays tied to facts.
- a lightweight drilldown for inspection, not worker management.

The output should feel designed, intentional, dense, and production-ready.

## Non-Goals
- Do not change Pi Agent runtime ownership.
- Do not restore Offisim provider/model catalogs or alternate runtime lanes.
- Do not create persistent sub-agent identities.
- Do not render dozens or hundreds of sub-agent bodies.
- Do not build a worker management console.
- Do not add task-specific profession animation packs as the core abstraction.
- Do not implement character-model generation strategy here. Fable owns the visual/model solution.
- Do not add legacy compatibility, migration, rollout, or fallback layers for prelaunch artifacts.

## Core Architecture Requirement
Fable should introduce a proper scene renderer contract instead of letting each component interpret facts independently.

Required projection:

- `SceneBeat` remains the semantic event source.
- `EmployeeWorkloadProjection` remains the workload source.
- a new render-facing `SceneCue` or equivalent projection should derive all visible scene signals. It lives in the renderer runtime (alongside `conversation-run-projections.ts`), not in `packages/shared-types`: its workload input is renderer-coupled. Its harness follows the existing renderer-tsconfig harness pattern.

The projection should produce at least:

- actor cues: employee id, stable identity, active state, performance, selected/hover/drag status. Input scope: 3D already feeds selected/hover/drag; the 2D canvas is click-only today and must add hover hit-testing, while drag/reassign stays 3D-only in this work. The cue contract must degrade gracefully when a scene lacks an input source.
- workload cues: active count, tier, grouped distribution, top issue, overflow state.
- flow cues: fan-out, fan-in, tool route, approval route, artifact route, recovery route.
- delivery cues: claimable artifacts, recent count, title/kind, open target.
- resource cues: token/budget/context/permission/runtime/tool issues. Hierarchy means severity precedence (blocked outranks risk outranks normal); the six kinds are distinct labels, not a priority order among themselves.
- attention cues: severe issue focus, selected thread focus, delivery focus.

The projection must retain per-run work-kind and issue facts durably enough for high concurrency: do not inherit the current 400-event/120s rolling beat window as the retention contract. Controller-side run records are the durable source; `RunDelegation` currently drops `workKind` even though every `AgentRunEvent` carries it, and should be extended as part of this work.

2D scene, 3D scene, drilldown, delivery shelf, the scene-cue harness fixtures, and the release `.app` evidence flow must all read from this same contract.

## Work Theater Language
The work theater should communicate what is happening without requiring the user to read logs.

### Fan-Out
When one employee starts many delegated runs:

- keep one employee body.
- show `xN` as the primary density indicator.
- show grouped status chips, not individual child labels at high count.
- animate or draw bundled outbound work lanes.
- route work by purpose/target when possible: tool, review, delivery, user.
- avoid line noise by grouping repeated flows.

### Fan-In
When child work returns:

- show convergence back to the owner, review point, or delivery shelf.
- completed artifacts should visibly move toward delivery/output.
- review/join beats should feel like consolidation, not another random packet.

### Artifact Delivery
Artifacts must feel like actual outputs arriving in the workspace:

- delivery shelf is a real interaction surface, not just a passive count.
- recent artifacts should show compact claimable chips up to a fixed chip budget; beyond it, the overflow rule below applies.
- clicking an artifact should open the correct existing StageViewer target.
- overflow should lead to history/drilldown, not expand until it breaks layout.
- delivery must exist in both 2D and 3D.

### Approval / User Wait
Approval must not look like normal work:

- route visually toward the user.
- actor should enter a waiting/concern state.
- workload bubble should prioritize approval.
- drilldown should expose the approval reason/action path when available.

### Blocked / Resource / Failure
Failures must dominate ordinary work:

- token exhausted, budget exhausted, permission blocked, context blocked, runtime blocked, and tool failed states must be visually distinct.
- these distinctions must become typed runtime facts: today five of the six (all except tool failed) are keyword heuristics over free-text failure summaries, produced only at terminal run failure. Add a typed failure/resource kind to the run-finished wire payload as part of this work so live failures classify deterministically; keyword derivation is not an acceptable long-term contract.
- top issue should appear on actor marker, workload bubble, and drilldown.
- if any blocked-severity issue is present, the issue count/marker takes the primary slot and the active count demotes to secondary.
- normal typing/working motion must not visually override blocked state.

### Recovery
When work resumes after a problem:

- show a quiet return to normal flow.
- do not celebrate recovery as completion.
- preserve the history in drilldown while returning the main scene to active work.

## Required State Coverage
The dramaturgy system should cover these generic states without bespoke profession logic:

- idle employee.
- selected employee.
- hovered/dragged/reassigned employee.
- one active run.
- three active runs.
- high concurrency, e.g. 58 active runs (canonical harness fixture tier; live delegation caps a single run tree at 16 children / 4 parallel fan-out — see Verification Plan for the evidence split).
- planning.
- reading/searching.
- writing/editing.
- shell/build/test/compute.
- reviewing.
- delegating.
- joining/fan-in.
- waiting for approval.
- producing an artifact.
- artifact delivered and claimable.
- tool failed.
- token or budget exhausted.
- permission/context/runtime blocked.
- cancelled run (reads as a neutral stopped state, distinct from failure — no blocked/risk markers).
- completed run.
- reduced-motion mode.
- no-live-beat active run fallback.
- terminal failed child still visible while issue is live.

Coverage should be generic. Developer, designer, reviewer, researcher, and manager roles may have different flavor, but they should not require separate logic branches to express the same state.

## Character And Animation Requirements
Fable owns the model/art solution. This document only defines product requirements.

The final character presentation must be materially better than the current procedural block characters:

- polished, coherent, and readable from the default camera.
- stylized rather than realistic.
- expressive enough for focus, thinking, waiting, blocked, happy/complete, and neutral states.
- works at dense office scale with many employees on screen.
- supports props or equivalent visual tells for document, laptop/terminal, package/artifact, pointer/review.
- supports idle, walk, sit, type/work, read, inspect, handoff, wait/worried, blocked, and complete/celebrate states.
- does not require profession-specific animation packs.
- does not obscure workload bubbles or markers.
- respects reduced-motion mode.

`CharacterPerformanceState` or its replacement should remain a semantic state, not a hard-coded animation name. Fable may redesign the renderer internals, but the scene must still be driven by facts, not model-authored animation commands.

Asset and dependency boundary:

- character/scene assets must be license-clean and bundled locally into the `.app`; no runtime asset downloads.
- keep character asset weight compatible with the desktop bundle: tens of MB, not hundreds.
- any new 3D/animation dependency is an architecture decision recorded in `Docs/UI_FRAMEWORK_STACK.md`.
- character art colors go through the existing scene palette tokens.
- the new character solution replaces the procedural block rendering in the Office scene outright, with no permanent fallback lane; update the Personnel appearance preview to the same character language in the same change so the product does not ship two character systems.

"Materially better" is judged against the checklist above (default-camera readability, expressive states, dense-scale legibility, prop tells, no bubble occlusion, reduced-motion), evaluated on the Verification Plan screenshot evidence — not against taste.

## UI / UX Requirements
The scene should be dense, operational, and high quality:

- no nested cards in scene overlays.
- no text overflow in labels, chips, badges, drilldown rows, or delivery chips.
- no decorative animation that hides work state.
- no huge modal unless the user explicitly opens drilldown.
- workload bubble remains compact and stable.
- `xN`, top issue, and delivery state remain readable at default zoom.
- 2D and 3D must agree on the same facts.
- if the scene is busy, priority/aggregation should reduce noise instead of showing everything.
- the user should understand "this employee owns many temporary runs" at a glance.

## Drilldown Requirements
The drilldown is an inspection layer:

- employee name, role, and stable identity.
- active count.
- status distribution.
- work-kind distribution.
- top issue and recent issues.
- approval requests.
- artifact list.
- newest meaningful beat.
- run rows with objective/summary when available.
- open output / preview / file / changes (diff/review) / logs through existing StageViewer paths.
- jump to owning thread through existing thread selection.

Forbidden:

- do not configure child worker persona.
- do not rename temporary runs as employees.
- do not manually manage each child run lifecycle from this view.

## Production Quality Bar
This work is not complete until it feels like a coherent system:

- every visible animation/state maps back to deterministic facts.
- all high-priority states are visually impossible to miss.
- high concurrency remains readable.
- delivery and drilldown interactions are closed-loop.
- the existing deliverables rail and deliverable auto-open behavior continue to work after the delivery-shelf rebuild.
- visual language is consistent across 2D and 3D.
- reduced-motion preserves information.
- release `.app` verification proves the actual desktop product works.

## Suggested Implementation Sequence
1. Treat the previous parallel-work PRD as Wave 1 baseline, not an active backlog to re-implement.
2. Define the render-facing scene cue projection and make 2D/3D/drilldown consume it.
3. Rebuild flow/delivery/resource rendering around grouped cues instead of per-component interpretation.
4. Upgrade fan-out/fan-in visual language for high concurrency.
5. Upgrade delivery shelf into a polished claimable output surface in both 2D and 3D.
6. Upgrade character presentation and animation system to Fable's chosen production solution.
7. Ensure all required states above have deterministic fixtures/harness coverage.
8. Verify in release `.app` with real desktop interaction and screenshots.

## Verification Plan
- `pnpm harness:beat-composer`
- `pnpm harness:conversation-run-controller`
- `pnpm harness:office-projection`
- `pnpm harness:dramaturgy-stress`
- `pnpm harness:workload-chips`
- `pnpm harness:artifact-claim`
- `pnpm harness:scene-staging`
- `pnpm harness:dramaturgy-modes`
- new scene-cue harness for fan-out/fan-in/resource/artifact grouping, registered into the root `pnpm validate` chain.
- renderer typecheck.
- renderer build.
- `pnpm validate`
- release `.app` build.
- Computer Use verification against the release `.app`.
- release `.app` screenshots/evidence for: idle, 1 run, 3 runs, approval, blocked (approval/permission driven), artifact delivery, drilldown, reduced-motion, 2D/3D parity, and the highest concurrency reachable under real delegation caps (one root run at full fan-out).
- deterministic harness evidence is the sanctioned form for exact high-concurrency tiers (e.g. 58 runs) and resource-exhausted blocked states (token/budget/context/runtime): these are structurally unreachable or nondeterministic in a release build. Do not burn live model runs chasing exact counts, and do not add a fixture-injection lane to the release app.
- reduced-motion evidence is driven via macOS System Settings → Accessibility → Display → Reduce Motion (WKWebView maps it to `prefers-reduced-motion`); record the original value and restore it afterwards.

## Final Requirement Statement
Build the next Offisim work dramaturgy as a production-grade framework, not a patch layer: one stable employee body, many temporary run instances, grouped operational workload, organized fan-out/fan-in, claimable delivery, prioritized exception states, lively but fact-driven animation, and a polished Fable-quality Office scene that can become the long-term foundation before launch.
