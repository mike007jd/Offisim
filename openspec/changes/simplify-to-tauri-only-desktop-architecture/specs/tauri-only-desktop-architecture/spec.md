# Tauri-Only Desktop Architecture

## ADDED Requirements

### Requirement: Offisim ships one Tauri v2 desktop app

The repository SHALL present `apps/desktop` as the only active app package and release target. `apps/desktop/src-tauri` SHALL remain the Tauri v2 host, and the desktop package SHALL own the renderer consumed by the Tauri WebView.

#### Scenario: App package inventory

- **WHEN** the workspace package list is inspected
- **THEN** `apps/desktop` is the only app package intended for release
- **AND** no `apps/web` or `apps/launcher` package remains in the active workspace graph

#### Scenario: Desktop release target

- **WHEN** release build commands are inspected
- **THEN** the release path builds `apps/desktop`
- **AND** it does not build, preview, or launch a standalone web app or launcher app

### Requirement: Desktop renderer is internal to the desktop app

The React/Office renderer SHALL live under the desktop app ownership boundary, for example `apps/desktop/renderer`. The renderer SHALL be described as the desktop WebView renderer, not as a standalone web product.

#### Scenario: Renderer source location

- **WHEN** renderer source files are listed
- **THEN** App shell, runtime provider wiring, workspace routing, and desktop UI composition live under the desktop package renderer path
- **AND** imports and scripts no longer refer to `apps/web` as the app shell source

#### Scenario: Renderer build ownership

- **WHEN** `pnpm --filter @offisim/desktop build` runs
- **THEN** it builds the desktop-owned renderer before bundling the Tauri `.app`
- **AND** it does not depend on `pnpm --filter @offisim/web... build`

### Requirement: Standalone web product is removed

Offisim SHALL NOT expose a standalone web runtime, web preview, browser-provider product path, browser-only MCP/vault path, or web deployment story as an active product route.

#### Scenario: No web package

- **WHEN** the codebase is searched for `@offisim/web`, `apps/web`, or standalone web preview scripts
- **THEN** no active package, build script, or product documentation presents web as a supported app route

#### Scenario: No browser runtime branch

- **WHEN** runtime initialization code is inspected
- **THEN** there is no product branch that calls `createBrowserRuntime`
- **AND** runtime creation flows through the Tauri desktop runtime path

### Requirement: Launcher product is removed

Offisim SHALL NOT keep `apps/launcher` as an active package, release target, dev tool, or product shell after this change.

#### Scenario: No launcher app

- **WHEN** the repository is searched for active launcher package metadata or Tauri launcher config
- **THEN** no `apps/launcher` package remains
- **AND** root scripts no longer include launcher-specific start/build commands

### Requirement: Runtime context is split by capability

The desktop renderer SHALL split runtime context into capability-scoped contexts or hooks instead of exposing one giant context value for every runtime concern. UI consumers SHALL import the narrowest hook/context that satisfies their need.

#### Scenario: Status-only consumer

- **WHEN** a UI component only needs running/readiness/version state
- **THEN** it imports a status-scoped hook/context
- **AND** it does not depend on repos, MCP, vault, attachment store, deliverables, or interaction response handlers

#### Scenario: Runtime service consumer

- **WHEN** a UI component needs repositories or runtime services
- **THEN** it imports a services-scoped hook/context
- **AND** unrelated execution/desktop-host/interaction state changes do not require widening that component's dependency surface

### Requirement: Core runtime imports use supported public subpaths

Consumers SHALL NOT import arbitrary `@offisim/core/dist/*` internals. Runtime, harness, LLM, MCP, service, and renderer-safe APIs SHALL be exposed through intentional `@offisim/core` subpaths.

#### Scenario: Dist import gate

- **WHEN** active app and UI package source is searched for `@offisim/core/dist/`
- **THEN** no active consumer imports arbitrary dist internals
- **AND** each former internal dependency resolves through a supported package export

### Requirement: Default Offisim harness ownership is preserved

The Tauri-only architecture SHALL keep `offisim-core` as the default harness owner for planning, routing, permissions, tools, checkpoints, telemetry, and completion evidence. Removing web and launcher SHALL NOT create an ordinary SDK lane or weaken the harness/model transport boundary.

#### Scenario: Runtime owner remains default harness

- **WHEN** a fresh desktop employee task runs without an explicitly verified non-default runtime profile
- **THEN** runtime ownership is recorded as `offisim-core`
- **AND** SDK usage, if present, is recorded only as model transport/provider-adapter detail

