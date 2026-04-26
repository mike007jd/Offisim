## ADDED Requirements

### Requirement: `projects.workspace_root` is the SSOT field for the optional local workspace folder

The `projects` table SHALL carry a nullable `workspace_root: TEXT NULL` column persisted in:
- SQLite schema (`packages/db-local/src/schema.ts`) and migration `026_projects_workspace_root.sql`
- Desktop embedded migrations (`apps/desktop/src-tauri/src/lib.rs::migrations()`) at the next schema version (v34)
- shared-types `ProjectRow` (`packages/shared-types/src/project.ts`) with type `string | null`
- All three repository backends (drizzle / memory / Tauri SQL) MUST read and write the field via `create` / `findById` / `findByCompany` / `findActiveByCompany` / `update`. The `update(id, patch)` mutator MUST accept `{ workspace_root: string | null }` as a valid partial patch (including explicit `null` for unbind).

No backfill is required — pre-existing project rows SHALL retain `workspace_root = NULL` and the UI SHALL render that as "no folder bound" without warning.

#### Scenario: Schema column exists across SQLite + shared-types
- **WHEN** inspecting `packages/db-local/src/schema.ts` `projects` table definition AND `packages/shared-types/src/project.ts` `ProjectRow` interface
- **THEN** both expose `workspace_root` as a nullable `string` field, byte-aligned in name and nullability

#### Scenario: Migration 026 is forward-only and additive
- **WHEN** applying migration 026 against an existing database with rows lacking `workspace_root`
- **THEN** the migration adds the column with default `NULL`, keeps `idx_projects_company` intact, and pre-existing rows survive with `workspace_root = NULL`

#### Scenario: All three repository backends read the field
- **WHEN** any of `createProjectsDrizzleRepos` / `createProjectsMemoryRepos` / `createProjectsTauriRepos` returns a `ProjectRow` from `findById`, `findByCompany`, `findActiveByCompany`, or `create`
- **THEN** the row contains `workspace_root` matching the persisted value (string or `null`)

#### Scenario: `update` patch accepts workspace_root including null unbind
- **WHEN** calling `repos.projects.update(projectId, { workspace_root: null })` after a folder was previously bound
- **THEN** subsequent `findById(projectId)` returns `workspace_root === null`

### Requirement: `ProjectService.createProject` takes a single object input

`ProjectService.createProject` SHALL accept a single input object `{ name: string; description?: string; workspaceRoot?: string | null }` and SHALL:
- trim `name` and reject empty result with a thrown error
- coerce empty / whitespace `description` to `null` before persistence
- coerce empty / whitespace `workspaceRoot` to `null` before persistence
- create the dedicated `graph_threads` row first (existing behavior) before inserting the project row, regardless of whether `workspaceRoot` is set

All call sites — `boss-node.ts`, `useProjects.ts`, `ProjectCreateDialog` — SHALL invoke the named-object form. Positional-argument form `createProject(name, description?)` SHALL no longer exist.

#### Scenario: Empty description coerces to null
- **WHEN** calling `createProject({ name: 'Acme', description: '   ' })`
- **THEN** the persisted row has `description === null`

#### Scenario: Workspace root provided round-trips
- **WHEN** calling `createProject({ name: 'Acme', workspaceRoot: '/Users/me/projects/acme' })`
- **THEN** the persisted row has `workspace_root === '/Users/me/projects/acme'`

#### Scenario: No positional form
- **WHEN** searching the codebase for `createProject(` calls
- **THEN** every call site passes a single object literal; no positional `(name, description)` invocation remains

### Requirement: Desktop folder picker goes through Tauri dialog plugin

On desktop (Tauri runtime, `__TAURI_INTERNALS__` present), folder selection SHALL go through `tauri-plugin-dialog`'s `open({ directory: true, multiple: false })` API surfaced via `pickWorkspaceFolder()` in a single shared module `packages/ui-office/src/lib/folder-picker.ts`. The Tauri side MUST register `tauri-plugin-dialog` in `apps/desktop/src-tauri/Cargo.toml` and `lib.rs::run()` plugin chain, AND MUST grant `dialog:default` plus `dialog:allow-open` permissions in `apps/desktop/src-tauri/capabilities/default.json`. The `apps/desktop/package.json` (or whichever package wraps Tauri JS bindings) MUST install `@tauri-apps/plugin-dialog`.

