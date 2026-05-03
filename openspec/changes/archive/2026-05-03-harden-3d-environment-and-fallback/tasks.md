## 1. Procedural envmap hook

- [x] 1.1 Create `packages/ui-office/src/components/scene/use-procedural-room-environment.ts` exporting `useProceduralRoomEnvironment(active: boolean): void`. Inside: `const { gl, scene } = useThree()`; `useEffect [active, gl]` — when `active`, build `new RoomEnvironment(gl)` (import from `three/examples/jsm/environments/RoomEnvironment.js`), build `new THREE.PMREMGenerator(gl)`, `const tex = pmrem.fromScene(env, 0.04).texture`, `scene.environment = tex`; cleanup function disposes `tex`, `pmrem`, sets `scene.environment = null` only if `scene.environment === tex` (don't clobber external setter).
- [x] 1.2 In `scene-lighting-rig.tsx`, remove `import { Environment } from '@react-three/drei'` and the `<Environment preset={...} />` JSX. Add `import { useProceduralRoomEnvironment } from './use-procedural-room-environment'` and call `useProceduralRoomEnvironment(environmentEnabled)` inside `SceneLightingRig`.
- [x] 1.3 Verify `scene-lighting-rig.tsx` no longer imports `@react-three/drei` `Environment` and no other lights / `<Environment>` JSX exist outside the rig.

## 2. SceneCanvas reducer + props

- [x] 2.1 In `packages/ui-office/src/components/scene/SceneCanvas.tsx`, replace `useState<boolean>('force2D')` + `useRef<number>('crashCountRef')` with a single `useReducer` driving `FallbackState = { force2D: boolean; crashCount: number; lastError: string | null }`. Define `FallbackAction` union (`reportCrash` | `requestRetry` | `viewModeBumped` | `fpsTierOff`) and reducer transitions per design.md Decision 2 + spec delta. (`fpsTierOff` added during apply: FPS-driven force2D path must not bump crashCount — preserves pre-existing semantics — spec delta updated accordingly.)
- [x] 2.2 Update inner `<SceneErrorBoundary onError={...}>` callback to `dispatch({ type: 'reportCrash', error })`.
- [x] 2.3 Add non-optional prop `viewModeNonce: number` to `SceneCanvasProps`. Add a `useRef<number | null>(null)` initial-skip guard + `useEffect [viewModeNonce]` that dispatches `{ type: 'viewModeBumped' }` after the initial render.
- [x] 2.4 Remove the legacy `useEffect [viewMode]` that conditionally reset `setForce2D(false)` based on `crashCountRef < 2` (replaced by viewModeBumped pathway).
- [x] 2.5 Derive `effectiveViewMode = state.force2D ? '2D' : viewMode` (unchanged semantics, sourced from reducer state).

## 3. SceneErrorPanel + SceneFallbackBadge

- [x] 3.1 Create `packages/ui-office/src/components/scene/scene-error-panel.tsx` exporting `SceneErrorPanel({ error, onRetry })` function component. Use `useSceneColors().sceneBackground` for inline `style={{ backgroundColor }}`. Compose `<Alert variant="destructive">` + `AlertTitle` + `AlertDescription` from `@offisim/ui-core` for the inner card; retry button uses `bg-surface-muted text-text-primary hover:bg-surface-hover`. No raw hex / rgba.
- [x] 3.2 In `SceneCanvas.tsx`, refactor `SceneErrorBoundary.render()` to return `<SceneErrorPanel error={state.error} onRetry={() => this.setState({hasError:false, error:''})} />` instead of inline `<div>`. Remove the inline div.
- [x] 3.3 Create `packages/ui-office/src/components/scene/scene-fallback-badge.tsx` exporting `SceneFallbackBadge({ onRetry })` function component. `<button>` styled via `cn(badgeVariants({ variant:'warning', size:'sm' }), 'absolute right-3 bottom-3 z-10 gap-2 transition-opacity hover:opacity-80')` from `@offisim/ui-core`. Content: `<span>3D unavailable</span><span aria-hidden>·</span><span className="font-semibold">Retry</span>`.
- [x] 3.4 In `SceneCanvas.tsx`, render `<SceneFallbackBadge onRetry={() => dispatch({type:'requestRetry'})} />` inside the outer wrapper `<div className="h-full w-full ...">` when `viewMode === '3D' && state.force2D`.
- [x] 3.5 Confirm `SceneCanvas.tsx` no longer carries any `// raw-hex-allowed-file:` header (it did not in the touched baseline; preserved that state).

## 4. Wire viewModeNonce through props chain

- [x] 4.1 Toggle button click handler bumps `viewModeNonce` on every click (including same-value). Implementation: `SegmentedControl` gained a non-breaking `onSelectClick?: (value) => void` prop that fires on every segment click before the selected-skip; `Header.ViewModeToggle` accepts an `onSegmentClick` prop and threads to `SegmentedControl.onSelectClick`; `Header` props add `onViewModeClick` and forward to both desktop and narrow `ViewModeToggle` placements; `useOfficeStateBindings` exposes `viewModeNonce: number` + `onViewModeClick: () => void` (value-agnostic — bumps state). `useAppKeyboardShortcuts` Cmd/Ctrl+1 also calls `onViewModeClick()` (no arg) so the explicit-retry signal fires from keyboard too without re-binding the listener on every viewMode change.
- [x] 4.2 `viewModeNonce` threaded `App.tsx` → `AppMainShell` → `OfficeSceneSurface` → `SceneCanvas`. `OfficeSceneSurface` exposes `viewModeNonce: number` as a non-optional prop; `AppMainShell` passes `viewModeNonce={viewModeNonce}` and `onViewModeClick` from `useOfficeStateBindings`; lazy `SceneCanvas` consumes `viewModeNonce`.

## 5. Token gate + lint

- [x] 5.1 `pnpm tokens:lint-hex` exits 0 — no violations from `SceneCanvas.tsx` / new files.
- [x] 5.2 `grep -l '^// raw-hex-allowed-file:' packages/ui-office/src/components/scene/SceneCanvas.tsx | wc -l` returns 0.

## 6. Build + typecheck

- [x] 6.1 Dependency-ordered serial build green: `pnpm --filter @offisim/shared-types build` → `pnpm --filter @offisim/ui-core build` → `pnpm --filter @offisim/core build` → `pnpm --filter @offisim/ui-office build` → `pnpm --filter @offisim/web build`. All exit 0.
- [x] 6.2 `pnpm typecheck` — 26/26 tasks pass, exit 0.
- [x] 6.3 `pnpm exec biome check` on changed files — 0 errors / warnings (incl. opportunistic format cleanup applied to `scene-lighting-rig.tsx`).

## 7. Self live verify (web SPA in browser)

- [x] 7.1 Started web dev server on `http://localhost:5176` via `pnpm --filter @offisim/web dev`.
- [x] 7.2 Navigated to `http://localhost:5176/`, `Studio Edit Co` company auto-loaded with 9 employees populated (`01-light-3d-baseline.png`).
- [x] 7.3 Switched to dark theme via Settings → Runtime → Theme → Dark, returned to office, scene re-rendered (`02-dark-3d-procedural-envmap.png`). PBR reflections visible on floor; **0 console errors**, **0 HDR/CDN fetch** (`performance.getEntriesByType('resource')` filtered for `lebombo|hdr|cdn\.digitaloceanspaces|market-assets` returns empty array). Procedural envmap proven offline-safe.
- [x] 7.4 Switched dark→light and back, scene re-renders cleanly each time, no envmap-related console errors.
- [x] 7.5 SceneErrorPanel visual verified via DOM-level harness mirroring component JSX 1:1 (Alert destructive variant + sceneBackground inline style). Light theme background = `LIGHT_SCENE_3D.sceneBackground` (#e8edf4); dark theme background = `DARK_SCENE_3D.sceneBackground` (#020617). `04-dark-error-panel-and-badge.png` + `06-light-panel-and-badge.png` capture both. The harness uses identical Tailwind classes as the React component emits. Triggering the React boundary at runtime via `WEBGL_lose_context` was attempted but r3f swallows context loss without propagating — see report.md "Tasks deferred" section.
- [x] 7.6 SceneFallbackBadge visual verified in same harness (`05-dark-panel-and-badge.png` + `06-light-panel-and-badge.png`). Warning chip "3D unavailable · Retry" anchored bottom-right; `border-warning bg-warning-muted text-warning` tokens render as expected amber/orange in both themes.
- [ ] 7.7 SceneFallbackBadge click → 3D re-mount loop. **Deferred to user verify** (organic crash or fiber-level inject required — r3f did not propagate WEBGL_lose_context to the SceneErrorBoundary). Code-path verified: badge `onClick → dispatch({type:'requestRetry'})` is a one-line direct dispatch.
- [x] 7.8 In normal state (`force2D === false`) badge is NOT rendered — implicitly verified by baseline screenshots `01-light-3d-baseline.png` / `02-dark-3d-procedural-envmap.png` / `07-light-3d-clean.png`, none of which contain the SceneFallbackBadge DOM. Render gate `viewMode === '3D' && state.force2D` evaluates to false; pre-fix UI showed nothing extra. Verified across both themes.
- [ ] 7.9 Force2D ghost-state → 3D toggle bump → reset. **Deferred to user verify** (same blocker as 7.7). Wiring proven by typecheck (26/26) and `SegmentedControl.onSelectClick` always firing on click.
- [x] 7.10 Verification screenshots saved under `.live-verify/harden-3d-environment-and-fallback/` with `report.md` summarizing each scenario, deferred items, and root-cause evidence.

## 8. Spec / docs / memory sync (Archive Gate prep)

- [x] 8.1 `openspec validate harden-3d-environment-and-fallback --strict` — change is valid (re-run after spec delta update for `fpsTierOff` action).
- [x] 8.2 `packages/ui-office/CLAUDE.md` "UI / Scene / 3D" section updated: SceneCanvas fallback contract bullet now describes `useReducer` (4 actions) + `viewModeNonce` + `SceneFallbackBadge`; lighting rig bullet notes envmap is `useProceduralRoomEnvironment` + `RoomEnvironment` + `PMREMGenerator` (no CDN HDR).
- [x] 8.3 `MEMORY.md`-side `project_ux_9_bucket_queue.md` updated under 桶 2a entry to flag `harden-3d-environment-and-fallback` as the dependency-closure change for HDR root cause; bucket 2a release-verify 9.4/9.8 retest now unblocked.
- [x] 8.4 `openspec/protocols-ledger.md` audit: row 13 (Three.js / R3F) is in watch-list (non-active alignment table). Change consumes `RoomEnvironment` + `PMREMGenerator` from `three/examples/jsm/` — both stable Three.js core APIs. Removing drei `<Environment>` wrapper does not change protocol surface. No row update needed.