### Requirement: Release verification uses the release app

Architecture cleanup SHALL be accepted only with release `.app` evidence for desktop runtime behavior. Dev server or standalone browser evidence SHALL NOT satisfy release verification.

#### Scenario: Release app gate

- **WHEN** the change is marked implementation-complete
- **THEN** verification evidence includes a built release `.app` from the current worktree
- **AND** the release app demonstrates startup, company selection or bootstrap, chat/runtime readiness, local DB access, desktop file/vault capability where applicable, and no stale web/launcher route

### Requirement: Open-source docs describe the same product truth

Repository docs, contributor guidance, package scripts, and OpenSpec specs SHALL describe Offisim as a Tauri v2 desktop app with an internal renderer.

#### Scenario: Public repo audit

- **WHEN** a contributor reads root docs, package scripts, and active OpenSpec specs
- **THEN** they see one product architecture: Tauri v2 desktop
- **AND** no active doc tells them to run or ship `apps/web` or `apps/launcher`

### Requirement: Desktop renderer entrypoint is a thin composition shell

The desktop renderer's app composition root SHALL stay thin: it SHALL only (a) call orchestrator hooks (runtime / company / workspace / overlay / office-state / keyboard / company-lifecycle / deep-link), (b) derive display values via `useMemo`, and (c) render the overlay host / main shell / global dialogs hosts plus `EmployeeInspector` / `OnboardingController` / `ToastBanner` / `ResumeBar`. Inline `useEffect` business logic and inline handler bodies for company lifecycle / keyboard shortcuts / company bootstrap SHALL NOT live in the composition root.

#### Scenario: Composition root stays small

- **WHEN** the desktop renderer app composition root is inspected after migration
- **THEN** it contains only orchestrator-hook calls, `useMemo` derivations, and the three app-shell host renders plus the named top-level renderer components
- **AND** it does not exceed a thin composition-root size budget (no inline lifecycle / bootstrap / keyboard business logic)

#### Scenario: No inline lifecycle handlers in the composition root

- **WHEN** the desktop renderer composition root is searched for multi-line async handler bodies
- **THEN** company archive / wizard completion / employee deploy / template load / keyboard-shortcut switch logic lives in dedicated hooks, not inline in the composition root
- **AND** only small inline arrow callbacks (e.g. workspace switch, file-import passthrough) remain inline

### Requirement: Overlay state ownership is a single standalone hook

The desktop renderer SHALL own `activeOverlay` overlay state and its transitions in exactly one standalone overlay-state hook. Other modules SHALL NOT import the internal overlay setter directly; they SHALL use the named action helpers the hook returns.

#### Scenario: Single-point ownership of activeOverlay

- **WHEN** the desktop renderer source is searched for the overlay-state declaration
- **THEN** exactly one module owns `activeOverlay` state
- **AND** other modules consume only the named helpers it returns

#### Scenario: Escape close uses the overlay hook API

- **WHEN** the keyboard shortcut path handles `Escape` with an overlay open
- **THEN** it calls the overlay-state hook's close helper, not a raw overlay setter

### Requirement: Company lifecycle ownership is a single standalone hook

The desktop renderer SHALL own company lifecycle handlers in one standalone company-lifecycle hook covering: wizard completion, select-company, create-your-own, studio-company-created, archive-company, creator deploy (HR employee create), and save-provider-config. The composition root SHALL NOT inline these handler bodies.

#### Scenario: Lifecycle handler ownership

- **WHEN** the desktop renderer composition root is read
- **THEN** no inline company-archive / wizard-complete / creator-deploy handler bodies appear; only values destructured from the company-lifecycle hook

#### Scenario: Runtime reinit on provider save

- **WHEN** the user saves provider config via the hook's save helper
- **THEN** runtime re-initialization is invoked exactly once, matching pre-migration behavior

### Requirement: Company bootstrap effects are a single standalone hook

The desktop renderer SHALL own company-id-coupled side effects in one standalone company-bootstrap hook: overlay reset on company switch, template load, portal preview sync, pending-view studio-edit resume, and event-log prime/dispose. The composition root SHALL NOT contain those `useEffect` blocks directly.

#### Scenario: Pending-view studio-edit pickup still works

- **WHEN** the pending-view key equals the studio-edit value at the next company mount
- **THEN** the bootstrap hook consumes the key, sets office studio mode to edit, and opens the studio overlay — matching pre-migration behavior

#### Scenario: Template load side effect

