## 1. Layout helper extraction

- [x] 1.1 In `packages/ui-office/src/components/sop/sop-dag-layout.ts`, extract a pure `wouldCreateCycle(definition: SopDefinition, fromStepId: string, toStepId: string): boolean` helper. Implementation: clone steps, push `fromStepId` into `toStepId`'s dependencies (skip if already there or if from === to), run `getExecutionBatches`, return `true` when not all steps land in a batch.
- [x] 1.2 Verify `validateNoCycles` in `SopViewSurface.tsx` and `wouldCreateCycle` agree on the same input by manual inspection — they share `getExecutionBatches`. No test infra; hand-check. (Both call `getExecutionBatches(def).flat().length === def.steps.length`; `wouldCreateCycle` runs the same predicate on a hypothetical `def + (from→to)`. Self-edge short-circuits to true; existing-dep short-circuits to false.)

## 2. Node face — surface I/O contract

- [x] 2.1 In `packages/ui-office/src/components/sop/SopDagNode.tsx`, add a `deps · N` chip beside the role badge when `step.dependencies.length > 0`. Use the same chip styling as the role badge but in `bg-slate-700/60 text-slate-300`.
- [x] 2.2 Add a single-line subline `→ {output_key}` in `font-mono text-[10px] text-slate-500 truncate` below the instruction excerpt. Compress instruction excerpt to `line-clamp-1` to make room.
- [x] 2.3 Live-verify node fits at `h-[140px]`. If it overflows, bump `DAG_LAYOUT.nodeHeight` to `156` in `sop-dag-layout.ts` (single constant; layout recomputes from it). (PASS 2026-04-26 browser live verify on `Feature Development`: 5-node chain shows label / role / deps chip / one-line instruction / output_key without hover layout shift. No height bump needed.)
- [x] 2.4 Confirm port y-coordinates remain centered (`nodeHeight / 2`) and edges still attach correctly after any height change. (Ports are derived from `nodeHeight / 2` in `buildNodesFromPositions` and edges read `source.y + nodeHeight / 2`; no height change shipped, ports stay centered.)

## 3. Canvas — ports always rendered

- [x] 3.1 In `packages/ui-office/src/components/sop/SopDagCanvas.tsx`, lift the `editMode &&` gate off the port `<g>` blocks. Render input + output port `<g>` for every node on every paint.
- [x] 3.2 Apply `opacity-40` (or equivalent `fill-opacity` on the inner circles) when `editMode === false`; full opacity when `editMode === true`. Pointer event handlers (`onPointerDown` for output drag-start, `onPointerUp` for input drop) MUST short-circuit to no-op when `editMode === false` so clicks fall through to canvas pan.
- [x] 3.3 Add a `pointer-events-none` class on the port `<g>` when `editMode === false` to enforce the click-fall-through and avoid hit-area capture.

## 4. Canvas — live cycle highlight while dragging

- [x] 4.1 Add a `canConnect: (fromId: string, toId: string) => boolean` prop to `SopDagCanvas`. `SopViewSurface` provides it as `(fromId, toId) => definition ? !wouldCreateCycle(definition, fromId, toId) && fromId !== toId : false`.
- [x] 4.2 In `SopDagCanvas`, add `hoveredInputStepId` state. Update on input-port `onPointerEnter` / `onPointerLeave` while `connectingFrom !== null`.
- [x] 4.3 Recolor the input port stroke to red when `connectingFrom !== null && hoveredInputStepId === node.stepId && !canConnect(connectingFrom, node.stepId)`.
- [x] 4.4 In `handlePortDrop`, short-circuit and reset state when `!canConnect(connectingFrom, targetStepId)` — do NOT call `onAddDependency`, do NOT toast (visual already messaged).
- [x] 4.5 Keep the existing post-drop `validateNoCycles` toast in `SopViewSurface.updateDefinition` as a backstop (it covers programmatic / NL-driven mutations too). (Untouched in this change; still fires from `updateDefinition` for non-canvas mutators.)

## 5. Right inspector — new component

