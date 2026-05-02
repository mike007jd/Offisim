# project-workspace-binding Specification

## Purpose
Project rows carry an optional local `workspace_root` folder binding alongside their dedicated chat thread. On desktop the folder is chosen and revealed through Tauri's dialog + opener plugins; the binding surfaces in the Office Workspace Project control, with the selector kept as a lightweight switcher and the folder/file context shown in the persistent Workspace summary. On the web frontend the folder field is a disabled hint, since File System Access semantics do not match the absolute-path model. This capability covers the schema column, the `ProjectService.createProject` object-input shape, the platform-branched folder-picker SSOT, the create / edit / unbind / reveal UI flows, and the desktop workspace file tree + text preview surface.
## Requirements
### Requirement: `projects.workspace_root` is the SSOT field for the optional local workspace folder

The `projects` table SHALL carry a nullable `workspace_root: TEXT NULL` column persisted in:
- SQLite schema (`packages/db-local/src/schema.ts`) and bootstrap SQL (`packages/db-local/src/schema.sql`)
- shared-types `ProjectRow` (`packages/shared-types/src/project.ts`) with type `string | null`
- All three repository backends (drizzle / memory / Tauri SQL) MUST read and write the field via `create` / `findById` / `findByCompany` / `findActiveByCompany` / `update`. The `update(id, patch)` mutator MUST accept `{ workspace_root: string | null }` as a valid partial patch (including explicit `null` for unbind).

No backfill is required — pre-existing project rows SHALL retain `workspace_root = NULL` and the UI SHALL render that as "no folder bound" without warning.

#### Scenario: Schema column exists across SQLite + shared-types
- **WHEN** inspecting `packages/db-local/src/schema.ts` `projects` table definition AND `packages/shared-types/src/project.ts` `ProjectRow` interface
- **THEN** both expose `workspace_root` as a nullable `string` field, byte-aligned in name and nullability

#### Scenario: Bootstrap schema carries workspace_root
- **WHEN** a fresh local SQLite DB is initialized from `packages/db-local/src/schema.sql`
- **THEN** the `projects` table contains nullable `workspace_root` and keeps `idx_projects_company`

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

The legacy inline-create form on `ProjectSelector` SHALL be removed; "New Project…" SHALL open this dialog. The Workspace Project control's "Edit" entry SHALL open the dialog in edit mode pre-populated from `activeProject`.

#### Scenario: Create flow happy path with folder
- **WHEN** the user opens "New Project…", types "Acme", picks `/Users/me/work/acme`, and clicks Create
- **THEN** a new project row is inserted with `workspace_root = '/Users/me/work/acme'`, the dialog closes, and the new project becomes the active project

#### Scenario: Create flow without folder still works
- **WHEN** the user creates a project without choosing a folder
- **THEN** the project row is inserted with `workspace_root = null`, and chat thread / project lifecycle is unaffected

#### Scenario: Edit mode rebinds folder
- **WHEN** the user opens edit mode on an existing project, picks a different folder, and clicks Save
- **THEN** `repos.projects.update` is invoked with the new `workspace_root` and the dialog closes; the Workspace Project control reflects the new path

#### Scenario: Edit mode unbinds folder via Clear
- **WHEN** the user opens edit mode on a project that has a folder bound and clicks "Clear" then Save
- **THEN** `repos.projects.update(id, { workspace_root: null })` is invoked and the Workspace Project control drops the folder segment

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

### Requirement: Workspace Project control exposes Project context

The Office Workspace panel SHALL own the active Project control. The desktop app header SHALL NOT render the Project selector in its main row, because Project is workspace context rather than global chrome. On narrow layouts, the Project selector MAY remain in the header overflow menu so the control is still reachable without a right rail.

