# Studio Editor Quality Pass — Fix All Skill Violations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 9 severe missing features and 9 implementation violations identified by auditing Studio code against `.claude/skills/studio-editor-design.md`.

**Architecture:** Incremental fixes to existing Studio components. No new files except `StudioStatusBar.tsx`. All changes follow the design token system in `studio-tokens.ts`.

**Tech Stack:** React 19, Three.js 0.183, @react-three/fiber 9.5, @react-three/drei, Zustand

**Skill reference:** `.claude/skills/studio-editor-design.md`

---

## Task 1: Ghost Material + Footprint + Fix useFrame Loop (Skill §1, §7, §11, §12)

**Priority:** Critical

**Files:**
- Modify: `packages/ui-office/src/components/studio/StudioGhost.tsx`

**What to do:**

### 1a. Ghost material replacement

On mount (when `placingPrefab` changes), create TWO `MeshStandardMaterial` instances at the component level:

```typescript
const validMat = useMemo(() => new THREE.MeshStandardMaterial({
  color: STUDIO_COLORS.ghostValid,
  emissive: STUDIO_COLORS.ghostValid,
  emissiveIntensity: 0.6,
  transparent: true, opacity: 0.4,
  depthWrite: false, side: THREE.DoubleSide,
}), []);

const blockedMat = useMemo(() => new THREE.MeshStandardMaterial({
  color: STUDIO_COLORS.ghostBlocked,
  emissive: STUDIO_COLORS.ghostBlocked,
  emissiveIntensity: 0.6,
  transparent: true, opacity: 0.35,
  depthWrite: false, side: THREE.DoubleSide,
}), []);
```

In a `useEffect` on `[placingPrefab]`, traverse the ghost group and replace every child mesh's material with `validMat`. Dispose in cleanup.

In `useFrame`, do NOT traverse — only swap material references on the meshes when `blockedRef.current` changes (track with `prevBlockedRef`):

```typescript
useFrame(() => {
  if (!placingPrefab || !groupRef.current) return;
  const isBlocked = blockedRef.current;
  if (isBlocked === prevBlockedRef.current) return; // no change, skip
  prevBlockedRef.current = isBlocked;
  const mat = isBlocked ? blockedMat : validMat;
  groupRef.current.traverse((child) => {
    if (child instanceof THREE.Mesh) child.material = mat;
  });
});
```

This traverses ONLY when blocked state changes (rare event), not every frame.

### 1b. Fix ring pulse + invalidate loop

The ring pulse animation in `useFrame` calls `invalidate()` every frame, creating an infinite render loop in `frameloop="demand"`. Fix: remove `invalidate()` from the ring `useFrame`. The ring animation only needs to run when ghost is visible — `onPointerMove` already calls `invalidate()`.

If ring pulse animation is desired, conditionally enable it only when ghost is visible, and do NOT call invalidate from within useFrame. The `InvalidateBridge` in StudioCanvas already handles store-driven invalidation.

### 1c. Fix inline geometry

Replace `<edgesGeometry args={[new THREE.PlaneGeometry(...)]} />` with `useMemo`:

```typescript
const footprintGeo = useMemo(
  () => new THREE.EdgesGeometry(new THREE.PlaneGeometry(gridW * 2.5, gridD * 2.5)),
  [gridW, gridD],
);
```

### 1d. Fix footprint Y position

Change filled plane from `y=0.01` to `y=0.02`.

### 1e. Make footprint color reactive to collision

The filled plane and wireframe border materials must also change with collision state. Use refs to the materials and update in the same `useFrame` that handles ghost material swap.

### 1f. Set layers on ghost group

Ghost group and invisible floor mesh should be on Layer 1 (not pickable):

```typescript
<group ref={groupRef} visible={false} layers={1}>
```

And the invisible floor mesh:
```typescript
<mesh ... layers={1}>
```

This prevents hover events on placed prefabs from being intercepted by ghost geometry.

**Verify:** `pnpm --filter @aics/ui-office typecheck`

**Commit:** `fix: ghost material strategy, footprint reactive color, fix useFrame loop, layers`

---

## Task 2: Collision Rotation + Selection Guards + Pre-allocate (Skill §1, §2, §7)

**Priority:** Critical

**Files:**
- Modify: `packages/ui-office/src/components/studio/StudioGhost.tsx` (checkOverlap function)
- Modify: `packages/ui-office/src/components/studio/StudioPlacedPrefabs.tsx`
- Modify: `packages/ui-office/src/components/studio/StudioState.tsx` (add ghostRotation)

**What to do:**

### 2a. Add ghostRotation to store

Add `ghostRotation: 0 | 90 | 180 | 270` to `StudioStore`. Default 0. Reset on `cancelPlacement`. R key increments it. Used by ghost for visual rotation and collision detection.

### 2b. Fix checkOverlap for rotation