- [x] 5.1 Create `packages/ui-office/src/components/sop/SopInspectorPanel.tsx`. Props: `definition: SopDefinition | null`, `selectedStepId: string | null`, `runtimeState: SopRuntimeStepState[] | null`, `stepIds: string[]`. Width: `w-[320px] shrink-0`, border-left, same dark bg as sidebar.
- [x] 5.2 Empty state: `selectedStepId === null` → render placeholder copy "Select a step to inspect" centered.
- [x] 5.3 Detail view: section list (Label / Role / Status / Instruction / Dependencies / Output Key). Dependencies section maps `step.dependencies` to upstream step labels (look up via `definition.steps`); render as a vertical list, each row clickable to re-select that upstream step.
- [x] 5.4 Output Key row: render in `font-mono`, with a small "copy" icon button that copies `output_key` to clipboard (use `navigator.clipboard.writeText`). On success, transient "Copied" inline indicator for 1.5s.
- [x] 5.5 Status row: reuse the same `STATUS_DOT` mapping that nodes use (export it from `SopDagNode.tsx` or move to a shared `sop-presentation.ts` if cleaner). Show dot + status label. (Exported `STATUS_DOT` + new `STATUS_LABEL` from `SopDagNode.tsx` and consumed in inspector — kept inline export instead of a new file since both currently live in the same module.)
- [x] 5.6 Inspector clicking an upstream-step row calls a new prop `onSelectStep(stepId)` → wire to `SopViewSurface.handleStepClick` so selection moves to the upstream step.

## 6. Wire inspector into `SopViewSurface`

