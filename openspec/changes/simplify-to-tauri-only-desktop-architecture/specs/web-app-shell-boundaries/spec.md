# web-app-shell-boundaries

## REMOVED Requirements

### Requirement: App.tsx is a thin composition shell

**Reason**: The standalone `apps/web` shell is being removed as a product route. Shell composition moves to the desktop-owned renderer under `apps/desktop`.

**Migration**: Use `tauri-only-desktop-architecture` requirements for the desktop renderer shell boundary.

### Requirement: Overlay state hook is standalone

**Reason**: The path-specific `apps/web/src/hooks/useOverlayState.ts` contract is obsolete once renderer code moves under desktop ownership.

**Migration**: Keep overlay state standalone inside the desktop renderer, governed by `tauri-only-desktop-architecture` and `unified-shell-routing` deltas.

### Requirement: Company lifecycle hook is standalone

**Reason**: The path-specific `apps/web/src/hooks/useCompanyLifecycle.ts` contract is obsolete once renderer code moves under desktop ownership.

**Migration**: Keep company lifecycle ownership in a desktop renderer hook with equivalent behavior.

### Requirement: Company bootstrap effects are standalone

**Reason**: The path-specific `apps/web/src/hooks/useCompanyBootstrap.ts` contract is obsolete once renderer code moves under desktop ownership.

**Migration**: Keep bootstrap effects in a desktop renderer hook and verify through release `.app` startup.

### Requirement: Office state bindings hook is standalone

**Reason**: The path-specific `apps/web/src/hooks/useOfficeStateBindings.ts` contract is obsolete once renderer code moves under desktop ownership.

**Migration**: Keep Office state bindings in the desktop renderer and preserve workspace state semantics.

### Requirement: Keyboard shortcut hook is standalone

**Reason**: The path-specific `apps/web/src/hooks/useAppKeyboardShortcuts.ts` contract is obsolete once renderer code moves under desktop ownership.

**Migration**: Keep keyboard shortcut ownership in a desktop renderer hook and verify in the release `.app`.

### Requirement: AppLayout composition moves to AppMainShell

**Reason**: The old `apps/web/src/components/app-shell/AppMainShell.tsx` path is retired with the standalone web app.

**Migration**: Keep the render-only `AppMainShell` pattern inside the desktop renderer path.

### Requirement: Overlay render host is a single component

**Reason**: The old `apps/web/src/components/app-shell/AppOverlayHost.tsx` path is retired with the standalone web app.

**Migration**: Keep the single overlay host pattern inside the desktop renderer path.

### Requirement: Global dialogs host is a single component

**Reason**: The old `apps/web/src/components/app-shell/AppGlobalDialogs.tsx` path is retired with the standalone web app.

**Migration**: Keep the single global dialogs host pattern inside the desktop renderer path.

### Requirement: Behavior is unchanged after refactor

**Reason**: This behavior-preservation requirement was tied to a web-shell refactor. The new architecture is not a pure behavior-preserving move; it deliberately removes web and launcher product routes.

**Migration**: Preserve desktop-renderer user behavior where the Tauri app still exposes the same workflows, and verify through release `.app` evidence.

### Requirement: App public API is preserved

**Reason**: The standalone `apps/web/src/App.tsx` public API is removed from the active product.

**Migration**: The desktop renderer owns its own app entrypoint API under the desktop package.

