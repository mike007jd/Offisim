## Context

The SOP workspace already has a working DAG canvas (`SopDagCanvas`), bezier edges with active-flow animation (`SopDagEdge`), pan/zoom + drag-to-connect + cycle prevention + auto-layout. What's missing is the **builder shell** around it: there is no inspector, the node face hides the I/O contract (deps + output_key), and connection ports are gated behind an `Edit` toggle so the graph nature isn't visible at first paint. PM read it as "没连线 / 没功能" because the *editor surface* doesn't communicate the underlying flow editor it's wired up to be.

This change is editor-surface only. Run-state visualization (pending → active → completed → failed flowing through nodes/edges) is E2 territory and explicitly deferred. Persistence model and dispatch path stay untouched.

Current code map:
- `SopViewSurface.tsx` — orchestrator, owns selection / edit-mode / save status / popovers / context menu
- `SopSidebar.tsx` — left rail (kept)
- `SopLibraryBar.tsx` — top toolbar (kept; minor: nothing to add for E1)
- `SopDagCanvas.tsx` — pan/zoom, pointer interaction, port rendering (modify: ports always rendered)
- `SopDagNode.tsx` — node face (modify: add deps count + output_key subline)
- `SopDagEdge.tsx` — bezier + flow animation (kept)
- `sop-dag-layout.ts` — pure layout (modify: extract `wouldCreateCycle` helper for live preview)
- `SopAddStepPopover.tsx` / `SopNodeContextMenu.tsx` / dialogs — kept
- **NEW** `SopInspectorPanel.tsx` — right rail, read-only details for `selectedStepId`

## Goals / Non-Goals

**Goals:**
- 4-region builder shell: left list / center canvas / right inspector / bottom NL bar — all four visible by default
- Node face shows enough I/O contract to read the graph without hovering: label / role / deps count / output_key / status dot
- Connection ports always rendered (subtle when not editing; highlighted in edit mode), so the "this is a graph" affordance lands at first frame
- Real-time cycle prevention while dragging a connection (red ports + abort drop), backed by the same topological check that already guards persistence
- Inspector reads from existing `selectedStepId`; no new selection model
- Zero data-model / dispatch / runtime change

**Non-Goals:**
- Run-state visualization (E2)
- Inline editing on the inspector — keep editing in popover/context menu (one dirty-state surface, not two)
- SOP versioning / branching / sub-flows / multi-select
- Replacing or restructuring `SopNlCommandBar` (selected-step prefill flow stays)
- Touching `repos.sopTemplates` / `SopSyncService` / event topics

## Decisions

### D1. Inspector is read-only and renders from `selectedStepId` only
Rationale: `SopViewSurface` already tracks `selectedStepId` and prefills the NL command bar from it. Adding a read-only inspector reuses that state with zero coupling. Making it editable would create a second dirty-state surface alongside `SopAddStepPopover`, doubling save-status complexity. PM can still edit via double-click → popover (existing affordance) or right-click → context menu → Edit.

Alternatives considered:
- Inline editable inspector with sticky save bar — rejected: overlaps `EmployeeEditorDialog` pattern in Personnel; SOP doesn't have a dirty-state controller and adding one for E1 inflates scope. Revisit if PM demand surfaces.
- No inspector at all, expand the NL command bar — rejected: command bar is for *commanding*, not for *reading the truth*. PM specifically called out the missing inspector ("右侧 inspector").

### D2. Ports always rendered, opacity gated by edit mode
Rationale: hidden-until-editing ports are the root cause of "没连线" perception. Always-on with low opacity (`opacity-40`) when not editing communicates "graph here", and the existing `editMode` opacity bump + drag-handlers stay unchanged.

Alternatives:
- Always full-visibility ports — rejected: noisy, dot-grid + nodes already busy
- Hover-only ports — rejected: discoverability problem; hover affordance only lands after PM moves to the node, doesn't fix first-frame perception

### D3. Live cycle highlight, not just post-drop toast
Rationale: `validateNoCycles(def)` already runs in `updateDefinition` and rejects cycle-creating writes with a toast. That's correct as a backstop but UX-wise the user just lost their drag without seeing "why". Solution: while a port-drag is active, compute `wouldCreateCycle(def, fromStepId, hoveredTargetStepId)` per `pointerMove` and recolor the candidate input port red when invalid. Drop on a red port short-circuits — no `onAddDependency` call, no toast (the visual was the message).

Implementation: extract a pure `wouldCreateCycle(def, fromId, toId)` helper in `sop-dag-layout.ts` that does a synthetic dependency add followed by `getExecutionBatches` length check, identical to current `validateNoCycles` semantics. `SopDagCanvas` receives the `definition` reference (it already gets `layout`; passing `definition` is one more prop) or — to avoid coupling — gets a `canConnect: (fromId, toId) => boolean` callback from `SopViewSurface`. Pick the callback approach: keeps `SopDagCanvas` definition-agnostic.

Alternatives:
- Keep current toast-only behavior — rejected: doesn't address the "feels broken" feedback
- Pre-compute reachable set when port-drag starts — viable optimization but premature; SOPs are typically <30 steps, per-frame check is cheap