The Workspace Project control SHALL:
- render in the right Workspace panel header when Office is active
- show the active Project selector as a lightweight switcher
- show the selected Project summary persistently in the Workspace panel below the selector and above the chat / task tabs
- show `Project · {name}` and, when `workspace_root` is set, append `· {formatWorkspaceRootHint(workspace_root)}` inside the selected summary
- expose an "Open" folder button on desktop only when `workspace_root` is set
- expose an "Edit" button that opens `ProjectCreateDialog` in `mode='edit'` for the active project
- keep the desktop header free of Project context, while narrow header overflow may show a compact Project summary with no workspace file tree
- be scoped to Workspace and not duplicate itself at the top of `ChatPanel`

`formatWorkspaceRootHint` SHALL live in `packages/shared-types/src/project.ts` so it is shared by other future surfaces.

#### Scenario: Workspace control appears with active project
- **WHEN** the user selects a project that has `name='Acme'` and `workspace_root='/Users/me/work/acme'`
- **THEN** the Workspace Project selector summary shows "Project · Acme · /Users/…/work/acme" with Open + Edit affordances

#### Scenario: Workspace control hides folder segment when unbound
- **WHEN** the active project has `workspace_root = null`
- **THEN** the selected summary shows "Project · Acme · No folder bound" with no Open button (Edit remains visible)

#### Scenario: ChatPanel has no duplicated project row
- **WHEN** `activeProjectId` is null
- **THEN** ChatPanel renders no project strip and no empty placeholder row above the message area

#### Scenario: Project control persists across chat / task tabs
- **WHEN** the user toggles between team chat and direct chat tabs while an active project is set
- **THEN** the Workspace Project control remains visible with the same content; switching chat/task tabs never collapses it

#### Scenario: Project selector dropdown stays lightweight
- **WHEN** the user opens the Project selector
- **THEN** the dropdown lists projects and may show compact metadata, but it does not host the workspace file tree or file preview navigation

### Requirement: Open folder action goes through Tauri opener plugin with explicit failure feedback

On desktop the Open folder button SHALL invoke `revealWorkspaceFolder(path)` which calls `tauri-plugin-opener`'s `revealItemInDir` (or `openPath` as fallback) with the persisted `workspace_root`. The Tauri side MUST register `tauri-plugin-opener` in `Cargo.toml` and `lib.rs::run()` plugin chain, AND MUST grant `opener:default` plus the relevant `opener:allow-reveal-item-in-dir` (and / or `opener:allow-open-path`) permissions in capabilities.

If the OS reveal call fails (path not found, permission denied), the UI SHALL surface a toast reading "Folder not found at <path>. Edit project to rebind." and SHALL NOT silently swallow the error. The button SHALL NOT render in browser mode.

#### Scenario: Open folder reveals in OS file manager
- **WHEN** the user clicks Open folder on desktop with a valid `workspace_root`
- **THEN** the OS file manager opens (Finder / Explorer / Files) showing that directory and no error toast is raised

#### Scenario: Open folder fails with toast guidance
- **WHEN** the user clicks Open folder on desktop with a `workspace_root` that no longer exists on disk
- **THEN** a toast reading "Folder not found at <path>. Edit project to rebind." appears and the Workspace Project control remains as-is

#### Scenario: Open folder hidden in browser mode
- **WHEN** the user views the Workspace Project control in browser mode
- **THEN** no Open folder button is rendered regardless of `workspace_root` value

### Requirement: Project selected summary exposes folder + counts

`ProjectSelectedSummary` SHALL, for the selected project:
- show the selected project name as Project context
- show `workspace_root` (or "No folder bound" when null) as a labeled row
- show task count and deliverable count for the project's `thread_id`
- expose the same Edit affordance as the Workspace Project control
- include the desktop workspace file tree when a workspace folder is bound and the summary is rendered in the persistent Workspace panel
- omit the desktop workspace file tree when the summary is rendered inside a transient selector dropdown

The counts SHALL come from existing thread-scoped task / deliverable repos; this requirement does not introduce a new event subscription channel — it surfaces existing data.

