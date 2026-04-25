## Why

C0 promoted Personnel to a peer workspace and parked the Runtime tab as a placeholder; C1 closed Appearance. The data layer for per-employee engine binding is fully wired (`EmployeeRuntimeBinding`, `resolveEmployeeRuntimeBinding`, Tauri sidecar adapters) but **no UI exposes it**, and Settings has no UI for the company-level `employeeRuntimeDefault` either. So today every employee silently runs in `provider` mode with no path to opt into Claude/Codex engine execution lanes that already work on desktop. C2 wires the user-visible binding controls so the engine adapters that shipped with `agent-sdk-provider-lanes` become reachable from the product surface.

## What Changes

- **Personnel Runtime tab** replaces the placeholder shell with a real binding control: shows resolved binding (effective mode + source), lets the user choose `Inherit company default` / `Provider gateway` / `Claude engine` / `Codex engine`, and saves through the existing `useEmployeeEditor` `runtimeBinding` form path (no new persistence path).
- **Settings Runtime tab** gains a "Default employee runtime" control bound to `runtimePolicy.employeeRuntimeDefault` so the "Inherit" option in Personnel actually has a source. Saves through the existing `useSettingsRuntimePolicy` setter.
- **Shared `<RuntimeBindingControl>` primitive** in `ui-office/src/components/runtime/` consumed by both tabs; engine selector renders `claude-engine` / `codex-engine` only when an adapter is actually registered in the active runtime.
- **Available-adapter discovery**: `OffisimRuntimeContext` exposes `availableEngineAdapters: ReadonlySet<EngineId>` derived from `runtimeCtx.engineAdapters`. Browser shows an empty set (engine choices disabled with "Available on desktop only" hint); trusted Tauri runtime shows `{ claude-engine, codex-engine }`.
- **Flip Tauri adapter registry default**: `createTauriEngineAdapterRegistry({ enableProviderHostPreviewAdapters: true })` becomes the call in `apps/web/src/lib/tauri-runtime.ts`. The "preview" gate is no longer keeping the UI hidden — it now keeps a "preview" banner visible inside the binding control when engine mode is active. Tool execution / handoff proposals limitation stays a documented known gap.
- **External employee branch unchanged**: when `is_external === 1`, the Runtime tab renders a read-only locked card stating engine binding does not apply (A2A always wins per `runtime-engine-adapter`).

## Capabilities

### New Capabilities
- `personnel-runtime-engine-binding`: per-employee runtime binding surface inside Personnel workspace, including company-default inheritance, runtime-aware adapter availability, external-employee read-only lock, and "engine preview" disclosure.

### Modified Capabilities
- `personnel-workspace-surface`: drop "Runtime tab is placeholder shell" requirement; replace with a pointer to the new capability (parallel to how Appearance was de-placeholdered in C1).
- `runtime-engine-adapter`: add a small requirement that runtime context SHALL surface available engine adapter IDs to the UI layer, and that the Tauri adapter registry SHALL be enabled by default in trusted desktop runtimes.
- `settings-controller-boundaries`: add a requirement that Settings → Runtime tab SHALL expose `employeeRuntimeDefault` and persist it through the runtime policy save path.

## Impact

- **Code**:
  - `packages/ui-office/src/components/employees/personnel-tabs/RuntimeTab.tsx` (rewrite — was placeholder)
  - `packages/ui-office/src/components/runtime/RuntimeBindingControl.tsx` (new)
  - `packages/ui-office/src/components/settings/SettingsRuntimeTab.tsx` (add Default employee runtime section)
  - `packages/ui-office/src/components/settings/controller/useSettingsRuntimePolicy.ts` (no shape change; setter already exists)
  - `packages/ui-office/src/runtime/offisim-runtime-context.tsx` (expose `availableEngineAdapters`)
  - `apps/web/src/lib/tauri-runtime.ts` (registry default flip)
  - `apps/web/src/lib/tauri-engine-adapters.ts` (default `enableProviderHostPreviewAdapters: true`; comment update)
- **APIs / contracts**: no schema changes; reuses `EmployeeRuntimeBinding` + `RuntimePolicyConfig.employeeRuntimeDefault` already in `shared-types`.
- **Migrations**: none.
- **Risk**: turning on the Tauri engine registry by default surfaces engines whose tool-execution telemetry is incomplete. Mitigation: visible "preview — limited tool telemetry" disclosure inside the binding control whenever engine mode is the resolved binding; documented as known limitation in design.md.
- **Live verify**: web (engine choices disabled honestly + provider/inherit binding round-trip) and desktop release `.app` (engine choice persists, employee task routes through sidecar, streaming visible). No automated tests.