- **WHEN** the active company changes
- **THEN** the bootstrap hook loads the company template into active-template state and triggers a company-switch-to-null path if the company is missing — matching pre-migration behavior

### Requirement: Office state bindings are a single standalone hook

The desktop renderer SHALL produce Office-scoped callbacks (`updateOfficeState`, `onViewModeChange`, `onSceneFallbackTo2D`, dashboard/kanban toggles, layout-metrics change, employee select, user-message) from one standalone office-state-bindings hook.

#### Scenario: Office state writer path preserved

- **WHEN** any office-scoped callback mutates state
- **THEN** it SHALL write through `updateWorkspaceState('office', updater)` inside the hook, and SHALL NOT introduce a standalone dashboard/kanban setter (upholding `workspace-state-management`)

### Requirement: Keyboard shortcut ownership is a single standalone hook

The desktop renderer SHALL own the Office / overlay / escape keyboard-shortcut effect in one standalone keyboard-shortcuts hook. Its dependency array SHALL be the minimum closure it reads. Office-scoped shortcuts (dashboard / kanban / workspace-1 / employee-edit) SHALL only fire when the Office workspace is active, while shortcut-help and Escape remain global.

#### Scenario: Office shortcut outside Office is ignored

- **WHEN** the dashboard-toggle shortcut is pressed while a non-office workspace is active
- **THEN** the dashboard does NOT toggle — matching pre-migration behavior

#### Scenario: Escape unwind priority preserved

- **WHEN** Escape is pressed while the shortcut-help dialog is open
- **THEN** the help dialog closes first and overlay state is untouched — preserving the help → editor → overlay → go-back order

### Requirement: Main shell composition is a single render-only host

The desktop renderer SHALL place the `AppLayout` render call and its 9 slots (`header` / `agentPanel` / `sceneCanvas` / `chatDrawer` / `eventLog` / `centerContent` / `statusBar` / `chatDrawerMode` / `onLayoutMetricsChange`) inside one render-only main-shell host. The composition root SHALL NOT contain the `AppLayout` JSX directly.

#### Scenario: AppLayout lives in the main-shell host

- **WHEN** the desktop renderer composition root is searched for the `AppLayout` render
- **THEN** zero matches exist — the `AppLayout` usage lives only in the main-shell host

#### Scenario: Main-shell host is render-only

- **WHEN** the main-shell host is read
- **THEN** it declares no `useState` / `useEffect` / `useMemo` business logic; it accepts props and returns JSX (top-level `React.lazy` declarations for heavy surfaces and a local workspace-titles display constant are permitted)

### Requirement: Overlay rendering is a single render-only host

The desktop renderer SHALL place all overlay render branches (employee-creator / office-editor / company-select / studio overlays plus dashboard / kanban / marketplace-listing) inside one render-only overlay host. The composition root SHALL NOT contain these JSX branches.

#### Scenario: Overlay branches live in the overlay host

- **WHEN** the desktop renderer composition root is searched for overlay or dashboard render branches
- **THEN** zero matches exist — the JSX lives only in the overlay host

#### Scenario: Overlay host is render-only

- **WHEN** the overlay host is read
- **THEN** it declares no `useState` / `useEffect`; it accepts props and returns JSX only (Suspense wrappers are permitted)

### Requirement: Global dialogs rendering is a single render-only host

The desktop renderer SHALL place the global dialog render branches (install dialog, company editor, keyboard-shortcuts dialog, and both company-creation-wizard modes `populate-existing` + `create-new`) inside one render-only global-dialogs host. The composition root SHALL NOT contain these JSX branches. The legacy employee-editor dialog SHALL NOT be rendered, because employee editing lives in the Personnel workspace.

#### Scenario: Dialog branches live in the global-dialogs host

- **WHEN** the desktop renderer composition root is searched for the install dialog or company-creation-wizard render
- **THEN** zero matches exist — they live only in the global-dialogs host

#### Scenario: Employee-editor dialog branch is absent

- **WHEN** the global-dialogs host is searched for an employee-editor dialog
- **THEN** zero matches exist
- **AND** the host SHALL NOT accept an employee-editor prop or any equivalent dialog-state input

#### Scenario: Wizard dual-mode branch preserved

- **WHEN** the Office workspace is active and no overlay is open
- **THEN** the global-dialogs host renders the company-creation wizard in `populate-existing` mode — matching the pre-migration trigger
- **WHEN** the company wizard mode is `create-new`
- **THEN** the global-dialogs host additionally renders the company-creation wizard in `create-new` mode with its dismiss handler wired
