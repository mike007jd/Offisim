# runtime-provider-boundaries Specification

## Purpose

`OffisimRuntimeProvider` 的职责边界规范——把 desktop renderer runtime 的 async init lifecycle、scene intent bus wiring、notification bridge、interaction mode sync、unfinished thread detection 五块职责从单一组件中拆分，落进 `apps/desktop/renderer/src/runtime/hooks/` 下 5 个 one-hook-per-file 的 composition hook。`OffisimRuntimeProvider.tsx` 作为 thin shell 只做 props 接收 + 调 5 个 sub-hook + 组装 context value + 渲染 runtime context providers。Runtime lifecycle（`createTauriRuntime` / `createTauriRuntimeReposOnly` / `disposeRuntime` / reinit 版本 bump）单点落在 `useRuntimeInit`；其余 sub-hook 接收 ready runtime 作为 prop，`runtime === null` 时 short-circuit。该规范只描述 Tauri v2 desktop-owned WebView renderer，不再引用已移除的 standalone web shell / launcher capability。

## Requirements

### Requirement: OffisimRuntimeProvider is a thin composition shell

`apps/desktop/renderer/src/runtime/OffisimRuntimeProvider.tsx` SHALL contain no more than 250 non-blank, non-comment lines and SHALL only: (a) accept `{ companyId, children }` props, (b) call the 5 composition hooks (`useRuntimeInit` / `useSceneIntentWiring` / `useNotificationBridge` / `useInteractionSync` / `useUnfinishedThreadDetection`), (c) assemble runtime/status/service context values via `useMemo`, (d) render the runtime context providers. Inline async `createTauriRuntime()` / `createTauriRuntimeReposOnly()` calls, event subscriptions, idle-timer scanning, or notification bridge wiring SHALL NOT live in this file.

#### Scenario: File size gate
- **WHEN** `grep -cvE '^\s*(//|$|/\*|\*)' apps/desktop/renderer/src/runtime/OffisimRuntimeProvider.tsx` is run after refactor
- **THEN** the non-blank, non-comment line count is at most 250

#### Scenario: No inline runtime build
- **WHEN** grepping `OffisimRuntimeProvider.tsx` for `createTauriRuntime\(` / `createTauriRuntimeReposOnly\(` or `NotificationBridge\(`
- **THEN** zero matches exist — runtime build lives in `useRuntimeInit`, bridge in `useNotificationBridge`

### Requirement: Runtime lifecycle is owned by useRuntimeInit

`apps/desktop/renderer/src/runtime/hooks/useRuntimeInit.ts` SHALL own the full async lifecycle: calling `createTauriRuntime(...)` when provider config exists and `createTauriRuntimeReposOnly(...)` when the renderer only needs repos/bootstrap services, tracking `isInitializing` / `runtime` / `status` / `version` state, running `disposeRuntime` on company switch or unmount, exposing a `reinit()` callback. The hook SHALL return `{ runtime, status, version, reinit, isInitializing }`. No other hook in the provider family SHALL directly call runtime creation or `disposeRuntime`.

#### Scenario: Single owner of runtime lifecycle
- **WHEN** grepping `apps/desktop/renderer/src/runtime/**/*.ts*` for `createTauriRuntime\(` / `createTauriRuntimeReposOnly\(` or `disposeRuntime\(`
- **THEN** all matches are inside `apps/desktop/renderer/src/runtime/hooks/useRuntimeInit.ts`

#### Scenario: reinit triggers a full teardown + rebuild
- **WHEN** `reinit()` is invoked (e.g. after Settings saves a new runtime policy)
- **THEN** the old `runtime` is disposed, `status` moves to `reinitializing` then `ready`, and `version` increments — identical sequence to pre-refactor

### Requirement: Sub-hooks accept a ready runtime, not async state

Each sub-hook (`useSceneIntentWiring` / `useNotificationBridge` / `useInteractionSync` / `useUnfinishedThreadDetection`) SHALL accept `{ runtime }` (and any other necessary pre-built dependency) as a prop. When `runtime === null` (during init or after dispose), the hook SHALL short-circuit without subscribing to any bus. Sub-hooks SHALL NOT re-implement async initialization logic.

#### Scenario: Sub-hook short-circuits when runtime is null
- **WHEN** `useRuntimeInit` returns `runtime: null` (still initializing)
- **THEN** every sub-hook runs but performs no subscription / side effect; no error is thrown

### Requirement: Provider family files are one-hook-per-file

`apps/desktop/renderer/src/runtime/hooks/` SHALL contain exactly these 5 files: `useRuntimeInit.ts`, `useSceneIntentWiring.ts`, `useNotificationBridge.ts`, `useInteractionSync.ts`, `useUnfinishedThreadDetection.ts`. Each file SHALL export exactly one hook by name. No sub-hook file SHALL import another sub-hook.

#### Scenario: One file per hook
- **WHEN** listing `apps/desktop/renderer/src/runtime/hooks/*.ts`
- **THEN** exactly these 5 files exist

#### Scenario: No cross-sub-hook imports
- **WHEN** grepping `apps/desktop/renderer/src/runtime/hooks/*.ts` for `from '\\./(useRuntimeInit|useSceneIntentWiring|useNotificationBridge|useInteractionSync|useUnfinishedThreadDetection)'`
- **THEN** zero matches exist

### Requirement: Public runtime context surface is unchanged

`OffisimRuntimeContext`, `OffisimRuntimeStatusContext`, `OffisimRuntimeValue`, `OffisimRuntimeStatusValue`, `UnfinishedThread`, and the `useOffisimRuntime()` / `useOffisimRuntimeStatus()` consumer hooks SHALL retain their current type shape, export path, and runtime behavior.

#### Scenario: Consumer API unchanged
- **WHEN** comparing `grep -rn "useOffisimRuntime\(\)\|useOffisimRuntimeStatus\(\)\|UnfinishedThread" apps packages` pre-change vs post-change
- **THEN** every consumer import path and every destructured field is byte-identical

### Requirement: Observable runtime behavior is unchanged after refactor

From cold boot through a full task run, company switch, Settings-triggered reinit, and idle unfinished-thread detection, the provider SHALL produce byte-identical observable behavior: status transition sequence, scene intent delivery order, notification popups, interaction mode changes, and unfinished-thread list.

#### Scenario: Cold boot status sequence
- **WHEN** the provider mounts with a fresh `companyId`
- **THEN** `status` passes through `initializing → ready` in the same order as pre-refactor, emitting the same intermediate values

#### Scenario: Reinit after Settings change
- **WHEN** Settings saves new runtime policy and calls `reinit()`
- **THEN** `status` passes through `reinitializing → ready`, `version` increments by 1, and all sub-hook subscriptions are rebound to the new runtime — identical to pre-refactor
