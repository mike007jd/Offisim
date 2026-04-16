## ADDED Requirements

### Requirement: App.tsx is a thin composition shell
`apps/web/src/App.tsx` SHALL contain no more than 350 non-blank, non-comment lines. It SHALL only: (a) call orchestrator hooks (runtime / company / workspace / overlay / office-state / keyboard / company-lifecycle / deep-link), (b) derive display values via `useMemo`, (c) render `<AppOverlayHost>` / `<AppMainShell>` / `<AppGlobalDialogs>` plus `EmployeeInspector` / `OnboardingController` / `ToastBanner` / `ResumeBar`. Inline `useEffect` business logic and inline handler bodies for company lifecycle / keyboard shortcuts / company bootstrap SHALL NOT live in this file.

#### Scenario: File size gate
- **WHEN** `grep -cvE '^\s*(//|$|/\*|\*)' apps/web/src/App.tsx` is run after refactor
- **THEN** the non-blank, non-comment line count is at most 350

#### Scenario: No inline lifecycle handlers
- **WHEN** grepping `apps/web/src/App.tsx` for `async function handle` / `async (.*) => \{` with multi-line bodies
- **THEN** handler bodies with business logic (company archive / wizard completion / employee deploy / template load / keyboard shortcut switch) live in their dedicated hooks, not inline in `App.tsx`. Only small inline arrow callbacks (`() => setActiveWorkspace('sops')`, `(file) => installFlow.startFileImport(file)`) remain inline.

### Requirement: Overlay state hook is standalone
`activeOverlay: OverlayKey | null` state and its setters (e.g. open company-select / open studio / close) SHALL live in `apps/web/src/hooks/useOverlayState.ts`. Other modules SHALL NOT import the internal setter directly; they SHALL use the named action helpers the hook returns.

#### Scenario: Single-point ownership of activeOverlay
- **WHEN** grepping `apps/web/src/` for `useState<OverlayKey`
- **THEN** exactly one match exists, in `hooks/useOverlayState.ts`

#### Scenario: Escape close uses overlay hook API
- **WHEN** keyboard shortcut hook handles `Escape` with an overlay open
- **THEN** it calls the helper returned by `useOverlayState()` (e.g. `closeOverlay()`), not a raw `setActiveOverlay(null)`

### Requirement: Company lifecycle hook is standalone
The company lifecycle handlers SHALL live in `apps/web/src/hooks/useCompanyLifecycle.ts`. The hook owns: wizard completion, select-company, create-your-own, studio company created, archive company, creator deploy (HR employee create), save provider config. `App.tsx` SHALL NOT inline these handler bodies.

#### Scenario: Handler ownership
- **WHEN** reading `apps/web/src/App.tsx`
- **THEN** no `async function handleArchiveCompany` / `function handleWizardComplete` / `async function handleCreatorDeploy` bodies appear — only destructured values returned from `useCompanyLifecycle(...)`

#### Scenario: Runtime reinit on provider save
- **WHEN** user saves provider config via the returned `saveConfig(config)` helper
- **THEN** `reinitRuntime()` is called exactly once, same as pre-refactor

### Requirement: Company bootstrap effects are standalone
Side effects coupled to `activeCompanyId` (overlay reset on company switch, template load, portal preview sync, `PENDING_VIEW_KEY` studio-edit resume, event log prime/dispose) SHALL live in `apps/web/src/hooks/useCompanyBootstrap.ts`. `App.tsx` SHALL NOT contain those `useEffect` blocks directly.

#### Scenario: PENDING_VIEW_KEY pickup still works
- **WHEN** `sessionStorage` has `offisim:pending-view` = `'studio-edit'` at next company mount
- **THEN** the bootstrap hook consumes the key (via `sessionStorage.removeItem`), sets `officeState.studioMode = 'edit'`, and opens the studio overlay — same as pre-refactor

#### Scenario: Template load side effect
- **WHEN** active company changes
- **THEN** the bootstrap hook loads `company.template_id` into `activeTemplateId` state and calls `onCompanySwitch(null)` if the company is missing, same as pre-refactor

### Requirement: Office state bindings hook is standalone
`updateOfficeState`, `onViewModeChange`, `onSceneFallbackTo2D`, `handleToggleDashboard`, `handleToggleKanban`, `onLayoutMetricsChange`, `handleSelectEmployee`, `handleUserMessage` SHALL be produced by `apps/web/src/hooks/useOfficeStateBindings.ts`.

#### Scenario: Office state writer path preserved
- **WHEN** any office-scoped callback mutates state
- **THEN** it SHALL call `updateWorkspaceState('office', updater)` inside the hook (upholding existing `workspace-state-management` spec — no standalone `setDashboardOpen` setter is introduced)

### Requirement: Keyboard shortcut hook is standalone
The Office / overlay / escape keyboard shortcut `useEffect` SHALL live in `apps/web/src/hooks/useAppKeyboardShortcuts.ts`. Its deps array SHALL be the minimum closure it reads; it SHALL continue to satisfy the `workspace-state-management` requirement that shortcuts only fire when `activeWorkspace === 'office'` (for Cmd+D / Cmd+J / Cmd+1 / Cmd+E) while Cmd+/ and Escape remain global.

#### Scenario: Cmd+D outside office is ignored
- **WHEN** user presses Cmd+D while `activeWorkspace === 'settings'`
- **THEN** the dashboard does NOT toggle — same as pre-refactor