#### Scenario: Selected project shows folder row
- **WHEN** the user opens the Project selector and selects a project with `workspace_root='/Users/me/work/acme'`
- **THEN** the selected summary shows a "Workspace folder" labeled row with `/Users/me/work/acme` and an Edit button

#### Scenario: Project without folder shows fallback text
- **WHEN** the selected project has `workspace_root = null`
- **THEN** the summary shows "Workspace folder · No folder bound" with the Edit affordance to allow binding

#### Scenario: Counts match thread scope
- **WHEN** a selected project has 3 active tasks and 2 deliverables on its `thread_id`
- **THEN** the summary shows "3 tasks" and "2 deliverables" derived from the same data sources existing surfaces use

### Requirement: Desktop project picker SHALL include a workspace file tree

When a selected project has `workspace_root` and the app is running in desktop mode, `ProjectListPanel` SHALL render a compact workspace file tree in the persistent Workspace selected-summary block. Project selector dropdown summaries SHALL NOT render the file tree.

The file tree SHALL list directory entries through the Tauri `project_list_dir` command. For text previews shown inside the file tree, the tree SHALL use the bounded `project_read_file_preview(path, cwd, max_bytes)` command — NOT the unbounded `project_read_file` command. `project_read_file` remains available for agent tool calls (`read_file` builtin) where the tool schema enforces the byte budget; the file-tree UI MUST NOT call it. Both commands SHALL remain constrained by the same workspace-root sandbox and redacted error behavior as gateway file tools.

In browser mode the file tree SHALL render a desktop-only state and SHALL NOT invoke Tauri APIs.

The `<ProjectWorkspaceFiles>` component SHALL persist its navigation state (current path, selection, scroll position) across parent re-renders within the same `projectId`. Switching to a different project SHALL reset navigation state via the prop-driven effect (`workspaceRoot` change), NOT via `key=` re-mount.

#### Scenario: Desktop file tree lists project workspace
- **WHEN** a selected desktop project has `workspace_root='/Users/me/work/acme'`
- **THEN** the selected summary calls `project_list_dir` with `cwd='/Users/me/work/acme'`
- **AND** renders directory and file rows from the returned entries.

#### Scenario: File preview uses bounded preview command
- **WHEN** the user selects a file row in the desktop file tree
- **THEN** the UI calls `project_read_file_preview` with the selected relative path, the project's workspace root, and a `max_bytes` budget no larger than 8192
- **AND** the preview renders the returned `content` and shows a "preview truncated · {totalSize} bytes total" hint when `truncated === true`
- **AND** the UI MUST NOT call `project_read_file` for file-tree previews

#### Scenario: Large file preview does not stream full file across IPC
- **WHEN** the user selects a 10 MB log file
- **THEN** the IPC payload from `project_read_file_preview` is at most `MAX_PREVIEW_BYTES` (64 KB hard cap)
- **AND** the preview displays the first chunk with truncation hint
- **AND** total IPC bytes for that selection are bounded by the cap, NOT by file size

#### Scenario: Browser file tree is disabled
- **WHEN** the same project is viewed in browser mode
- **THEN** the summary shows a desktop-only file state
- **AND** no Tauri invoke or plugin-fs filesystem read is attempted.

#### Scenario: Nav state survives parent re-render
- **WHEN** the user navigates into a subfolder, selects a file, then the parent `ProjectListPanel` re-renders (e.g. via project list refetch returning a new project row reference for the same id)
- **THEN** `currentPath`, the selected file, and the preview remain visible
- **AND** the file tree does NOT re-fetch the directory listing solely because of the parent re-render

#### Scenario: Project switch resets nav state
- **WHEN** the user switches to a different project (different `projectId` and / or different `workspace_root`)
- **THEN** `currentPath` resets to the workspace root, selection clears, and the directory listing for the new workspace is fetched

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

