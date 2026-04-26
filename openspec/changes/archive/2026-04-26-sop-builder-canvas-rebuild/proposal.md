## Why

SOP workspace today renders steps and connections fine in code, but PM perception is "没连线 / 没功能" — the editor reads as a flat list of cards because (a) connection ports are hidden behind an `Edit` toggle, (b) the right-hand inspector that would expose `dependencies` / `output_key` / `instruction` in full is missing, (c) the bottom NL command bar is the only place selected-step context surfaces. The DAG canvas is technically there but the **builder surface around it** doesn't communicate that SOPs are an editable workflow graph. UX overhaul Phase E1 ships the missing IA + visibility layer so the SOP workspace reads as a real flow editor on first glance, against the spec's "图 9" reference.

## What Changes

- Add a persistent **right inspector panel** (selected-step details: label / role / instruction / dependency list with step labels / output_key / status) — reuse existing `selectedStepId` state, no new selection model
- Promote node visible affordances: keep current label / role / instruction excerpt + add **dependency count** badge + **output_key** subline (truncated, monospace) so a step's I/O contract is visible without entering edit mode
- Make connection ports **always visible** (subtle when not in edit mode, highlighted in edit mode) so the graph nature reads at first frame; drag-to-connect remains gated behind edit mode
- Keep `SopNlCommandBar` as the bottom command bar; selected-step prefill flow unchanged (inspector replaces the *visualization* of context, not the *commanding* of it)
- Layout shell: left `SopSidebar` (unchanged) + center `SopDagCanvas` + new right `SopInspectorPanel` + bottom `SopNlCommandBar` (unchanged), rendered in `SopViewSurface`
- Cycle prevention: surface the existing `validateNoCycles` rejection inline on the canvas (toast already fires; add a transient red highlight on the offending source/target ports while the user is dragging) — real-time block, not just post-drop toast
- **No data-model change**: continues to read/write `SopDefinition.steps[].dependencies` / `output_key` / `position` as today; `repos.sopTemplates.update(definition_json)` remains the persistence boundary
- **No runtime / dispatch change**: this change is editor-surface only. `Run SOP` continues to dispatch via `sendMessage(formatRunCommand(...))`. Run-state visualization (pending / active / completed / failed flowing through edges) is **deferred to E2**.
- Decouple add-step affordance: empty-canvas double-click + sidebar `+` + toolbar `Create` keep current behavior; the bottom-right floating "Add Step" FAB stays in edit mode only

## Capabilities

### New Capabilities
- `sop-builder-canvas`: SOP workspace IA (4-region shell), node visible contract (label / role / deps / output_key / status), edge contract (always-rendered, hover-deletable in edit mode), inspector contract (selected-step truth), interaction contract (select / drag / connect / cycle-block), and the boundary against runtime/dispatch (E2 territory).

### Modified Capabilities

(none — there is no existing canonical spec for the SOP builder surface; this change creates the first one. `office-tool-discovery` already covers the workspace tab itself and is not changing.)

## Impact

- **Code**:
  - `packages/ui-office/src/components/sop/SopViewSurface.tsx` — add right-panel slot, wire selected-step → inspector
  - `packages/ui-office/src/components/sop/SopInspectorPanel.tsx` — **new**, renders selected step details
  - `packages/ui-office/src/components/sop/SopDagNode.tsx` — add deps count + output_key subline, status dot stays
  - `packages/ui-office/src/components/sop/SopDagCanvas.tsx` — ports always visible (low-opacity outside edit mode); cycle highlight while dragging
  - `packages/ui-office/src/components/sop/sop-dag-layout.ts` — no signature change; possibly a tiny helper `wouldCreateCycle(def, fromId, toId)` lifted out of `SopViewSurface.validateNoCycles` for live highlight
- **No changes** to: `packages/shared-types/src/sop.ts`, `packages/core/src/services/sop-service.ts`, `packages/core/src/services/sop-sync-service.ts`, `useSops`, `useSopRuntimeState`, `repos.sopTemplates`, chat command formatters, `SopAddStepPopover`, `SopNodeContextMenu`, `SopEditorDialog`, `SopImportDialog`
- **Build order**: ui-office only; no shared-types / core rebuild required
- **Risk surface**: node visual + canvas pointer logic. Drag-to-connect, pan/zoom, double-click-to-add must not regress. Validation: live agent in browser at port 5176 with seeded SOPs (Marketplace ships at least one SOP from F0 official seed if available; otherwise use `Create` flow).
- **Out of scope** (deliberately deferred):
  - Run-state visualization / edge flow / per-step status pulse (→ E2 `sop-run-surface`)
  - SOP versioning / branching
  - Multi-select / bulk operations
  - Sub-flow / nested SOPs
  - Inline step edit on the inspector (keep editing in `SopAddStepPopover` / context menu — moving inspector to be editable doubles the dirty-state surface)
