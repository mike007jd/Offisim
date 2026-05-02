## ADDED Requirements

### Requirement: `Theme` type SHALL be the union `'light' | 'dark' | 'system'`

`packages/ui-office/src/theme/theme-provider.tsx` SHALL export the type `Theme = 'light' | 'dark' | 'system'`. The legacy `type Theme = 'dark'` literal SHALL NOT survive in any module.

A separate type `ResolvedTheme = 'light' | 'dark'` SHALL exist for the resolved-after-system-fallback value.

`ThemeContextValue` SHALL expose:

- `theme: Theme` — the user's current preference (may be `'system'`)
- `resolvedTheme: ResolvedTheme` — the actual rendering theme after system fallback
- `setTheme: (theme: Theme) => void` — user-facing setter
- `density: Density` — existing field, unchanged
- `setDensity: (density: Density) => void` — existing field, unchanged

`useTheme()` SHALL throw if called outside `<ThemeProvider>` (unchanged).

#### Scenario: Public type is the union

- **WHEN** importing `type { Theme } from '@offisim/ui-office'` (or the canonical source path)
- **THEN** `Theme` accepts any of `'light'`, `'dark'`, `'system'` and rejects all other strings

#### Scenario: ThemeContextValue exposes the contract

- **WHEN** reading the inferred type of `useTheme()` return value
- **THEN** it includes `theme`, `resolvedTheme`, `setTheme`, `density`, `setDensity` and no other public fields

### Requirement: User theme preference SHALL persist across reloads via `localStorage` key `offisim.theme`

`ThemeProvider` SHALL read `localStorage.getItem('offisim.theme')` on initial mount and SHALL initialize `theme` state from that value when it is one of `'light'`, `'dark'`, `'system'`. Any other value (including `null`, missing key, malformed) SHALL fall back to `'system'`.

`setTheme(theme)` SHALL:

- Update React state
- Call `localStorage.setItem('offisim.theme', theme)` when `theme !== 'system'`
- Call `localStorage.removeItem('offisim.theme')` when `theme === 'system'` (so the absence of a stored value implicitly means `'system'`)
- Toggle `<html>` class list based on the resolved theme

The constant for the storage key SHALL be exported (or co-located) with the `ThemeProvider` for use by the pre-hydration script.

#### Scenario: First-time visitor defaults to system

- **WHEN** a fresh browser session loads `apps/web` and `localStorage.getItem('offisim.theme')` returns `null`
- **THEN** `useTheme().theme === 'system'` and `resolvedTheme` matches OS preference

#### Scenario: Setting theme to dark persists

- **WHEN** the user calls `setTheme('dark')` and then reloads the page
- **THEN** the next mount reads `theme === 'dark'` from storage and applies dark mode immediately

#### Scenario: Setting theme to system clears the storage key

- **WHEN** the user calls `setTheme('system')` after previously setting `'dark'`
- **THEN** `localStorage.getItem('offisim.theme')` returns `null` (the key is removed, not stored as `'system'` literal)

### Requirement: System theme MUST be resolved via `prefers-color-scheme` media query and MUST react to OS-level changes

When `theme === 'system'`, `ThemeProvider` SHALL call `window.matchMedia('(prefers-color-scheme: dark)')` and use its `matches` boolean to set `resolvedTheme` to `'dark'` if `matches === true` else `'light'`.

`ThemeProvider` SHALL register a `change` event listener on the `MediaQueryList` returned by `matchMedia` and update `resolvedTheme` whenever the OS theme changes — for as long as the user's `theme` preference is `'system'`. The listener SHALL be removed via the `useEffect` cleanup function on unmount or when `theme` changes away from `'system'`.

#### Scenario: System mode follows OS

- **WHEN** the user has `theme === 'system'` and the OS is in dark mode
- **THEN** `resolvedTheme === 'dark'` and `<html>` has the `dark` class

#### Scenario: OS toggle propagates while in system mode

- **WHEN** the user has `theme === 'system'`, the OS is in dark mode, and the user toggles the OS to light
- **THEN** within one frame `resolvedTheme === 'light'` and the `dark` class is removed from `<html>`

#### Scenario: Listener is torn down when leaving system mode

- **WHEN** the user has `theme === 'system'` and then calls `setTheme('dark')`
- **THEN** the `prefers-color-scheme` listener is removed; subsequent OS toggles do not trigger React re-renders

### Requirement: Pre-hydration inline script SHALL apply the theme before React mounts

`apps/web/index.html` SHALL contain an inline `<script>` block in `<head>` that runs before any module bundle loads. The script SHALL:

1. Read `localStorage.getItem('offisim.theme')`
2. If absent or invalid, default to `'system'`
3. If the resolved value is `'dark'`, or `'system'` with `matchMedia('(prefers-color-scheme: dark)').matches === true`, add the `dark` class to `<html>`
4. Otherwise, ensure `<html>` does not have the `dark` class
5. On any thrown exception, default to dark mode (the legacy behavior — avoids a worse failure mode of unstyled white text)

The script SHALL be ≤ 256 characters minified, SHALL have no external dependencies, and SHALL run synchronously.

The same `index.html` SHALL be served by both the web build (`apps/web/dist/index.html`) and the Tauri release WebView (which loads from `apps/web/dist/`).

#### Scenario: Page loads without flash in dark mode

- **WHEN** a user with `theme = 'dark'` reloads
- **THEN** the painted background is the dark surface color before React hydrates — no flash of light theme

#### Scenario: Page loads without flash in light mode

- **WHEN** a user with `theme = 'light'` reloads
- **THEN** the painted background is the light surface color before React hydrates — no flash of dark theme

#### Scenario: Pre-hydration script falls back gracefully

- **WHEN** `localStorage` access throws (e.g. private mode in some browsers)
- **THEN** `<html>` ends up with the `dark` class (legacy default) and the page does not crash

### Requirement: All semantic colors and shadows SHALL have light variants

For every entry in `SemanticColors`, `Scene3DColors`, and `ShadowName` defined by `design-token-foundation`, both a light variant (`LIGHT_SEMANTIC_COLORS[name]` / `LIGHT_SCENE_3D[name]` / `SHADOW_SCALE_LIGHT[name]`) and a dark variant (`DARK_*[name]` / `SHADOW_SCALE_DARK[name]`) SHALL be defined.

The two variants SHALL produce visually distinguishable surfaces — light theme surface and text values SHALL meet WCAG AA contrast (≥ 4.5:1 for body text, ≥ 3:1 for large text and interactive borders).

#### Scenario: Both themes are complete

- **WHEN** comparing key sets of `LIGHT_SEMANTIC_COLORS` and `DARK_SEMANTIC_COLORS`
- **THEN** they are equal — no field exists only in one theme

#### Scenario: Light theme body text has AA contrast

- **WHEN** measuring contrast between `LIGHT_SEMANTIC_COLORS.textPrimary` and `LIGHT_SEMANTIC_COLORS.surface`
- **THEN** the contrast ratio is ≥ 4.5:1

#### Scenario: Dark theme body text has AA contrast

- **WHEN** measuring contrast between `DARK_SEMANTIC_COLORS.textPrimary` and `DARK_SEMANTIC_COLORS.surface`
- **THEN** the contrast ratio is ≥ 4.5:1

### Requirement: Tailwind theme generation SHALL emit both `:root` and `:root.dark` variable scopes

The CSS emitted by `emitTailwindThemeCss()` (per `design-token-foundation`) SHALL contain a `:root { --color-X-val: <light value>; ... }` block for every semantic color, every shadow, and density-aware spacing. It SHALL also contain a `:root.dark { --color-X-val: <dark value>; ... }` block overriding the same variables with dark values.

The Tailwind theme keys (`@theme inline`) SHALL reference only the `-val` variables — never inline literal values — so toggling the `dark` class on `<html>` flips every token-driven utility class without re-running Tailwind.

#### Scenario: Both scopes are present in the generated CSS

- **WHEN** reading `apps/web/src/generated/tailwind-theme.css`
- **THEN** the file contains both `:root {` and `:root.dark {` blocks, each with the same set of `--color-*-val` and `--shadow-*-val` variable assignments

#### Scenario: Toggling the dark class flips every token

- **WHEN** runtime adds the `dark` class to `<html>`
- **THEN** the computed value of `--color-surface` returned by `getComputedStyle(document.documentElement).getPropertyValue('--color-surface')` changes from the light surface hex to the dark surface hex (mediated by the `--color-surface-val` indirection)

### Requirement: `useSceneColors()` SHALL return theme-aware 3D scene colors

`packages/ui-office/src/theme/use-scene-colors.ts` SHALL be rewritten to:

- Import `LIGHT_SCENE_3D` and `DARK_SCENE_3D` from `@offisim/ui-core/tokens`
- Consume `useTheme().resolvedTheme`
- Return `LIGHT_SCENE_3D` when `resolvedTheme === 'light'`, otherwise `DARK_SCENE_3D`

The function signature SHALL remain `useSceneColors(): SceneColors` — the type stays the same, only the value flips per theme.