### Requirement: Active project's `workspace_root` SHALL reach the desktop builtin tool sandbox

When a Tauri desktop runtime is active AND the active project has a non-null `workspace_root`, that active project SHALL be the only source for the Rust-side builtin tool sandbox (`apps/desktop/src-tauri/src/builtin_tools.rs`) before any builtin tool (`read_file` / `write_file` / `bash`) is invoked. The runtime SHALL NOT throw `'no project workspace root is bound'` when the data layer has a bound `workspace_root` for the active project. Desktop commands SHALL bind `company_id` and `project_id` together before accepting a workspace root, so a stale or cross-company project ID cannot widen the sandbox.

The binding SHALL be re-applied on:
- Initial runtime activation
- Active project switch within the same company
- Active company switch when the new active company has an active/default project with `workspace_root`
- Project edit that changes `workspace_root` from null to non-null OR between two non-null values

`ProjectService.activateProject()` SHALL emit a project-activated runtime signal after the DB status update and SHALL synchronize runtime context `activeProjectId` before the next builtin tool invocation. The desktop builtin-tool layer SHALL receive the active project ID and active company ID through trusted IPC/context propagation or through an equivalent trusted active-project pointer, and `workspace_roots()` SHALL resolve only that active company's active project's `workspace_root`; it MUST NOT scan all projects and accept stale roots from inactive projects.

#### Scenario: Builtin tool succeeds when active project has bound workspace_root
- **WHEN** the active project has `workspace_root = '/Users/x/proj-a'` AND the user asks the boss to read a file under that path
- **THEN** the builtin `read_file` tool runs successfully against the real filesystem (subject to existing read caps and path-sandbox guards)
- **AND** does NOT throw `'no project workspace root is bound'`

#### Scenario: Project switch re-binds workspace_root in Rust state
- **WHEN** the user switches the active project from one with `workspace_root = '/path/a'` to one with `workspace_root = '/path/b'`
- **THEN** runtime context `activeProjectId` changes to the second project before the next builtin tool invocation
- **AND** subsequent builtin tool invocations resolve relative to `/path/b`, not `/path/a`

#### Scenario: Old project root is blocked after switch
- **WHEN** the user switches the active project from `/path/a` to `/path/b`
- **AND** a builtin tool request attempts to read `/path/a/secret.txt`
- **THEN** the request is rejected by the workspace sandbox
- **AND** `/path/a` is not present in the Rust-side allowed root set for that invocation

#### Scenario: Switching to project with null workspace_root surfaces typed error
- **WHEN** the user switches to a project whose `workspace_root` is null
- **THEN** subsequent builtin tool invocations throw a typed error of the form `'no project workspace root is bound'`
- **AND** that error category is observable in the runtime event stream

#### Scenario: Harness proves project switch rebinds workspace root
- **WHEN** deterministic harness scenario `switch-project-rebinds-workspace-root` switches from project A to project B
- **THEN** the recorded builtin tool context contains project B's root
- **AND** the scenario asserts project A's root is no longer readable

### Requirement: Workspace-binding gaps SHALL emit an observable runtime event

When a builtin tool invocation fails because no `workspace_root` is bound, the runtime SHALL emit a `runtime_event` with `event_type='workspace-binding.unavailable'` and payload `{ companyId, projectId, expectedWorkspaceRoot, missingAt }` where `missingAt` is one of `'rust-state' | 'runtime-context' | 'project-switch'`. The event SHALL fire at most once per `(companyId, projectId)` tuple per session to avoid log spam from retry loops.

#### Scenario: First binding miss emits event with diagnostic payload
- **WHEN** a builtin tool invocation throws `'no project workspace root is bound'` for the first time in a session under a given `(companyId, projectId)` pair
- **THEN** a `workspace-binding.unavailable` event is emitted with the populated payload
- **AND** the event identifies the upstream layer (`rust-state` / `runtime-context` / `project-switch`) where the binding broke