- [x] 6.1 In `SopViewSurface.tsx`, add `<SopInspectorPanel ... />` as a sibling of the center column (right of the canvas's parent `<div>`), inside the same root flex row.
- [x] 6.2 Mount inspector only when `sessionState.selectedSopId !== null && layout !== null` (mirror the same guard as canvas) — when the empty-state CTA renders, the inspector is hidden. (Wired via `!showEmpty` guard which is the same predicate that toggles `<SopDagCanvas>` vs `<SopEmptyState>`.)
- [x] 6.3 Pass `definition`, `selectedStepId`, `runtimeState`, `stepIds`, and `onSelectStep={handleStepClick}` props.
- [x] 6.4 Verify the Save status indicator (`saveStatus !== 'idle'`) still positions correctly — its current `right-4 top-14` may now sit on top of the inspector. If clipped, move to `right-[336px]` (16px gutter from a 320px panel) or keep within the canvas column. (Indicator is inside the center column flex child `<div className="relative flex-1 flex flex-col min-w-0">`; the inspector is a sibling outside that subtree, so `right-4` resolves to the canvas column right edge — no clipping. No change needed.)
- [x] 6.5 Verify `SopAddStepPopover` and `SopNodeContextMenu` still position correctly when triggered on rightmost nodes — if they clip behind the inspector, re-anchor to `screenX - popover.width` for right-edge nodes (defer if not seen during live verify). (PASS 2026-04-26 browser live verify: right-click node context menu rendered above the canvas/inspector boundary and exposed Edit / Duplicate / Delete; delete action remained reachable.)

## 7. Build & wire-up

- [x] 7.1 Run `pnpm --filter @offisim/ui-office build` and confirm clean. (Re-run after live-verify fix on 2026-04-26 — clean.)
- [x] 7.2 Run `pnpm --filter @offisim/ui-office typecheck` and confirm clean. (Re-run after live-verify fix on 2026-04-26 — clean.)
- [x] 7.3 No changes to `apps/web` exports / aliases expected — confirm `pnpm --filter @offisim/web build` clean. (Re-run after live-verify fix on 2026-04-26 — clean. sop-view chunk = 42.31 kB / 12.66 kB gzip.)

## 8. Live-agent verify (browser at port 5176)

- [x] 8.1 Start `cd apps/web && pnpm dev`. Navigate to SOP workspace. (PASS 2026-04-26: `pnpm --filter @offisim/web dev --host 127.0.0.1 --port 5176`, browser route `SOPs` → `Feature Development`.)
- [x] 8.2 With a seeded or freshly-created SOP, confirm 4 regions render simultaneously (sidebar / canvas / inspector / NL bar). (PASS: sidebar list, DAG canvas, right inspector empty state "Select a step to inspect", and bottom command bar are visible simultaneously.)
- [x] 8.3 Confirm node face shows label / role badge / `deps · N` chip when applicable / status dot / 1-line instruction / `→ output_key` subline. No layout shift on hover. (PASS on 5-node `Feature Development` chain.)
- [x] 8.4 Confirm input + output ports render at low opacity in non-edit mode. Toggle Edit mode → ports highlight to full opacity. Toggle off → return to subtle. (PASS: non-edit port groups carry `opacity-40 pointer-events-none`; edit groups carry `opacity-100`.)
- [x] 8.5 In edit mode, drag from output port A → input port B (valid) → confirm edge appears, persists across `Save`, and reflects on next paint. (PASS after fixing release-hit fallback in `SopDagCanvas`: `requirements → architecture` persisted as an added dependency.)
- [x] 8.6 In edit mode, drag from output port A → input port that would create a cycle → confirm target port flashes red while hovered → release → confirm no edge added, no toast. (PASS: `design → requirements` candidate turns red, release stays silent and does not mutate deps.)
- [x] 8.7 In edit mode, drag from output port A → release on A's own input port → confirm no edge added, no toast. (PASS.)
- [x] 8.8 Press Escape mid-drag → confirm drag aborts cleanly. (PASS.)
- [x] 8.9 Click a node (non-edit mode) → confirm inspector populates with full details and NL command bar prefills. (PASS: `UI/UX Design` inspector shows Label / Role / Status / Instruction / Dependencies / Output Key, command bar selection prefill updated.)
- [x] 8.10 Click a dependency row in inspector → confirm selection moves to that upstream step. (PASS: clicking `Requirements Analysis` dependency selects upstream step and inspector output_key switches to `requirements_doc`.)
- [x] 8.11 Copy `output_key` via inspector → confirm clipboard contents and "Copied" indicator. (PASS: clipboard read `requirements_doc`; inline `Copied` appeared.)
- [x] 8.12 Delete the currently inspected step (context menu) → confirm inspector returns to empty state on next paint. (PASS: right-click selected node → Delete; inspector returned to "Select a step to inspect".)
- [x] 8.13 Pan / zoom the canvas → confirm inspector stays put, ports still render, no event leakage. (PASS: inspector content remained visible while canvas pan/zoom changed only the SVG viewport.)
- [x] 8.14 Click Run → confirm `formatRunCommand` dispatch fires (chat shows the run message); status dots stay default unless runtime state arrives (E2 territory; don't expect transitions here). (PASS: Run path reachable in repos-only browser runtime; no E2 status transition expected.)
- [x] 8.15 Capture two screenshots for archive evidence: (a) idle state with all 4 regions and ports visible, (b) edit-mode mid-drag with cycle-blocked port flashing red. Save under `/tmp/` or attach in archive doc. (PASS: `/tmp/offisim-sop-8-15-idle.png`, `/tmp/offisim-sop-8-15-cycle-red.png`.)

## 9. Spec sync prep (do not run until apply complete)

- [x] 9.1 Confirm `proposal.md` `What Changes` and `Capabilities` still match what shipped — note any drift. (PASS: shipped four-region shell, node I/O surface, always-rendered ports, live cycle prevention, inspector, and no runtime dispatch model change. No proposal drift.)
- [x] 9.2 Confirm `tasks.md` checked items reflect actual landed code; any half-done item must stay unchecked with a note. (PASS: checked items reflect code + live verify; 8.5 exposed and fixed a real drag-release persistence gap before marking complete.)
- [x] 9.3 Confirm `specs/sop-builder-canvas/spec.md` requirements all map to live behavior; flag any scenario that wasn't verified for follow-up. (PASS: requirements mapped to 8.x live scenarios; runtime status transitions remain explicitly E2 scope.)
- [x] 9.4 Update `packages/ui-office/CLAUDE.md` "UI / Scene / 3D" SOP block to reflect the new 4-region shell + always-rendered ports + inspector contract.

## 10. Archive prep

- [x] 10.1 Run OpenSpec archive gate (Truth-source priority #2 in repo CLAUDE.md): spec consistency, tasks consistency, doc/comments consistency. (PASS: proposal/spec/tasks/CLAUDE sync checked after live verify.)
- [x] 10.2 Confirm protocols-ledger.md is unaffected (this change touches no protocol). (PASS: code/docs touched only SOP UI/OpenSpec task docs; no protocol files.)
- [x] 10.3 Hand off to `/opsx:archive sop-builder-canvas-rebuild` once 8.x verify is PASS for required scenarios. (Ready: 8.x PASS and screenshots captured.)
