# runtime-provider-boundaries

## ADDED Requirements

### Requirement: Runtime provider is Tauri-only

The runtime provider family SHALL initialize only the Tauri desktop runtime path. It SHALL NOT branch to `createBrowserRuntime`, browser-only repository persistence, browser vault activation, browser MCP client, or browser provider fallback as an active product route.

#### Scenario: Runtime factory selection

- **WHEN** runtime initialization code is inspected
- **THEN** it imports and calls the Tauri runtime factory for product runtime creation
- **AND** no active product path calls `createBrowserRuntime`

### Requirement: Runtime provider exposes scoped contexts

The runtime provider family SHALL expose scoped contexts/hooks for status, services, execution, interaction, and desktop-host capability. A compatibility wrapper MAY exist during migration, but new/updated consumers SHALL use scoped hooks.

#### Scenario: Scoped provider layout

- **WHEN** the desktop renderer mounts runtime providers
- **THEN** runtime status, services, execution, interaction, and desktop-host state are represented as distinct provider values or hooks
- **AND** each provider value contains only fields owned by that capability group

## REMOVED Requirements

### Requirement: OffisimRuntimeProvider is a thin composition shell

**Reason**: The old requirement is tied to `apps/web/src/runtime/OffisimRuntimeProvider.tsx` and a browser-capable provider shape.

**Migration**: Replace it with the Tauri-only runtime provider and scoped context requirements in this delta.

### Requirement: Runtime lifecycle is owned by useRuntimeInit

**Reason**: The old lifecycle contract explicitly owns `createBrowserRuntime`; that product branch is removed.

**Migration**: Keep one runtime lifecycle owner in the desktop renderer, but it initializes the Tauri desktop runtime only.

### Requirement: Sub-hooks accept a ready runtime, not async state

**Reason**: The old hook list is path-specific to `apps/web/src/runtime/hooks`.

**Migration**: Preserve the composition-hook style under the desktop renderer path with Tauri-only runtime inputs.

### Requirement: Provider family files are one-hook-per-file

**Reason**: The exact old five-file inventory is tied to the standalone web app provider family.

**Migration**: Use scoped context/hook ownership under the desktop renderer. File count may differ when split by capability.

### Requirement: Public runtime context surface is unchanged

**Reason**: This architecture cleanup intentionally changes runtime context shape to reduce blast radius before open source release.

**Migration**: Provide temporary compatibility wrappers only where needed during implementation, then move consumers to scoped contexts.

### Requirement: Observable runtime behavior is unchanged after refactor

**Reason**: The architecture removes web and launcher product routes, so the whole repository behavior is intentionally not byte-identical.

**Migration**: Desktop user-visible workflows SHALL remain equivalent or intentionally improved and SHALL be verified in the release `.app`.