#### Scenario: Repeated binding misses suppress duplicate events
- **WHEN** the same `(companyId, projectId)` pair triggers multiple binding-miss errors in the same session (e.g., the LLM retries the tool 5 times)
- **THEN** only the first miss emits an event; subsequent misses are suppressed

#### Scenario: Active company switch resets the suppression cache
- **WHEN** the user switches to a different active company and a binding miss occurs in the new company
- **THEN** the new company's first miss emits an event (suppression cache is per-`(companyId, projectId)`, not global)

### Requirement: Tauri `project_read_file_preview` command SHALL provide bounded text preview reads

`apps/desktop/src-tauri/src/builtin_tools.rs` SHALL export a Tauri command `project_read_file_preview(path: String, cwd: Option<String>, max_bytes: u32) -> Result<ProjectFilePreview, String>` where:
- `max_bytes` SHALL be clamped at the Rust side to `MAX_PREVIEW_BYTES = 65536` (64 KB hard cap) regardless of caller request
- The command SHALL read at most the clamped `max_bytes` from disk (using a bounded reader, NOT a full-file read followed by slice)
- The returned `ProjectFilePreview { content: String, truncated: bool, total_size: u64 }` SHALL contain valid UTF-8 in `content`
- If the byte slice ends mid-codepoint, the implementation SHALL walk back to the last valid UTF-8 boundary; if walk-back fails (binary file or pathological multi-byte content), it SHALL return `truncated: true` with `content: ''`
- `total_size` SHALL be the file's full size on disk (from `metadata().len()`) so the UI can show "X bytes total · preview truncated"
- The command SHALL respect the same `workspace_roots` sandbox as `project_read_file` (path canonicalization, parent-dir rejection, overbroad-root rejection, redacted errors)
- The command SHALL be added to the allowlist in `apps/desktop/src-tauri/permissions/fs-shell.toml` so the existing `offisim:fs-shell` capability covers it

`packages/ui-office/src/lib/project-workspace-files.ts` SHALL export `readProjectWorkspaceFilePreview(input: { workspaceRoot: string; path: string; maxBytes?: number }): Promise<ProjectFilePreview>` that calls the new command with a default `maxBytes: 8192`.

#### Scenario: Hard cap enforced server-side
- **WHEN** the JS caller invokes `project_read_file_preview` with `max_bytes: 1_000_000`
- **THEN** the Rust handler clamps the request to 65536 bytes before reading
- **AND** the returned `content.length` (in bytes when re-encoded) is at most 65536

#### Scenario: Truncation flag and total size returned for oversize file
- **WHEN** previewing a file whose on-disk size is 50 MB with `max_bytes: 8192`
- **THEN** the response has `truncated: true` and `total_size: 52428800` (or the actual byte count)
- **AND** the response payload across IPC is on the order of 8 KB, NOT 50 MB

#### Scenario: Small file returns un-truncated content
- **WHEN** previewing a 1 KB file with `max_bytes: 8192`
- **THEN** the response has `truncated: false`, `total_size: 1024` (approx), and `content` is the full file

#### Scenario: UTF-8 boundary safety
- **WHEN** the byte slice would end mid-codepoint (e.g. previewing a UTF-8 file with `max_bytes` chosen to cut a 3-byte sequence)
- **THEN** the returned `content` ends at the last valid UTF-8 boundary before the cut
- **AND** `truncated: true`

#### Scenario: Workspace sandbox enforced
- **WHEN** the caller passes `path: '../../etc/passwd'` (parent-dir traversal)
- **THEN** the command returns an error with the same redacted-path semantics as `project_read_file`
- **AND** no read is performed

#### Scenario: Capability allowlist update
- **WHEN** inspecting `apps/desktop/src-tauri/permissions/fs-shell.toml`
- **THEN** the allowlist contains `project_read_file_preview` alongside `project_read_file` and `project_list_dir`