```typescript
function getRotatedSize(gridW: number, gridD: number, rotation: number): [number, number] {
  return (rotation % 180 === 0) ? [gridW, gridD] : [gridD, gridW];
}
```

Apply to both ghost's own size AND each existing instance's size in the AABB test.

### 2c. Selection tool guard

In `StudioPlacedPrefabs.tsx`, add to click handler:

```typescript
const tool = useStudioStore.getState().tool;
if (tool !== 'select' && tool !== 'move' && tool !== 'rotate') return;
```

### 2d. Pre-allocate Vector3/Euler

At module scope in StudioPlacedPrefabs.tsx:

```typescript
const _pos = new THREE.Vector3();
const _euler = new THREE.Euler();
```

Use in `handleObjectChange` instead of `new THREE.Vector3()` / `new THREE.Euler()`.

**Verify:** `pnpm --filter @aics/ui-office typecheck`

**Commit:** `fix: collision handles rotation, selection respects tool, pre-allocate objects`

---

## Task 3: Hover Feedback (Skill §10)

**Priority:** High

**Files:**
- Modify: `packages/ui-office/src/components/studio/StudioPlacedPrefabs.tsx`

**What to do:**

Add `onPointerOver` and `onPointerOut` to `PlacedPrefabItem` group. Use `gl.domElement.style.cursor` (NOT `document.body.style.cursor`):

```typescript
const { gl, invalidate } = useThree();

// In PlacedPrefabItem — need to pass gl and invalidate as props or use useThree inside
onPointerOver={(e) => {
  e.stopPropagation();
  const tool = useStudioStore.getState().tool;
  if (tool !== 'select' && tool !== 'move' && tool !== 'rotate') return;
  (e.eventObject as THREE.Group).traverse((child) => {
    if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
      child.material.emissiveIntensity = 0.08;
      child.material.emissive.set('#ffffff');
    }
  });
  gl.domElement.style.cursor = 'pointer';
  invalidate();
}}
onPointerOut={(e) => {
  e.stopPropagation();
  (e.eventObject as THREE.Group).traverse((child) => {
    if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
      child.material.emissiveIntensity = 0;
    }
  });
  gl.domElement.style.cursor = 'default';
  invalidate();
}}
```

Note: `PlacedPrefabItem` is memoized. `useThree()` can only be called in components inside `<Canvas>`. Since `PlacedPrefabItem` is rendered inside Canvas, `useThree()` works. But it must be called at the top of the component function, not inside event handlers. Pass `gl` and `invalidate` as props or call `useThree()` inside the memo component.

**Verify:** `pnpm --filter @aics/ui-office typecheck`

**Commit:** `feat: hover feedback — emissive highlight + pointer cursor`

---

## Task 4: Status Bar via DOM Ref (Skill §13)

**Priority:** High

**Files:**
- Modify: `packages/ui-office/src/components/studio/StudioPlotSelector.tsx` (merge status info into bottom bar)
- Modify: `packages/ui-office/src/components/studio/StudioGhost.tsx` (write mouse coords to DOM ref)
- Modify: `packages/ui-office/src/components/studio/StudioPage.tsx` (pass DOM ref)

**What to do:**

**Do NOT use Zustand for mouse position** — `onPointerMove` is too high-frequency. Instead:

1. Create a `ref` for the coordinate display element in StudioPage:
```typescript
const coordsRef = useRef<HTMLSpanElement>(null);
```

2. Pass it down to StudioGhost (via prop or context). In `onPointerMove`, write directly to DOM:
```typescript
if (coordsRef.current) {
  coordsRef.current.textContent = `X: ${x.toFixed(1)}  Z: ${z.toFixed(1)}`;
}
```

