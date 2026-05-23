## MODIFIED Requirements

### Requirement: `Theme` type SHALL be the union `'light' | 'dark' | 'system'`

The V3 app SHALL be light-only. The `Theme` type machinery SHALL be RETAINED in code but the resolved theme SHALL be PINNED to `light`.

`packages/ui-office/src/theme/theme-provider.tsx` SHALL keep exporting the type `Theme = 'light' | 'dark' | 'system'` (the union is retained so existing call sites compile and so the machinery can be re-enabled later without a type break). A separate type `ResolvedTheme = 'light' | 'dark'` SHALL continue to exist.

`ThemeContextValue` SHALL expose:

- `theme: Theme` — retained for compatibility; under light-only it always reports `'light'`
- `resolvedTheme: ResolvedTheme` — PINNED to `'light'` (the provider does not resolve `'dark'` or follow the system preference)
- `setTheme: (theme: Theme) => void` — retained for compatibility; under light-only it is a no-op with respect to the rendered theme (it does not relight/redark the app)
- `density: Density` — existing field, unchanged
- `setDensity: (density: Density) => void` — existing field, unchanged

`useTheme()` SHALL throw if called outside `<ThemeProvider>` (unchanged).

#### Scenario: Public type is the union

- **WHEN** importing `type { Theme } from '@offisim/ui-office'` (or the canonical source path)
- **THEN** `Theme` accepts any of `'light'`, `'dark'`, `'system'` and rejects all other strings

#### Scenario: ThemeContextValue exposes the contract

- **WHEN** reading the inferred type of `useTheme()` return value
- **THEN** it includes `theme`, `resolvedTheme`, `setTheme`, `density`, `setDensity` and no other public fields

#### Scenario: Resolved theme is pinned to light

- **WHEN** the renderer mounts and `theme-provider` resolves the theme
- **THEN** `useTheme().resolvedTheme === 'light'` regardless of the stored preference or OS setting — the provider never resolves `'dark'`

### Requirement: Tailwind theme generation SHALL emit both `:root` and `:root.dark` variable scopes

The V3 generated theme is light-only. `emitTailwindThemeCss()` (per `design-token-foundation`) SHALL emit a single `:root { --color-X-val: <light value>; ... }` block for every semantic color, every shadow, and density-aware spacing, where the light values are the V3-revalued palette. The emitter SHALL NOT emit a `:root.dark { ... }` block.

The Tailwind theme keys (`@theme inline`) SHALL continue to reference only the `-val` variables — never inline literal values — so the indirection layer is preserved (the `.dark` class machinery is retained in code but inert; no dark scope is emitted).

#### Scenario: Only the light scope is present in the generated CSS

- **WHEN** reading `apps/desktop/renderer/src/generated/tailwind-theme.css`
- **THEN** the file contains exactly one `:root {` block and zero `:root.dark {` blocks, each declared `--color-*-val` / `--shadow-*-val` variable carrying the V3 light value

#### Scenario: Indirection layer is retained even though no dark scope is emitted

- **WHEN** reading the `@theme inline` block of the generated CSS
- **THEN** every retained semantic key resolves via the `-val` indirection (e.g. `--color-surface: var(--color-surface-val);`) — the indirection machinery is kept even though the `.dark` override scope is no longer emitted

### Requirement: `useSceneColors()` SHALL return theme-aware 3D scene colors

The V3 app is light-only. `packages/ui-office/src/theme/use-scene-colors.ts` SHALL return the light scene palette unconditionally:

- Import `LIGHT_SCENE_3D` (and optionally `DARK_SCENE_3D`, retained for intentional-dark consumers) from `@offisim/ui-core/tokens`
- Consume `useTheme().resolvedTheme`, which is pinned to `'light'`
- Return `LIGHT_SCENE_3D` (the resolved theme never evaluates to `'dark'`, so the dark branch is unreachable in the light-only app)

The function signature SHALL remain `useSceneColors(): SceneColors`. The hard-coded `DARK_SCENE` constant in this file SHALL remain removed; dark scene values live in `colors-3d.ts`.

#### Scenario: Light-only app returns light scene

- **WHEN** a component calls `useSceneColors()` in the light-only app
- **THEN** the returned object equals `LIGHT_SCENE_3D` from `@offisim/ui-core/tokens`

#### Scenario: Dark scene tokens remain available to intentional-dark consumers

- **WHEN** an intentional-dark consumer (e.g. Studio) imports `DARK_SCENE_3D` directly from `@offisim/ui-core/tokens`
- **THEN** the export still exists and its values are unchanged — the dark scene tokens are retained even though `useSceneColors()` never returns them in the light-only app

### Requirement: Force-dark legacy code SHALL be removed

The V3 app is light-only. The legacy unconditional force-dark `useEffect` (which previously called `root.classList.add('dark'); root.classList.remove('light')` regardless of the resolved theme) SHALL NOT exist. The legacy literal `type Theme = 'dark'` SHALL remain removed.

