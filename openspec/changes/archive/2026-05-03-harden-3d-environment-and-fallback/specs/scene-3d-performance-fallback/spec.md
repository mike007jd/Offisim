## MODIFIED Requirements

### Requirement: tier='off' transitions to 2D fallback after 3 seconds

When `sampledFps < 15` for any single frame, the hook SHALL set
the candidate tier to `'off'`. When the tier remains `'off'`
for `>= 3` consecutive seconds (180 frames at 60 fps;
sample-clock based, not frame-count based, to handle low-fps
correctly), the hook SHALL invoke a `requestForce2D` callback
provided by the consumer. `SceneCanvas` SHALL set
`force2D = true` (via its internal fallback-state reducer) in response.

If `sampledFps` recovers above 15 before the 3-second window
elapses, the hook SHALL cancel the pending 2D request.

#### Scenario: 2D fallback fires after 3 s at tier='off'

- **WHEN** `sampledFps < 15` for 3 consecutive seconds
- **THEN** `requestForce2D()` is invoked exactly once
- **AND** `SceneCanvas` transitions to 2D rendering

#### Scenario: Recovery before 3 s cancels the 2D request

- **WHEN** `sampledFps` falls below 15 for 2 seconds
- **AND** then rises above 15 for the third second
- **THEN** `requestForce2D()` is NOT invoked
- **AND** the tier transitions back to `'low'` or higher
  according to the standard mapping

#### Scenario: Crash floor accumulates but does not gate explicit user retry

- **WHEN** the 3D scene throws 2 or more errors and the internal fallback-state reducer's `crashCount >= 2`
- **THEN** `SceneCanvas` keeps `force2D === true` until an explicit user retry signal is received
- **AND** the FPS-driven tier path is bypassed while `force2D === true`
- **WHEN** an explicit user retry signal arrives (`viewModeNonce` bump or `<SceneFallbackBadge>` click)
- **THEN** the reducer dispatches `requestRetry`, resetting `crashCount = 0` and `force2D = false`
- **AND** the next render attempts 3D again

## ADDED Requirements

### Requirement: SceneCanvas SHALL own a single fallback-state reducer

`SceneCanvas` SHALL replace its previous `useState<boolean>` + `useRef<number>` pair (`force2D`, `crashCountRef`) with a single `useReducer` driving:

```ts
type FallbackState = {
  force2D: boolean;
  crashCount: number;
  lastError: string | null;
};
type FallbackAction =
  | { type: 'reportCrash'; error: Error }
  | { type: 'fpsTierOff' }
  | { type: 'requestRetry' }
  | { type: 'viewModeBumped' };
```

Reducer transitions:
- `reportCrash`: `crashCount += 1`, `force2D = true`, `lastError = error.message`
- `fpsTierOff`: `force2D = true` (idempotent); `crashCount` and `lastError` unchanged. This action carries the FPS-driven performance signal from `useScenePerformanceTier` (3 s sustained `tier='off'`) and SHALL NOT bump the crash floor — it is a perf degradation, not an exception.
- `requestRetry`: `crashCount = 0`, `force2D = false`, `lastError = null`
- `viewModeBumped`: same as `requestRetry`

The `SceneErrorBoundary` `onError` callback SHALL dispatch `reportCrash`. The 3D `onRequestForce2D` callback wired to `useScenePerformanceTier` SHALL dispatch `fpsTierOff`. No code outside the reducer SHALL mutate `force2D` or `crashCount`.

#### Scenario: Reducer is the only writer of force2D / crashCount

- **WHEN** searching `SceneCanvas.tsx` for direct mutations of `force2D` or `crashCount`
- **THEN** all mutations go through the reducer's three actions
- **AND** there is no `useState<boolean>('force2D')` or `useRef<number>('crashCount')` in the file

#### Scenario: Crash dispatch updates state atomically

- **WHEN** the inner `<SceneErrorBoundary>` catches an error
- **THEN** `dispatch({ type: 'reportCrash', error })` fires exactly once
- **AND** the next render reads `force2D === true`, `crashCount === <prev + 1>`, `lastError === error.message`

### Requirement: Explicit user retry SHALL always reset force2D regardless of crashCount

The 3D / 2D toggle in `OfficeSceneSurface` SHALL bump a numeric `viewModeNonce` on every click — even when `viewMode` does not change value. `SceneCanvas` SHALL accept `viewModeNonce: number` as a non-optional prop.

`SceneCanvas` SHALL `useEffect [viewModeNonce]` (skipping the initial render via a `useRef` guard) and dispatch `{ type: 'viewModeBumped' }`. The `viewModeBumped` action SHALL reset `force2D` and `crashCount` regardless of the current `crashCount` value (including `>= 2`).