User cancellation of the system folder picker SHALL resolve `pickWorkspaceFolder()` to `null` without throwing. Selection SHALL resolve to the absolute path string returned by the dialog.

#### Scenario: Desktop pick returns absolute path
- **WHEN** the user clicks "Choose folder…" inside `ProjectCreateDialog` on desktop and selects `/Users/me/work/foo`
- **THEN** `pickWorkspaceFolder()` resolves with `'/Users/me/work/foo'` and the dialog state shows that path in the folder row

#### Scenario: Desktop cancel resolves null
- **WHEN** the user opens the picker and clicks Cancel without selecting
- **THEN** `pickWorkspaceFolder()` resolves with `null` and the existing folder field state is unchanged

#### Scenario: Capabilities permission grants
- **WHEN** inspecting `apps/desktop/src-tauri/capabilities/default.json`
- **THEN** the `permissions` array includes both `dialog:default` and `dialog:allow-open`

### Requirement: Web fallback disables folder binding without throwing

In browser mode (no `__TAURI_INTERNALS__`), `ProjectCreateDialog` SHALL render the folder row as a disabled hint reading "Workspace folder · Available on desktop" with no picker button. The vite alias chain in `apps/web/vite.config.ts` MUST stub `@tauri-apps/plugin-dialog` and `@tauri-apps/plugin-opener` to noop modules under `apps/web/src/polyfills/` so that browser dev-mode dynamic import does not 404.

`pickWorkspaceFolder()` in browser mode SHALL throw `FolderPickerUnavailableError` synchronously. UI SHALL never call it on web (the picker button is not rendered) — the error is the safety net for a misuse path, not a user-facing toast.

#### Scenario: Web dialog shows disabled folder row
- **WHEN** opening `ProjectCreateDialog` in browser mode
- **THEN** the folder row shows muted "Available on desktop" text, no Choose button, and a sub-line clarifying that the project still gets a dedicated chat thread

#### Scenario: Browser stub modules exist
- **WHEN** running `pnpm --filter @offisim/web dev`
- **THEN** dynamic imports of `@tauri-apps/plugin-dialog` and `@tauri-apps/plugin-opener` resolve to the stub polyfills without 404, and no console error mentions either plugin

#### Scenario: Programmatic misuse throws explicit error
- **WHEN** code in browser mode calls `pickWorkspaceFolder()` directly despite the UI gate
- **THEN** the call throws `FolderPickerUnavailableError` synchronously rather than silently returning `null`

### Requirement: `ProjectCreateDialog` is the single create + edit surface

`ProjectCreateDialog` SHALL be a single React component (`packages/ui-office/src/components/project/ProjectCreateDialog.tsx`) supporting `mode: 'create' | 'edit'` plus optional `initial: ProjectRow` for edit. It SHALL:
- reuse `@offisim/ui-core/dialog-shell.tsx` SSOT (`DIALOG_SIZING_CLASS`) so its size matches the `panel-and-dialog-sizing` capability
- render three rows: Name (required text input), Description (optional textarea), Workspace folder (desktop: path display + Choose / Clear buttons + path text; web: disabled hint as defined above)
- disable the primary CTA when name is empty / whitespace
- on submit (create) call `createProject({ name, description, workspaceRoot })` and, on success, set the new project as the active project before closing
- on submit (edit) call `repos.projects.update(initial.project_id, { name, description, workspace_root })` and close
- on Esc / Cancel discard local state without persistence

The legacy inline-create form on `ProjectSelector` SHALL be removed; "New Project…" SHALL open this dialog. An "Edit" entry on `ProjectContextStrip` SHALL open the dialog in edit mode pre-populated from `activeProject`.

