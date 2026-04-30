# Offisim 8-Change Apply Verification

Date: 2026-04-30

Scope:
- `unify-design-token-system`
- `expand-ui-core-foundation`
- `rebuild-dialog-and-popover-system`
- `fix-layout-shift-stability`
- `add-workspace-narrow-tier-and-states`
- `add-url-sync-and-deep-links`
- `upgrade-3d-scene-lighting-and-materials`
- `upgrade-3d-character-rendering-1.0`

## Result

All eight OpenSpec changes have been implemented as one production delivery. The shipped state includes token SSOT and theme switching, UI-core primitives and migrations, dialog/popover protocol replacement, layout-shift stabilization, responsive workspace shell states, URL sync/deep links, 3D scene lighting/material/performance fallback, and 3D character rendering upgrades.

## Build And Static Gates

Passed gates:
- `openspec validate <change> --strict` for all eight changes.
- `pnpm tokens:emit`
- `pnpm tokens:check`
- `pnpm tokens:lint-hex`
- `pnpm --filter @offisim/ui-core typecheck`
- `pnpm --filter @offisim/ui-core clean && pnpm --filter @offisim/ui-core build`
- `pnpm --filter @offisim/renderer build`
- `pnpm --filter @offisim/ui-office typecheck`
- `pnpm --filter @offisim/ui-office clean && pnpm --filter @offisim/ui-office build`
- `pnpm --filter @offisim/web typecheck`
- `pnpm --filter @offisim/web build`
- `pnpm harness:contract`
- `npx biome check .`
- `cd apps/desktop/src-tauri && cargo check && cargo clippy -- -D warnings`
- `pnpm --filter @offisim/desktop build`

Production bundle checks:
- `DevLightingPanel` is not present in `apps/web/dist/assets/*.js`.
- App source and dist contain no `PCFSoftShadowMap` / old `getOffice3DPerformanceConfig` references.
- `apps/web/dist/index.html` includes the pre-hydration theme script.
- Font files are present in `apps/web/public/fonts/`: `inter-var.woff2` and `jetbrains-mono-var.woff2`.

## Browser Live Verification

Evidence directory:
- `Docs/handoffs/artifacts/offisim-8-change-live/`

Browser matrix:
- 36 route checks passed: 6 viewports (`390`, `768`, `1024`, `1280`, `1440`, `1728`) x 6 workspaces (Office, SOPs, Market, Personnel, Activity, Settings).
- Route failures: `0`.
- Horizontal overflow: `0` in the captured matrix.
- Fatal console errors: `0`.
- Observed external-market `ERR_CONNECTION_REFUSED` entries are from the marketplace service being unavailable; the app renders the expected Market unavailable state instead of crashing.

CLS and layout stability:
- Personnel tab raw delta: `0`.
- Personnel tab budget delta: `0`.
- Right rail raw delta: `0`.
- Right rail budget delta: `0`.
- Narrow shell verified at `390` and `768`; `769` and wider no longer use the narrow tier after the layout-tier fix.

URL and deep-link verification:
- `/personnel/<employee-id>?tab=appearance` restores Personnel, the selected employee, the Appearance tab, and the preview canvas.
- Browser route matrix covered Office, SOPs, Market, Personnel, Activity, and Settings direct loads.
- `fallback.ts` was corrected so loaded-but-empty maps do not strip valid personnel deep-link state before runtime data arrives.

Theme verification:
- Light, Dark, and System modes were toggled in browser.
- Light mode was rechecked after the legacy utility bridge fix; Settings Runtime headings and controls resolve to readable semantic colors.
- Screenshots captured:
  - `web-office-1440.png`
  - `personnel-appearance-1440.png`
  - `web-office-narrow-drawer.png`
  - `web-office-narrow-drawer-light-fixed-final.png`
  - `web-settings-runtime-light-fixed-final.png`

3D canvas verification:
- Screenshot-level canvas evidence for `web-office-1440.png`: `mean=0.642617`, `stddev=0.293157`, `min=0.0832022`, `max=1`.
- Direct WebGL readback in the automated script returned black due browser readback limits; the screenshot statistics are the nonblank visual evidence.

## Tauri Release App Verification

Release app:
- `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- Bundle id: `com.offisim.desktop`

Verified via Computer Use against the release `.app`, not the dev webview:
- Release `.app` launched via `open -b com.offisim.desktop`.
- Office workspace rendered with 3D scene and employee list.
- Personnel navigation worked from the UI.
- Personnel appearance deep link restored the selected employee and Appearance tab.
- Settings Runtime page rendered and exposed the System / Light / Dark theme control.
- System theme mode followed macOS Appearance:
  - Original system Appearance was Light.
  - Toggling macOS dark mode changed the app's System subtitle to Dark and the UI to dark.
  - Toggling macOS back restored the app's System subtitle to Light and the UI to light.
  - macOS Appearance was restored to Light after verification.

## Issues Found During Final Verification And Fixed

- Onboarding tour target registration could trigger maximum update depth under repeated ref callbacks; fixed with a registry map and microtask batching.
- `PCFSoftShadowMap` is not present in the installed Three.js runtime; shadow map selection was corrected to `PCFShadowMap`.
- Light theme exposed unreadable legacy dark-surface utilities; added a semantic legacy utility bridge and moved Button variants to semantic token classes.
- Workspace layout tier had an off-by-threshold bug around narrow breakpoints; fixed so narrow behavior matches the new workspace-tier contract.
- Personnel deep-link fallback could drop a valid selected employee when runtime maps were temporarily empty; fixed to preserve the parsed state until data is available.

## Remaining Known External Condition

The Market workspace can show "Market is unavailable" when the local marketplace/platform service is not running. This is not an app-shell failure: routing, layout, and error-state rendering all remain functional.
