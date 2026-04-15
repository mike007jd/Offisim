# Offisim 2D Canvas Migration Spec

**Status:** approved product/engineering direction  
**Audience:** Kiro / Claude Opus / implementation agents  
**Priority:** next major scene task after current vault/settings cleanup  
**Scope:** 2D office scene only

---

## 1. Decision

Offisim's former 2D office scene was SVG-based and should **not** be revived as the long-term rendering path.

The new direction is:

- **2D office scene = canvas-first renderer**
- **DOM = overlays and controls only**
- **SVG = retired from the main 2D scene**

This is a directional architecture change, not a visual polish pass.

---

## 2. Why we are changing

The current SVG path has become a quality and maintenance ceiling.

Observed problems:

- visual output looks brittle and "AI-generated" rather than intentional
- scene markup is too fragmented and too easy to degrade as features grow
- layering, animation, selection, and density all become awkward in SVG
- drag/selection/state overlays are harder to keep coherent
- adding polish to SVG is producing more complexity than value

Product conclusion:

- Do **not** spend more time beautifying the current SVG 2D scene
- Move the 2D scene to a proper canvas renderer and keep DOM for UI surfaces

---

## 3. Product positioning

This migration affects the **2D office scene shown to users**.

It does **not** change the current product positioning:

- `Tauri` remains the shipped local-first path
- `Web` remains a live-agent / lightweight / demo path
- `3D` remains supported
- `2D` remains a first-class view mode, but its renderer changes from SVG to canvas

---

## 4. In scope

- Replace the former SVG implementation that previously powered the 2D office scene
- Keep the existing `SceneCanvas` route/view toggle intact
- Reuse existing runtime/business data sources where possible
- Preserve 2D user-facing behaviors:
  - zone rendering
  - prefab rendering
  - employee placement
  - selection
  - hover/inspection affordances
  - drag-to-assign flow
  - ceremony/state highlighting

---

## 5. Out of scope

These are explicitly **not** part of this migration:

- rewriting the 3D scene
- rewriting the office editor
- redoing the scene business model
- changing runtime orchestration semantics
- adding new major scene features unrelated to the renderer swap
- polishing the current SVG implementation as an intermediate "final" step

If a feature requires new product behavior, that is a separate task.

---

## 6. Current implementation references

The former SVG path lived primarily in:

- `packages/ui-office/src/components/scene/Office2DView.tsx`
- `packages/ui-office/src/components/scene/Office2DPrefab.tsx`
- `packages/ui-office/src/components/scene/office-2d-geometry.ts`
- `packages/ui-office/src/components/scene/office-2d-layout.ts`
- `packages/ui-office/src/components/scene/useOffice2DDrag.ts`
- `packages/ui-office/src/components/scene/office-2d-avatar-cache.ts`
- `packages/ui-office/src/components/scene/SceneCanvas.tsx`

The SVG-specific files above were removed once the canvas path became the only
supported 2D renderer. They remain listed here as migration context, not as an
active code path.

---

## 7. Target architecture

### 7.1 Core split

The target 2D system should be split into three layers:

1. **Canvas renderer**
   - responsible for drawing the scene
   - no business logic
   - no React-heavy per-entity SVG tree

2. **Scene interaction layer**
   - hit testing
   - hover / selection
   - drag / drop targeting
   - viewport transforms if needed

3. **DOM overlay layer**
   - tooltips
   - inspector anchors
   - contextual labels if they should remain HTML
   - onboarding / helper UI

### 7.2 Suggested file structure

The exact filenames may vary, but the structure should look like:

- `Office2DCanvasView.tsx`
- `office-2d-canvas-renderer.ts`
- `office-2d-canvas-geometry.ts`
- `office-2d-hitmap.ts`
- `office-2d-render-registry.ts`

Keep the public boundary simple:

- `SceneCanvas` should still mount "the 2D scene"
- implementation detail should be hidden behind that view component

---

## 8. Rendering model

### 8.1 Canvas owns the scene

Canvas should render:

- floors / room blocks
- zone fills and boundaries
- prefab silhouettes / furniture
- employee bodies / markers / avatars
- selected state halos
- route/highlight/state accents
- lightweight ceremony emphasis

### 8.2 DOM owns overlays