#### Scenario: Create flow happy path with folder
- **WHEN** the user opens "New Project…", types "Acme", picks `/Users/me/work/acme`, and clicks Create
- **THEN** a new project row is inserted with `workspace_root = '/Users/me/work/acme'`, the dialog closes, and the new project becomes the active project

#### Scenario: Create flow without folder still works
- **WHEN** the user creates a project without choosing a folder
- **THEN** the project row is inserted with `workspace_root = null`, and chat thread / project lifecycle is unaffected

#### Scenario: Edit mode rebinds folder
- **WHEN** the user opens edit mode on an existing project, picks a different folder, and clicks Save
- **THEN** `repos.projects.update` is invoked with the new `workspace_root` and the dialog closes; ProjectContextStrip reflects the new path

#### Scenario: Edit mode unbinds folder via Clear
- **WHEN** the user opens edit mode on a project that has a folder bound and clicks "Clear" then Save
- **THEN** `repos.projects.update(id, { workspace_root: null })` is invoked and ProjectContextStrip drops the folder segment

#### Scenario: Empty name disables CTA
- **WHEN** the name input is empty or whitespace-only
- **THEN** the primary CTA is disabled and Enter / Submit does nothing

### Requirement: `ProjectSelector` empty state guides project creation

When `projects.length === 0` for the active company, `ProjectSelector` SHALL replace the bare "No projects yet" italic line with a guided empty state inside its dropdown:
- a one-line muted explanation that Project binds a chat thread (and on desktop a workspace folder)
- a primary CTA button reading "Create your first project" that opens `ProjectCreateDialog` in `mode='create'`

The CTA SHALL NOT replicate first-run wizard / onboarding cards — the empty state is local to the dropdown and never auto-pushes itself into the Office main area.

#### Scenario: Empty state shows guided CTA
- **WHEN** the user opens the project selector with zero existing projects
- **THEN** the dropdown body shows the muted hint and the "Create your first project" button, and clicking it opens `ProjectCreateDialog`

#### Scenario: Empty state suppressed once a project exists
- **WHEN** the user has at least one project
- **THEN** the dropdown shows the project list and the legacy "All / New Project…" affordances; the guided empty state is not rendered

### Requirement: `ProjectContextStrip` exposes Project context above ChatPanel

A new `ProjectContextStrip` component SHALL render at the top of `ChatPanel.tsx`, above its existing tab strip, only when `activeProject != null`. The strip SHALL:
- read `Project · {name}` and, when `workspace_root` is set, append `· {formatWorkspaceRootHint(workspace_root)}` (truncated mid-path so head + tail are visible, ~32 chars total)
- expose an "Open folder" button on desktop only when `workspace_root` is set
- expose an "Edit" button that opens `ProjectCreateDialog` in `mode='edit'` for the active project
- be invisible (zero rendered DOM, no empty row) when `activeProject == null`
- render identically for team chat and direct chat tabs (chat sub-tab change does not hide it)

`formatWorkspaceRootHint` SHALL live in `packages/shared-types/src/project.ts` so it is shared by other future surfaces.

#### Scenario: Strip appears with active project
- **WHEN** the user selects a project that has `name='Acme'` and `workspace_root='/Users/me/work/acme'`
- **THEN** ChatPanel renders a single-row strip "Project · Acme · /Users/…/work/acme" with Open folder + Edit affordances

#### Scenario: Strip hides folder segment when unbound
- **WHEN** the active project has `workspace_root = null`
- **THEN** the strip shows "Project · Acme · No folder bound" with no Open folder button (Edit remains visible)

#### Scenario: Strip vanishes when no active project
- **WHEN** `activeProjectId` is null
- **THEN** ChatPanel renders no project strip and no empty placeholder row above the tabs

#### Scenario: Strip persists across team / direct chat
- **WHEN** the user toggles between team chat and direct chat tabs while an active project is set
- **THEN** the strip remains visible with the same content; switching tabs never collapses it

### Requirement: Open folder action goes through Tauri opener plugin with explicit failure feedback

