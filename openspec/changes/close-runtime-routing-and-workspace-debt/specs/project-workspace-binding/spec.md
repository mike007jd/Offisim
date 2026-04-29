## MODIFIED Requirements

### Requirement: Desktop project picker SHALL include a workspace file tree

When a selected project has `workspace_root` and the app is running in desktop mode, `ProjectListPanel` SHALL render a compact workspace file tree in the selected-summary block.

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

## ADDED Requirements

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