### D4. Node face: add `deps · N` chip + `→ output_key` subline
Rationale: today's node shows label + role badge + status dot + 2-line instruction excerpt. The `dependencies` and `output_key` fields are invisible — exactly the data that makes a step *part of a graph*. Add:
- Top-right of node body, beside role badge: small `deps·2` chip when `dependencies.length > 0` (omitted at zero to reduce noise)
- Bottom subline (replacing the existing 2nd line of instruction excerpt? No — keep instruction at 2 lines but compress to 1 line, and add a third line `→ {output_key}` in `font-mono text-[10px] text-slate-500`)

Hard sizing: node is currently `w-[280px] h-[140px]`. Three lines + header fits, but verify in live agent. If it doesn't, raise nodeHeight to 156 in `DAG_LAYOUT.nodeHeight` (this propagates through layout cleanly because it's read from the constant).

Alternatives:
- Show full instruction (no excerpt) — rejected: instruction can be long; truncation is correct
- Hide instruction entirely — rejected: instruction is the human-readable "what does this step do", removing it loses signal
- Show `output_key` as tooltip — rejected: discoverability problem

### D5. Right panel width and layering
Width: 320px (matches Personnel inspector convention). Renders inside the same flex row as sidebar+canvas. When `selectedStepId === null`, panel shows an empty state ("Select a step to inspect"). When `selectedSopId === null` (no SOP selected at all), panel is hidden — the empty-state already takes the full canvas area, an empty inspector beside it would be visual debt.

Alternatives:
- Floating overlay panel — rejected: covers canvas content during drag; PM expects persistent layout
- Collapsible panel with toggle — viable but adds toggle UI; prefer always-on for now, revisit if narrow viewports complain

### D6. No layout-engine change, no data-model change
Rationale: `DAG_LAYOUT` constants and `computeDagLayout` stay as-is (modulo possibly bumping nodeHeight per D4). `SopDefinition.steps[].position` continues to drive node X/Y, edit mode bakes auto-positions on first entry. Persistence path is unchanged.

### D7. Build & verify discipline
Build order: ui-office only (`pnpm --filter @offisim/ui-office build` after edits). Verify in browser at `apps/web` dev server (port 5176) with seeded SOPs. Live agent verify list lives in `tasks.md`. No automated tests — repo policy.

## Risks / Trade-offs

- **[Pointer-event regression while wiring inspector]** → Inspector is a sibling flex child outside `SopDagCanvas`'s pointer surface; should not steal events. Verify drag-to-connect, pan, double-click-to-add, node drag still work after panel mount.
- **[Always-rendered ports add SVG node count]** → 2N extra `<g>` per render (input + output). For typical SOPs (<30 steps) this is 60 extra elements; trivial. Larger SOPs could hit perf — mitigate by reusing the same port markup but with `opacity` instead of conditional render, so React doesn't churn on edit-mode toggle.
- **[Cycle highlight false negatives]** → If `wouldCreateCycle` and `validateNoCycles` ever drift, post-drop toast still catches it. Single-source the check by having `validateNoCycles(def)` call `wouldCreateCycle` internally? No — they have different shapes (one validates a finished def, the other a hypothetical add). Keep both, but extract `getExecutionBatches`-based topological check into a shared helper. Mitigation: unit-call them on the same input in dev to confirm parity (pure functions, no test infra needed).
- **[Node height bump cascades]** → If D4 forces nodeHeight 140 → 156, all auto-laid SOPs reflow. Acceptable: layout is recomputed from `DAG_LAYOUT.nodeHeight` on every render, no persisted bake of height. Existing `step.position` values are absolute — they don't shift, just the rendered node grows. Verify visually that edges still attach to correct port y-coord (port y is `nodeHeight / 2`, so it stays centered).
- **[Inspector + popover overlap]** → If user double-clicks a node to edit, `SopAddStepPopover` opens at click coords. With a 320px right panel, popover-from-right-edge nodes might render under the panel. Mitigation: `SopAddStepPopover` already positions at `screenX/screenY`; if it would clip, prefer left-of-cursor positioning. Out of scope for E1 initial pass — fix if PM hits it during live verify.

## Migration Plan

No data migration. Pure UI surface change.

Rollback: revert the change diff. Persistence model and dispatch path are untouched, so no data is at risk.

Deploy order: ui-office build → apps/web dev consumes via vite alias, no platform / desktop pipeline change.

## Open Questions

- Q1: Does node face fit `header + 2-line instruction + 1-line output_key` at `h-[140px]`? Verify in live agent on first paint; if it overflows, bump `DAG_LAYOUT.nodeHeight` to 156 in the same change.
- Q2: When `selectedStepId` is set but the user collapses inspector via window narrowing (≤768 narrow tier), should inspector overlay or hide? For E1, hide at narrow tier and surface step details via the existing NL command bar prefill (already happens). Re-evaluate if PM uses SOP on tablet.
- Q3: Inspector "Used by" reverse-dependency list (which steps consume this step's `output_key`) — useful but increases scope. **Defer to follow-up**, ship the forward-direction dependency list in E1.
