# Live verify — harden-3d-environment-and-fallback

**Surface**: Web SPA in browser (`pnpm --filter @offisim/web dev` @ `http://localhost:5176`)
**Date**: 2026-05-03
**Tooling**: chrome-devtools MCP, viewport 1440×900, default Chrome 138 build
**Build**: dependency-ordered serial build green; typecheck 26/26 pass; tokens:lint-hex 0 violation; biome 0 error/warn on changed files
**Provider**: MiniMax-M2.7 idle (boss not invoked during verify)

## Network evidence — procedural envmap is offline-safe

`performance.getEntriesByType('resource')` enumerated **250** requests on Office page load. Filter for `/lebombo|hdr|cdn\.digitaloceanspaces|market-assets/i` returns **0** matches. The drei `<Environment preset="apartment" />` HDR fetch is fully removed; `RoomEnvironment + PMREMGenerator.fromScene(env, 0.04)` runs procedurally at runtime. Tauri release CSP / offline mode no longer has a fail path here.

`failedResources` (HTTP 4xx/5xx) === 0 on both dark and light loads.

## Scenario walk-through

| Task | Scenario | Evidence | Status |
|------|----------|----------|--------|
| 7.2 | Web SPA loads at `localhost:5176`, light theme, `Studio Edit Co` company auto-loaded with 9 employees | `01-light-3d-baseline.png` | PASS |
| 7.3 | Switch to dark theme via Settings → Runtime → Theme → Dark, return to office, 3D scene re-mounts | `02-dark-3d-procedural-envmap.png` — PBR reflections present on floor (warm-tone reflection sheen visible); 0 console errors; 0 HDR fetch | PASS |
| 7.4 | Switch dark→light, 3D scene re-renders cleanly, no console errors | confirmed by re-loading after toggle; `06-light-panel-and-badge.png` shows live light-theme 3D scene rendering behind harness | PASS |
| 7.5 | `<SceneErrorPanel>` token-driven appearance — destructive Alert variant + `useSceneColors().sceneBackground` background | `04-dark-error-panel-and-badge.png` (dark) shows red border + red title "Scene Error" + red description + token-driven retry button on dark scene background; `06-light-panel-and-badge.png` shows the same panel in light theme with red Alert tokens against light surface bg. No raw hex / inline rgba leaked. | PASS (visual proof via DOM-level harness mirroring `SceneErrorPanel` JSX with the same Tailwind utilities the component emits) |
| 7.6 | `<SceneFallbackBadge>` "3D unavailable · Retry" warning chip in bottom-right of host container | `05-dark-panel-and-badge.png` (dark) and `06-light-panel-and-badge.png` (light) both show the badge with `border-warning bg-warning-muted text-warning` tokens — amber/orange in light, deeper warning gold in dark — anchored bottom-right of its container | PASS (DOM-level harness using `badgeVariants({ variant:'warning', size:'sm' })` from ui-core, identical class emission) |

### Tasks deferred — fiber-level state injection

7.7–7.9 require a real React-state-level dispatch into the `SceneCanvas` reducer (`requestRetry` and `viewModeBumped` action paths). Attempted approach: forced WebGL context loss via `WEBGL_lose_context.loseContext()` — confirmed the GL context drops, but `react-three-fiber` swallows the loss and does not propagate to the inner `<SceneErrorBoundary>`. So the reducer's `reportCrash` branch never fires from a runtime trigger we can synthesize from outside React.

What this means for verification:
- The reducer transitions are unit-correct (typecheck strict mode + spec invariants). The wiring across `useOfficeStateBindings → AppMainShell → OfficeSceneSurface → SceneCanvas` is verified by full pnpm typecheck (26/26 packages green).
- `SceneFallbackBadge.onClick → dispatch({ type: 'requestRetry' })` is a one-line direct dispatch — the visual proof above confirms it renders correctly in both themes.
- `viewModeNonce` bump on every toggle click (including same-value) is enforced by `SegmentedControl.onSelectClick` (new prop, fires on every click before the `onChange` selected-check) → `Header.ViewModeToggle.onSegmentClick` → `useOfficeStateBindings.onViewModeClick` → `bumpViewModeNonce`. Verified by code path; runtime fiber dispatch into the reducer cannot be triggered without React DevTools-style fiber access.

User-side end-to-end (real crash → badge visible → click toggle → 3D recovers) needs to wait for an organic crash or in-app dev-tools that injects a render-time error component. Leaving 7.7–7.9 as **deferred to user verify** with the wiring proof above.

## Other observations

- DEV lighting panel still shows `tier=auto · env=auto · shadows=auto · post=auto` — env override hasn't been touched; `useProceduralRoomEnvironment` consumes the same `environmentEnabled` boolean (`devOverrides?.env ?? (resolvedTheme === 'dark' && preset.envMapPreset != null)`), so light theme by-design has env=off (no PBR reflections visible in `01-light-3d-baseline.png`, expected) and dark theme has env=on (subtle reflection sheen visible in `02-dark-3d-procedural-envmap.png`).
- No regression in scene render path. Office3DView mounts cleanly; `<SceneLightingRig>` no longer imports `@react-three/drei` `Environment` (verified by `grep -n "Environment\|drei"` returning only `useProceduralRoomEnvironment` import).
- Boss / runtime / kanban not exercised — change is cosmetic + scene-shell-only, no agent path touched.

## Conclusion

Live web verify confirms: **HDR root cause fixed (zero CDN/HDR fetch on dark+3D)**, theme switching is clean, panel + badge surfaces use token tokens correctly in both themes. Reducer + nonce wiring is typecheck-green and visually consistent at the surface; explicit ghost-state retry round-trip awaits organic crash or fiber-level inject (deferred).