3. Merge status info into StudioPlotSelector bottom bar (don't create separate status bar — keep it simple):
- Left section: selection info ("N items" + selected instance name if any)
- Center: `<span ref={coordsRef}>` for coordinates (updated via DOM ref, zero re-renders)
- Right section: plot size buttons (existing)

This gives status info without any React re-renders on mouse move.

**Verify:** `pnpm --filter @aics/ui-office typecheck`

**Commit:** `feat: status bar with coordinates, selection info (DOM ref, zero re-renders)`

---

## Task 5: Dirty Dot + beforeunload + Animations (Skill §14, §15)

**Priority:** Medium

**Files:**
- Modify: `packages/ui-office/src/components/studio/StudioToolbar.tsx` (dirty dot)
- Modify: `packages/ui-office/src/components/studio/StudioPage.tsx` (beforeunload)

**What to do:**

### 5a. Dirty amber dot

In StudioToolbar, on the Save button, when `dirty && !saveFlash`, render a small absolute-positioned div:

```typescript
{dirty && !saveFlash && (
  <div style={{
    position: 'absolute', top: -2, right: -2,
    width: 6, height: 6, borderRadius: '50%',
    background: '#f59e0b',
  }} />
)}
```

The Save button needs `position: 'relative'` to contain the dot.

### 5b. beforeunload

In StudioPage, add:

```typescript
const dirty = useStudioStore((s) => s.dirty);

useEffect(() => {
  if (!dirty) return;
  const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
  window.addEventListener('beforeunload', handler);
  return () => window.removeEventListener('beforeunload', handler);
}, [dirty]);
```

### 5c. Animations (optional — implement if straightforward)

Place success scale bounce and delete fade are nice-to-have. If complex to integrate with R3F's demand rendering, skip and add TODO comments referencing Skill §14 timings.

**Verify:** `pnpm --filter @aics/ui-office typecheck`

**Commit:** `feat: dirty indicator, beforeunload warning`

---

## Task 6: Camera Focus/Home + Token Fixes + Icon-Only Toolbar (Skill §3, §4, §8, §16)

**Priority:** Medium

**Files:**
- Modify: `packages/ui-office/src/components/studio/StudioCanvas.tsx`
- Modify: `packages/ui-office/src/components/studio/StudioPage.tsx`
- Modify: `packages/ui-office/src/components/studio/StudioProperties.tsx`
- Modify: `packages/ui-office/src/components/studio/StudioPlacedPrefabs.tsx`
- Modify: `packages/ui-office/src/components/studio/StudioToolbar.tsx`

**What to do:**

### 6a. Camera Focus (F key) — instant jump, no animation library

In StudioCanvas, store OrbitControls ref via `useRef` and expose a `focusOn(position)` callback via a new `onFocusRef` prop:

```typescript
interface StudioCanvasProps {
  children?: React.ReactNode;
  focusRef?: React.MutableRefObject<((pos: [number,number,number]) => void) | null>;
}
```

Inside StudioCanvas scene, `<OrbitControls ref={orbitRef} .../>`. Assign to focusRef:
```typescript
useEffect(() => {
  if (focusRef) {
    focusRef.current = (pos) => {
      if (orbitRef.current) {
        orbitRef.current.target.set(pos[0], pos[1], pos[2]);
        camera.position.set(pos[0] + 10, 10, pos[2] + 10);
        orbitRef.current.update();
        invalidate();
      }
    };
  }
}, [focusRef, camera, invalidate]);
```

In StudioPage, on F key:
```typescript
case 'f': case 'F': {
  const sel = store.selectedInstanceId;
  if (sel && focusRef.current) {
    const inst = store.instances.find(i => i.id === sel);
    if (inst) focusRef.current(inst.position);
  }
  break;
}
```

### 6b. Home key — reset to default

```typescript
case 'Home': {
  if (focusRef.current) focusRef.current([0, 0, 0]);
  break;
}
```

### 6c. Fix ORIGIN type cast

Replace `target={ORIGIN as unknown as THREE.Vector3}` with just `target={[0, 0, 0]}` — R3F/drei accepts number tuples natively.

### 6d. Token fixes

Replace all remaining hardcoded hex values:
- `StudioProperties.tsx`: `'#f87171'` → `STUDIO_COLORS.error`, `'#fca5a5'` → `STUDIO_COLORS.error`
- `StudioPlacedPrefabs.tsx` Html labels: `'#a5b4fc'` → `STUDIO_COLORS.accentText`, `'#94a3b8'` → `STUDIO_COLORS.textSecondary`
- `StudioGhost.tsx` Html label: `'#22c55e'` → `STUDIO_COLORS.success`

### 6e. Icon-only toolbar

Remove `<span>{t.label}</span>` from tool buttons. Keep `aria-label` for accessibility. Keep Back button text (exception — Back needs text for clarity since it's not a standard tool).

**Verify:** `pnpm --filter @aics/ui-office typecheck`

**Commit:** `feat: F/Home camera, fix type cast, token fixes, icon-only toolbar`

---

## Summary

| Task | What | Priority | Key Fixes |
|------|------|----------|-----------|
| 1 | Ghost material + footprint + useFrame fix + layers | Critical | §1,§7,§11,§12 |
| 2 | Collision rotation + selection guard + pre-allocate | Critical | §1,§2,§7 |
| 3 | Hover feedback (emissive + cursor) | High | §10 |
| 4 | Status bar via DOM ref | High | §13 |
| 5 | Dirty dot + beforeunload | Medium | §14,§15 |
| 6 | Camera F/Home + tokens + icon-only | Medium | §3,§4,§8,§16 |

**Dependencies:**
- Task 1 and Task 4: independent, can parallel (different files except StudioGhost — Task 4 adds coord writing to onPointerMove, Task 1 changes material logic. Both modify StudioGhost but different sections.)
- Task 2: independent of Task 1 (different functions in same file, but separable)
- Task 3: should run after Task 2 (selection guard must exist before hover logic)
- Task 5: independent
- Task 6: independent

**Safest execution order:** Task 1 → Task 2 → Task 3 → Tasks 4+5+6 in parallel