The class-toggle machinery is RETAINED but PINNED to light: `theme-provider` SHALL ensure the document root carries `light` (never `dark`). The `.dark` CSS class is not hard-deleted from the codebase (the `Theme`/`ResolvedTheme` types and the class-toggle code path are retained as the documented light-only fallback), but it is never applied at runtime and no `:root.dark` rule is emitted, so it is inert.

`packages/ui-office/src/theme/use-scene-colors.ts` SHALL not contain the inline `DARK_SCENE` constant.

#### Scenario: No unconditional force-dark code path remains

- **WHEN** grepping `packages/ui-office/src/theme/theme-provider.tsx` for an unconditional `classList.add('dark')`
- **THEN** zero matches — the provider never adds `dark`; it pins the root to `light`

#### Scenario: Legacy DARK_SCENE constant is gone

- **WHEN** grepping `packages/ui-office/src/theme/use-scene-colors.ts` for `const DARK_SCENE`
- **THEN** zero matches — the constant lives in `@offisim/ui-core/tokens/colors-3d.ts`

### Requirement: Tailwind 4 dark mode SHALL use class-based toggling on `<html>`

The V3 app SHALL be light-only. Tailwind 4's class-based dark-mode trigger (`.dark &`) machinery SHALL be RETAINED (the project SHALL NOT switch `darkMode` to `'media'` mode), but the `.dark` class SHALL NOT be applied to `<html>` at runtime and the generated theme CSS SHALL emit no `:root.dark` override scope, so dark-mode toggling is inert.

Per-component `dark:` Tailwind variants SHALL NOT be relied upon to deliver a product theme; touched semantic utilities (`bg-surface`, `text-text-primary`) SHALL resolve only to their light V3 values.

#### Scenario: Class-toggle machinery is retained but inert

- **WHEN** auditing the Tailwind 4 configuration
- **THEN** there is no `darkMode: 'media'` override (class-based machinery is retained), AND the document root never gains a `dark` class at runtime, AND the generated CSS exposes no `:root.dark` scope for the class to flip

### Requirement: User theme preference SHALL persist across reloads via `localStorage` key `offisim.theme`

The V3 app is light-only; there is no user-facing theme preference to persist as a rendered theme. The `localStorage` key `offisim.theme` and its read/write machinery MAY be retained for compatibility, but it SHALL NOT change the rendered theme: the resolved theme is always `light` regardless of any stored value.

`setTheme(theme)` SHALL remain callable for compatibility but SHALL NOT relight/redark the app. The provider SHALL NOT read the stored preference to choose a non-light theme.

#### Scenario: Stored preference does not change the rendered theme

- **WHEN** any value (including `'dark'` or `'system'`) is present at `localStorage.getItem('offisim.theme')` and the renderer mounts
- **THEN** `useTheme().resolvedTheme === 'light'` and the document root carries `light` — the stored value does not relight/redark the app

### Requirement: Pre-hydration inline script SHALL apply the theme before React mounts

The V3 app is light-only. `apps/desktop/renderer/index.html` SHALL contain an inline `<script>` block in `<head>` that runs before any module bundle loads and SHALL ensure `<html>` is in the light state before React mounts (it SHALL ensure `<html>` does NOT carry the `dark` class). The script SHALL NOT read the system `prefers-color-scheme` to decide a dark default.

The script SHALL be small, have no external dependencies, and run synchronously. On any thrown exception it SHALL still leave `<html>` in the light state (no flash of dark theme).

The same `index.html` SHALL be served by both the web build and the Tauri release WebView.

#### Scenario: Page loads without flash in the light-only app

- **WHEN** a user reloads the renderer
- **THEN** the painted background is the light surface color before React hydrates — `<html>` never carries the `dark` class

#### Scenario: Pre-hydration script falls back to light gracefully

- **WHEN** `localStorage` access throws (e.g. private mode in some browsers)
- **THEN** `<html>` ends up without the `dark` class (light state) and the page does not crash

## REMOVED Requirements

### Requirement: System theme MUST be resolved via `prefers-color-scheme` media query and MUST react to OS-level changes

**Reason**: V3 is light-only and committed. The app no longer follows the OS color scheme; the resolved theme is pinned to `light`, so `matchMedia('(prefers-color-scheme: dark)')` resolution and the OS-change listener are no longer part of the contract.

**Migration**: `theme-provider` pins `resolvedTheme = 'light'` and removes the system-follow resolution path and its `change` listener. No consumer reads a system-resolved dark theme. The `.dark` class machinery is retained but inert (see the MODIFIED `Force-dark legacy code` and `Tailwind 4 dark mode` requirements).

### Requirement: Settings UI SHALL surface a theme control

**Reason**: V3 is light-only and committed. There is no light/dark/system choice for the user to make, so the Settings theme control (the three-option `System` / `Light` / `Dark` `SegmentedControl`) is removed from the contract.

**Migration**: The Settings workspace SHALL NOT render a theme `SegmentedControl`. Density controls are unaffected. If a theme control surface is later reintroduced, it will be re-specified by the owning Settings change, not by this capability.