The `<SceneFallbackBadge>` click handler SHALL dispatch `{ type: 'requestRetry' }` directly, with the same effect.

#### Scenario: Bumping viewModeNonce resets force2D after multiple crashes

- **WHEN** the 3D scene has crashed 3 times and `state.crashCount === 3`, `state.force2D === true`
- **WHEN** the user clicks the 3D toggle button (which bumps `viewModeNonce` by 1)
- **THEN** the next render dispatches `viewModeBumped`
- **AND** `state.force2D === false`, `state.crashCount === 0`, `state.lastError === null`
- **AND** `effectiveViewMode === '3D'`

#### Scenario: Bumping viewModeNonce when viewMode prop did not change still resets

- **WHEN** `viewMode === '3D'` and `viewModeNonce === 7` and force2D became true via crash
- **WHEN** the parent bumps to `viewModeNonce === 8` without changing `viewMode`
- **THEN** the reducer receives `viewModeBumped` and resets force2D

#### Scenario: SceneFallbackBadge click resets

- **WHEN** the SceneFallbackBadge is rendered and the user clicks it
- **THEN** the click handler dispatches `requestRetry`
- **AND** `state.force2D === false`, `state.crashCount === 0`

### Requirement: Force-2D ghost state SHALL surface a visible affordance

When `viewMode === '3D'` (user has selected 3D in the toggle) and `effectiveViewMode === '2D'` (force2D is active because of crash or FPS-tier-off), `SceneCanvas` SHALL render a `<SceneFallbackBadge>` overlay on top of the 2D canvas in the bottom-right corner. The badge SHALL display "3D unavailable · Retry" and SHALL be clickable to trigger a retry.

The badge SHALL NOT render when:
- `viewMode === '2D'` (user explicitly chose 2D — no ghost state)
- `effectiveViewMode === '3D'` (no fallback active)

The badge SHALL use token-driven colors only (`bg-warning-muted`, `text-warning`, `border-warning` Tailwind utilities resolved via `@theme inline`). No raw hex / rgba literals.

#### Scenario: Badge appears in ghost state

- **WHEN** `viewMode === '3D'` and the 3D scene has crashed (`force2D === true`)
- **THEN** the rendered DOM contains a `<button>` matching "3D unavailable" + "Retry" positioned `absolute bottom-3 right-3`

#### Scenario: Badge is hidden in normal 3D

- **WHEN** `viewMode === '3D'` and `force2D === false`
- **THEN** the SceneFallbackBadge is not in the rendered DOM

#### Scenario: Badge is hidden when user chose 2D

- **WHEN** `viewMode === '2D'` (regardless of `force2D`)
- **THEN** the SceneFallbackBadge is not in the rendered DOM

### Requirement: SceneErrorPanel SHALL be theme-aware

The fallback panel rendered by `SceneErrorBoundary.render()` when `state.hasError === true` and no custom `fallback` prop is provided SHALL be a function component `<SceneErrorPanel error={...} onRetry={...} />` (extracted from `SceneCanvas.tsx` to a new file `packages/ui-office/src/components/scene/scene-error-panel.tsx`).

The component SHALL consume `useSceneColors()` for the surface background (`sceneBackground` field). All other colors SHALL come from `@theme inline`-resolved Tailwind utilities (e.g., `text-destructive`, `text-muted-foreground`, `bg-muted`, `text-foreground`). No raw hex / rgba literals SHALL appear in this file.

The previous inline-rendered `<div className="flex items-center justify-center h-full bg-black/50 text-white">...</div>` block in `SceneCanvas.tsx` SHALL be removed.

#### Scenario: Error panel adapts to light theme

- **WHEN** the active theme is `'light'` and a 3D crash bubbles to the outer `SceneErrorBoundary`
- **THEN** the rendered panel's background color matches `LIGHT_SCENE_3D.sceneBackground` (`#e8edf4`)
- **AND** the destructive text color matches the light-theme destructive token

#### Scenario: Error panel adapts to dark theme

- **WHEN** the active theme is `'dark'` and a 3D crash bubbles to the outer `SceneErrorBoundary`
- **THEN** the rendered panel's background color matches `DARK_SCENE_3D.sceneBackground` (`#020617`)

#### Scenario: SceneCanvas.tsx is exemption-free

- **WHEN** running `pnpm tokens:lint-hex`
- **THEN** `SceneCanvas.tsx` reports zero violations
- **AND** `SceneCanvas.tsx` does not carry a `// raw-hex-allowed-file:` header