DOM should render:

- controls
- inspector shells
- rich tooltips
- text-heavy side panels
- onboarding and guide UI

### 8.3 Do not rebuild SVG inside canvas

The migration should not become:

- "draw SVG-looking components with more wrapper code"

Instead:

- define draw primitives
- define scene entities
- draw them directly in canvas

---

## 9. Interaction requirements

The new 2D scene must preserve these user behaviors:

### 9.1 Selection

- clicking an employee selects that employee
- clicking empty space clears selection
- selected state must remain visually obvious

### 9.2 Drag to assign

- dragging an employee onto a valid zone must still drive the existing assignment flow
- invalid drop targets must be visually distinguishable
- drag feedback should feel deliberate, not floaty or ambiguous

### 9.3 Hover / discoverability

- users must be able to tell what is interactive
- hover state must be readable without cluttering the whole scene

### 9.4 State readability

- busy / blocked / idle / reporting / success / failure must remain legible
- do not rely on tiny decorative effects as the primary status cue

---

## 10. Visual direction

This migration is not just technical. The result must look more intentional than the current SVG.

Desired qualities:

- cleaner silhouette language
- stronger hierarchy between rooms, desks, and employees
- less "sticker sheet" feeling
- more deliberate use of glow/highlight
- clearer separation of background structure vs active entities

Do not optimize for hyper-detailed illustration.

Optimize for:

- readability
- state legibility
- smooth interaction
- product credibility

---

## 11. Data reuse rules

The migration should reuse existing scene/business data whenever practical:

- company zones
- prefab instances
- seat registry
- employee scene zone resolution
- runtime agent state
- ceremony-derived emphasis

Do **not** redesign the data model unless the current boundary makes the renderer impossible to keep clean.

If a shaping layer is needed, add a **thin scene view-model adapter**, not a data-model rewrite.

---

## 12. Performance rules

The new 2D scene should be materially better under load than the SVG path.

Minimum expectations:

- no large React SVG tree per scene frame
- redraw strategy should be intentional
- hover/selection should not trigger expensive whole-scene React churn
- avatar/image handling should use caching
- degraded mode should prefer simplified draw paths over feature spam

If a frame loop is used, keep it scoped and explain when redraws occur.

---

## 13. Migration strategy

This should be delivered in phases, not as one blind rewrite.

### Phase A — Static canvas parity

Goal:

- render rooms, prefabs, and employees in canvas
- no interaction parity required yet beyond basic selection plumbing

Must prove:

- data can be shaped cleanly for canvas
- scene visually reads better than the old SVG baseline

### Phase B — Interaction parity

Goal:

- selection
- hover
- hit testing
- drag-to-assign

Must prove:

- the main office interaction loop still works

### Phase C — State and ceremony parity

Goal:

- blocked / busy / reporting / success cues
- meeting / activity emphasis
- reduced clutter compared to SVG

Must prove:

- the scene still communicates runtime state clearly

### Phase D — Remove old SVG main path

Goal:

- old SVG 2D path is deleted so canvas is the only supported 2D main path

Rule:

- do not leave two equal "main" renderers in place indefinitely

---

## 14. Acceptance criteria

The migration is complete only when all of the following are true:

1. `2D` mode uses canvas as the primary renderer
2. `SceneCanvas` integration still works without routing churn
3. users can still select employees and clear selection
4. drag-to-assign still works end-to-end
5. scene state is at least as readable as the current implementation
6. the visual result is clearly stronger than the current SVG version
7. the old SVG 2D main path is removed
8. no new feature work continues on the old SVG renderer

---

## 15. Implementation constraints for the next agent

The next implementation agent should follow these guardrails:

- do not spend time polishing the old SVG path
- do not rewrite 3D
- do not rewrite office editor unless strictly required
- prefer a small number of focused files over another monolithic scene component
- preserve current product behavior before inventing new scene semantics
- do not reintroduce a hidden or temporary SVG fallback for the main 2D scene

---

## 16. Handoff note

This spec is intentionally written as an execution handoff for Kiro / Claude Opus.

The goal is not to debate whether canvas is better.

That decision is already made:

- **move 2D scene rendering from SVG to canvas**
- **keep DOM for overlays**
- **stop investing in the SVG 2D path**