#### Scenario: Escape unwind priority preserved
- **WHEN** Escape is pressed with `shortcutHelpOpen = true`
- **THEN** the help dialog closes first, overlay state is untouched — matching pre-refactor order (help → employeeEditor → overlay → goBack)

### Requirement: AppLayout composition moves to AppMainShell
The `AppLayout` render call with its 9 slot JSX (`header` / `agentPanel` / `sceneCanvas` / `chatDrawer` / `eventLog` / `centerContent` / `statusBar` / `chatDrawerMode` / `onLayoutMetricsChange`) SHALL live in `apps/web/src/components/app-shell/AppMainShell.tsx`. `App.tsx` SHALL NOT contain `<AppLayout ...>` JSX directly.

#### Scenario: AppLayout moved
- **WHEN** grepping `apps/web/src/App.tsx` for `<AppLayout`
- **THEN** zero matches exist — AppLayout usage is inside `AppMainShell.tsx` only

#### Scenario: AppMainShell is render-only
- **WHEN** reading `AppMainShell.tsx`
- **THEN** the component SHALL NOT declare `useState` / `useEffect` / `useMemo` business logic; it accepts props and returns JSX (top-level `React.lazy` declarations for `ChatDock` / `CollaborationSidebar` / `OfficeSceneSurface` are permitted; a local `WORKSPACE_TITLES` display-constant is permitted)

### Requirement: Overlay render host is a single component
The render branches for `activeOverlay === 'employee-creator' | 'office-editor' | 'company-select' | 'studio'` plus `officeState.dashboardOpen` / `kanbanOpen` / `marketplaceListingId !== null` SHALL live in `apps/web/src/components/app-shell/AppOverlayHost.tsx`. `App.tsx` SHALL NOT contain these JSX branches.

#### Scenario: Overlay branches moved
- **WHEN** grepping `apps/web/src/App.tsx` for `activeOverlay === 'studio'` or `officeState.dashboardOpen &&`
- **THEN** zero matches exist — the JSX lives in `AppOverlayHost.tsx`

#### Scenario: Overlay host is render-only
- **WHEN** reading `AppOverlayHost.tsx`
- **THEN** the component SHALL NOT declare `useState` / `useEffect`; it accepts props and returns JSX only (Suspense wrappers are permitted)

### Requirement: Global dialogs host is a single component
The render branches for `InstallDialog`, `EmployeeEditorDialog`, `CompanyEditor`, `KeyboardShortcutsDialog`, and both `CompanyCreationWizard` modes (`populate-existing` + `create-new`) SHALL live in `apps/web/src/components/app-shell/AppGlobalDialogs.tsx`. `App.tsx` SHALL NOT contain these JSX branches.

#### Scenario: Dialog branches moved
- **WHEN** grepping `apps/web/src/App.tsx` for `<InstallDialog` / `<EmployeeEditorDialog` / `<CompanyCreationWizard`
- **THEN** zero matches exist — they live in `AppGlobalDialogs.tsx`

#### Scenario: Wizard dual-mode branch preserved
- **WHEN** `isOffice && activeOverlay === null`
- **THEN** `AppGlobalDialogs` renders `CompanyCreationWizard mode="populate-existing"` — same trigger as pre-refactor
- **WHEN** `companyWizardMode === 'create-new'`
- **THEN** `AppGlobalDialogs` additionally renders `CompanyCreationWizard mode="create-new"` with `onDismiss` wired

### Requirement: Behavior is unchanged after refactor
For the same input (same active company, same provider, same live task), the user-visible behavior across workspace switching, overlay open/close, keyboard shortcuts, company lifecycle handlers, deep-link install, and onboarding copy rendering SHALL be byte-identical before and after the refactor.

#### Scenario: Company select → enter flow
- **WHEN** user enters the app with no active company, picks an existing company from the selection page, and clicks "Enter"
- **THEN** post-refactor: `switchCompany(id)` → `onCompanySwitch(id)` → `setActiveOverlay(null)` in the same order as pre-refactor; the Office workspace renders with `AppLayout` full slots

#### Scenario: Create-new wizard → studio handoff
- **WHEN** user clicks "Create new company" from the company-select overlay, completes the wizard in `create-new` mode, and clicks "Create your own"
- **THEN** post-refactor: `refreshCompanies()` fires, `portalPreviewCompanyId` is set, `sessionStorage['offisim:pending-view']` becomes `'studio-edit'`, `switchCompany(newId)` fires, and on next mount the studio overlay opens — matching pre-refactor order

#### Scenario: Archive company cleanup
- **WHEN** user archives a company that is currently active
- **THEN** post-refactor: `repos.companies.update(id, { status: 'archived' })` runs, `refreshCompanies()` fires, `portalPreviewCompanyId` rotates to the next non-archived company, and `onCompanySwitch(null)` fires — matching pre-refactor

### Requirement: App public API is preserved
The `App` component signature SHALL remain `(props: { onCompanySwitch: (id: string | null) => void }) => JSX.Element`. The module SHALL continue to default-export nothing and to named-export `App`. `apps/web/src/main.tsx` SHALL continue to work without import changes.

#### Scenario: Named export preserved
- **WHEN** `main.tsx` does `import { App } from './App'`
- **THEN** the import resolves and the signature matches pre-refactor