### Requirement: `ProjectWorkspaceFiles` SHALL hold selection in a single state machine

`packages/ui-office/src/components/project/ProjectWorkspaceFiles.tsx` SHALL represent file selection as a single union-typed state (not as multiple coupled `useState`s):

```ts
type Selection =
  | null
  | { kind: 'loading'; path: string }
  | { kind: 'ready'; path: string; preview: string; truncated: boolean; totalSize: number }
  | { kind: 'error'; path: string; message: string };
```

Selection SHALL be managed by a `useReducer` (or equivalent state machine) with at minimum these actions: `select(path)` → `loading`, `previewLoaded(path, preview, truncated, totalSize)` → `ready`, `previewFailed(path, message)` → `error`, `clear()` → `null`. The component SHALL NOT keep parallel `selectedFile`, `preview`, `previewLoading`, and selection-error scalar `useState`s — invalid intermediate states (e.g. `previewLoading: true && selectedFile: null`) SHALL be unrepresentable.

The directory-loading state (`entries`, `directoryLoading`, `directoryError`) MAY remain a separate concern from selection, since they have independent lifecycles.

`<ProjectWorkspaceFiles>` SHALL NOT receive a `key=` prop from `ProjectListPanel`. Instead, an internal `useEffect` keyed on `workspaceRoot` SHALL reset `currentPath` to `''` and dispatch `clear()` on selection when the prop changes. This preserves project-switch-resets-state behavior without forcing remount on every parent re-render.

#### Scenario: Selection state machine has no invalid intermediates
- **WHEN** auditing `ProjectWorkspaceFiles.tsx` for selection-related `useState` calls
- **THEN** at most one `useState` / `useReducer` manages the selection union; no parallel `selectedFile` / `preview` / `previewLoading` scalars exist

#### Scenario: Loading transitions to ready on success
- **WHEN** the user clicks a file row and `readProjectWorkspaceFilePreview` resolves successfully
- **THEN** the selection transitions `null → loading → ready` with the path consistent across all states
- **AND** the preview pane shows `content` with truncation hint if `truncated === true`

#### Scenario: Loading transitions to error on failure
- **WHEN** the preview IPC call rejects
- **THEN** the selection transitions `loading → error` carrying the error message
- **AND** the preview pane shows the error in a styled error block

#### Scenario: Parent re-render preserves selection
- **WHEN** the parent `ProjectListPanel` re-renders without changing `workspaceRoot` or `projectId`
- **THEN** the file tree's `currentPath`, selection (including `ready` preview content), and scroll position remain unchanged
- **AND** the directory listing is NOT re-fetched solely because of the parent re-render

#### Scenario: Workspace switch resets via prop effect
- **WHEN** the parent passes a different `workspaceRoot` value
- **THEN** an internal effect resets `currentPath` to `''` and clears the selection
- **AND** a directory listing for the new workspace is fetched

### Requirement: Workspace-relative path adapters SHALL reject path escape attempts

Any UI or skill-install adapter that accepts a workspace-relative file path SHALL reject `..` traversal, absolute-path substitution, and encoded path segments that escape the active project workspace root. This includes `apps/web/src/lib/tauri-skill-install-adapters.ts`; the implementation MUST keep the current path-escape defense as a durable workspace-sandbox invariant.

#### Scenario: `..` path is rejected before Tauri invocation
- **WHEN** a skill-install adapter is asked to write `../outside/SKILL.md`
- **THEN** the adapter rejects the request before invoking any Tauri command
- **AND** no file outside the active project workspace root is read or written

#### Scenario: Encoded traversal is rejected
- **WHEN** a workspace-relative path contains an encoded traversal segment such as `%2e%2e/outside.txt`
- **THEN** the adapter normalizes or rejects the segment so it cannot escape the active workspace root
- **AND** the failure is surfaced as a sandbox/path validation error, not as a silent fallback