The hard-coded `DARK_SCENE` constant in this file SHALL be removed; the dark scene values now live in `colors-3d.ts` per `design-token-foundation`.

#### Scenario: Dark theme returns dark scene

- **WHEN** the active theme resolves to `'dark'` and a component calls `useSceneColors()`
- **THEN** the returned object equals `DARK_SCENE_3D` from `@offisim/ui-core/tokens`

#### Scenario: Light theme returns light scene

- **WHEN** the active theme resolves to `'light'` and a component calls `useSceneColors()`
- **THEN** the returned object equals `LIGHT_SCENE_3D` from `@offisim/ui-core/tokens`

#### Scenario: Theme change re-renders consumers

- **WHEN** `setTheme('light')` is called while a 3D scene is rendered
- **THEN** the next render of the scene material returns the light variant — Three.js material colors update to the light scene values within one frame

### Requirement: Settings UI SHALL surface a theme control

The Settings workspace SHALL contain a Theme control with three options corresponding to the `Theme` union: `System`, `Light`, `Dark`. Selecting an option SHALL call `setTheme(option)` immediately — there SHALL be no separate save / submit step for theme changes (theme persistence is independent of the runtime / provider save flow).

When `theme === 'system'`, the Theme control SHALL display a subtitle indicating the currently resolved theme (e.g. "Following OS preference: Dark").

The control SHALL be reachable from the existing Settings tab navigation without introducing a new top-level workspace.

#### Scenario: Theme tile is present in Settings

- **WHEN** the user navigates to Settings → (Appearance tab or the canonical theme location)
- **THEN** a `SegmentedControl` (or equivalent primitive) is rendered with three options labeled `System`, `Light`, `Dark`, the active option matching `useTheme().theme`

#### Scenario: Selecting an option applies immediately

- **WHEN** the user selects `Light` while the active theme is `Dark`
- **THEN** within one frame the page re-renders in light theme; no save bar is required

#### Scenario: System mode shows the resolved subtitle

- **WHEN** the user has `theme === 'system'` and the OS resolves to dark
- **THEN** the Theme control subtitle reads "Following OS preference: Dark" (case-insensitive match accepted)

### Requirement: Tailwind 4 dark mode SHALL use class-based toggling on `<html>`

The generated Tailwind theme CSS SHALL be authored such that the `dark` class on `<html>` is the active dark-mode trigger. Tailwind 4's default `@variant dark (.dark &)` semantics SHALL be honored — i.e. the project SHALL NOT override `darkMode` to `'media'` mode (which would prevent user-driven theme switching).

Touched Tailwind utility classes (semantic colors like `bg-surface`, `text-text-primary`) SHALL automatically flip values when `<html>` gains or loses the `dark` class, without any per-component `dark:` variant requirement.

#### Scenario: Class-toggle changes computed styles

- **WHEN** the `dark` class is added to `<html>` at runtime
- **THEN** an element with the Tailwind class `bg-surface` repaints from light surface to dark surface immediately (CSS variable indirection — no Tailwind rebuild required)

#### Scenario: No `darkMode: 'media'` override exists

- **WHEN** auditing the Tailwind 4 configuration (the `@theme inline` block in generated CSS, plus any `@import "tailwindcss"` modifier)
- **THEN** there is no `darkMode: 'media'` directive — class-based toggling is the active mode

### Requirement: Force-dark legacy code SHALL be removed

The legacy `useEffect` in `packages/ui-office/src/theme/theme-provider.tsx` that calls `root.classList.add('dark'); root.classList.remove('light')` unconditionally SHALL be removed. The legacy literal `type Theme = 'dark'` SHALL be removed. The hand-authored "dark-only" comment in `apps/web/src/index.css` SHALL be replaced with a comment explaining that theme variables are emitted from `@offisim/ui-core/tokens`.

`packages/ui-office/src/theme/use-scene-colors.ts` SHALL no longer contain the inline `DARK_SCENE` constant — the file is reduced to the hook implementation calling into `@offisim/ui-core/tokens`.

#### Scenario: No force-dark code path remains

- **WHEN** grepping `packages/ui-office/src/theme/theme-provider.tsx` for `classList.add('dark')` (without a conditional gate based on `resolvedTheme`)
- **THEN** zero matches — the only class-toggle call sites are gated by the resolved theme

#### Scenario: Legacy DARK_SCENE constant is gone

- **WHEN** grepping `packages/ui-office/src/theme/use-scene-colors.ts` for `const DARK_SCENE`
- **THEN** zero matches — the constant has moved to `@offisim/ui-core/tokens/colors-3d.ts`