On desktop the Open folder button SHALL invoke `revealWorkspaceFolder(path)` which calls `tauri-plugin-opener`'s `revealItemInDir` (or `openPath` as fallback) with the persisted `workspace_root`. The Tauri side MUST register `tauri-plugin-opener` in `Cargo.toml` and `lib.rs::run()` plugin chain, AND MUST grant `opener:default` plus the relevant `opener:allow-reveal-item-in-dir` (and / or `opener:allow-open-path`) permissions in capabilities.

If the OS reveal call fails (path not found, permission denied), the UI SHALL surface a toast reading "Folder not found at <path>. Edit project to rebind." and SHALL NOT silently swallow the error. The button SHALL NOT render in browser mode.

#### Scenario: Open folder reveals in OS file manager
- **WHEN** the user clicks Open folder on desktop with a valid `workspace_root`
- **THEN** the OS file manager opens (Finder / Explorer / Files) showing that directory and no error toast is raised

#### Scenario: Open folder fails with toast guidance
- **WHEN** the user clicks Open folder on desktop with a `workspace_root` that no longer exists on disk
- **THEN** a toast reading "Folder not found at <path>. Edit project to rebind." appears and the strip remains as-is

#### Scenario: Open folder hidden in browser mode
- **WHEN** the user views ProjectContextStrip in browser mode
- **THEN** no Open folder button is rendered regardless of `workspace_root` value

### Requirement: `ProjectListPanel` summary surface exposes folder + counts

`ProjectListPanel` right-side detail summary SHALL, for the selected project:
- show `workspace_root` (or "No folder bound" when null) as a labeled row
- show task count and deliverable count for the project's `thread_id`
- expose the same Edit affordance as `ProjectContextStrip`

The counts SHALL come from existing thread-scoped task / deliverable repos; this requirement does not introduce a new event subscription channel — it surfaces existing data.

#### Scenario: Selected project shows folder row
- **WHEN** the user opens `ProjectListPanel` and selects a project with `workspace_root='/Users/me/work/acme'`
- **THEN** the right-side summary shows a "Workspace folder" labeled row with `/Users/me/work/acme` and an Edit button

#### Scenario: Project without folder shows fallback text
- **WHEN** the selected project has `workspace_root = null`
- **THEN** the summary shows "Workspace folder · No folder bound" with the Edit affordance to allow binding

#### Scenario: Counts match thread scope
- **WHEN** a selected project has 3 active tasks and 2 deliverables on its `thread_id`
- **THEN** the summary shows "3 tasks" and "2 deliverables" derived from the same data sources existing surfaces use

### Requirement: Platform branching is centralized in `folder-picker.ts`

A single module `packages/ui-office/src/lib/folder-picker.ts` SHALL hold all Tauri-vs-browser branching for folder picking and revealing. It SHALL export:
- `pickWorkspaceFolder(): Promise<string | null>` — desktop calls plugin-dialog; browser throws `FolderPickerUnavailableError`
- `revealWorkspaceFolder(path: string): Promise<void>` — desktop calls plugin-opener; browser throws `FolderPickerUnavailableError`
- `isFolderPickerAvailable(): boolean` — used by UI to gate button rendering, derived from `isTauri()` (which itself reads `__TAURI_INTERNALS__`, not `window.__TAURI__`)

No other module under `packages/ui-office/src/components/project/**` SHALL import `@tauri-apps/plugin-dialog` or `@tauri-apps/plugin-opener` directly.

#### Scenario: Components import only the wrapper module
- **WHEN** scanning `packages/ui-office/src/components/project/**/*.tsx` for imports
- **THEN** none import `@tauri-apps/plugin-dialog` or `@tauri-apps/plugin-opener`; only `folder-picker.ts` does

#### Scenario: `isTauri` source is `__TAURI_INTERNALS__`
- **WHEN** inspecting `folder-picker.ts` runtime detection
- **THEN** detection reads `globalThis.__TAURI_INTERNALS__` (or shared `isTauri()` helper that reads it), not `window.__TAURI__`
