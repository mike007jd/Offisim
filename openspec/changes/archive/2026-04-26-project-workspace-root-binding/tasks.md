## 1. Schema + types foundation

- [x] 1.1 Add `workspace_root` column to `projects` table in `packages/db-local/src/schema.ts`
- [x] 1.2 Create migration `packages/db-local/src/migrations/026_projects_workspace_root.sql` with `ALTER TABLE projects ADD COLUMN workspace_root TEXT;`
- [x] 1.3 Wire migration v34 entry into `apps/desktop/src-tauri/src/lib.rs::migrations()` (description + `include_str!` path) — also drops the SQL into `Docs/03_migrations/offisim_migrations_local_v0.1/034_projects_workspace_root.sql` since `lib.rs` `include_str!` references that canonical pack
- [x] 1.4 Update `ProjectRow` in `packages/shared-types/src/project.ts` to add `workspace_root: string | null`
- [x] 1.5 Add `formatWorkspaceRootHint(root: string | null): string` helper in same file (returns "No folder bound" for null, otherwise mid-truncated ~32-char hint preserving head + tail)
- [x] 1.6 Build shared-types: `pnpm --filter @offisim/shared-types build`

## 2. Repository three-backend sync

- [x] 2.1 Update `packages/core/src/runtime/repos/projects/drizzle.ts`: `create` writes `workspace_root`; `update` patch type accepts `{ workspace_root?: string | null }`; all reads carry the field — drizzle inherits typed patch from interface; `create` spreads `NewProject` which now includes `workspace_root` and inserts via Drizzle schema column added in 1.1
- [x] 2.2 Update `packages/core/src/runtime/repos/projects/memory.ts`: same surface; in-memory row carries field; update patch coerces `null` correctly
- [x] 2.3 Update `apps/web/src/lib/tauri-repos/projects.ts`: SQL `INSERT` / `UPDATE` SET / SELECT mapping all include `workspace_root`; row mapper reads column — uses Drizzle schema, picks up `workspace_root` automatically once schema column lands
- [x] 2.4 Update `ProjectRepository` interface in `packages/core/src/runtime/repositories.ts` so `update` patch type explicitly allows `workspace_root: string | null` (named `ProjectUpdatePatch` if simpler) — added `ProjectUpdatePatch` type in shared-types and re-exported via core
- [x] 2.5 Build core: `pnpm --filter @offisim/core build` (will rebuild after Section 3 because ProjectService still uses old signature)

## 3. ProjectService API reshape

- [x] 3.1 Change `ProjectService.createProject` signature in `packages/core/src/services/project-service.ts` to accept `{ name; description?; workspaceRoot? }` object input, with trim + null coercion as specified
- [x] 3.2 Update call site `packages/core/src/agents/boss-node.ts` (line ~327) to use object form
- [x] 3.3 Verify no other call sites: `grep -rn "createProject(" packages/core/src apps/web/src apps/platform/src` — all callers pass object literal (only ProjectService.createProject definition + boss-node call site found; useProjects hook uses `repos.projects.create` directly, will be updated in Section 11)
- [x] 3.4 Re-build core

## 4. Tauri plugin registration (dialog + opener)

- [x] 4.1 Add `tauri-plugin-dialog = "2"` and `tauri-plugin-opener = "2"` to `apps/desktop/src-tauri/Cargo.toml`
- [x] 4.2 Wire `.plugin(tauri_plugin_dialog::init())` and `.plugin(tauri_plugin_opener::init())` into `apps/desktop/src-tauri/src/lib.rs::run()` plugin chain (after single-instance, alongside fs / sql / cors-fetch)
- [x] 4.3 Append `dialog:default`, `dialog:allow-open`, `opener:default`, `opener:allow-reveal-item-in-dir`, `opener:allow-open-path` to `apps/desktop/src-tauri/capabilities/default.json` permissions array
- [x] 4.4 Add `@tauri-apps/plugin-dialog` and `@tauri-apps/plugin-opener` to the package that owns Tauri JS bindings (currently `apps/desktop` is dep-free shell, so wire deps into `packages/ui-office/package.json` since it consumes them through `folder-picker.ts`)
- [x] 4.5 Confirm desktop `cargo build` from `apps/desktop/src-tauri` succeeds with new plugins (`cargo check` clean — both `tauri-plugin-dialog v2.7.0` + `tauri-plugin-opener v2.5.3` compiled)

## 5. Web vite stubs

- [x] 5.1 Create `apps/web/src/polyfills/tauri-plugin-dialog.ts` with noop exports for `open` and other surface members consumed by `folder-picker.ts`
- [x] 5.2 Create `apps/web/src/polyfills/tauri-plugin-opener.ts` with noop exports for `revealItemInDir` and `openPath`
- [x] 5.3 Add both to the alias chain and `optimizeDeps.exclude` in `apps/web/vite.config.ts`
- [x] 5.4 Smoke `pnpm --filter @offisim/web dev` boot — 2026-04-26 live web @5176 booted; browser console error/warn check clean, no 404 on Tauri plugin stub paths

## 6. Platform abstraction module

- [x] 6.1 Create `packages/ui-office/src/lib/folder-picker.ts` exporting `pickWorkspaceFolder` / `revealWorkspaceFolder` / `isFolderPickerAvailable` / `FolderPickerUnavailableError`
- [x] 6.2 Implement Tauri branch via `@tauri-apps/plugin-dialog`'s `open({ directory: true, multiple: false })` and `@tauri-apps/plugin-opener`'s `revealItemInDir` (fallback `openPath`)
- [x] 6.3 Implement browser branch as throwing `FolderPickerUnavailableError`
- [x] 6.4 Use `isTauri()` from `packages/ui-office/src/lib/env.ts` (reads `__TAURI_INTERNALS__`)

## 7. ProjectCreateDialog

- [x] 7.1 Create `packages/ui-office/src/components/project/ProjectCreateDialog.tsx` reusing `dialog-shell` SSOT classes (DialogShell from `@offisim/ui-core`)
- [x] 7.2 Implement `mode: 'create' | 'edit'` plus optional `initial: ProjectRow`; controlled state for name / description / workspaceRoot
- [x] 7.3 Render Name input (required), Description textarea (optional), Workspace folder row
- [x] 7.4 Folder row desktop branch: path display + Choose button (calls `pickWorkspaceFolder`) + Clear button (sets to null) when bound
- [x] 7.5 Folder row web branch: muted "Available on desktop" text + sub-line "Folder binding is desktop-only — your project will still get a dedicated chat thread."
- [x] 7.6 Disable primary CTA when name is empty/whitespace; CTA label `Create project` (create mode) / `Save changes` (edit mode)
- [x] 7.7 On submit (create) call `onCreate({...})` (which forwards to `useProjects.createProject`) and the parent fires `onCreated` to set the new project active before closing
- [x] 7.8 On submit (edit) call `onUpdate(projectId, { name, description, workspace_root })` (which forwards to `useProjects.updateProject` → `repos.projects.update`) and close
- [x] 7.9 Esc / Cancel / outside click discard local state without persistence (DialogShell's standard behavior + `useEffect` reset on `open=false→true`)

## 8. ProjectSelector overhaul

- [x] 8.1 Remove inline create form (legacy `creating` / `newName` state and the submit form) from `packages/ui-office/src/components/project/ProjectSelector.tsx`
- [x] 8.2 Replace "New Project…" entry with a button that opens `ProjectCreateDialog` in `mode='create'` (via new `onRequestCreate` prop wired to App.tsx dialog state)
- [x] 8.3 Replace empty-state italic line with guided block: muted explanation + "Create your first project" CTA that opens the dialog
- [x] 8.4 Verify trigger chip still renders truncated active project name (no folder hint on chip — folder belongs to ContextStrip)

## 9. ChatPanel ProjectContextStrip

- [x] 9.1 Create `packages/ui-office/src/components/project/ProjectContextStrip.tsx`: takes `activeProject: ProjectRow | null` plus callbacks; returns `null` when activeProject is null
- [x] 9.2 Render `Project · {name} · {formatWorkspaceRootHint(workspace_root)}` as a single-line strip
- [x] 9.3 Open folder button — visible only when `isFolderPickerAvailable() && workspace_root != null`; on click call `revealWorkspaceFolder(path).catch(toast)`
- [x] 9.4 Edit button — opens `ProjectCreateDialog` with `mode='edit'` + `initial={activeProject}` (via parent `onRequestEditProject` → App.tsx dialog state)
- [x] 9.5 Mount strip at top of `packages/ui-office/src/components/chat/ChatPanel.tsx`, above existing tab strip, above all sub-tabs (team / direct chat both inherit it; replaced the legacy folder-icon banner that only rendered in team mode)

## 10. ProjectListPanel summary upgrade

- [x] 10.1 Add a "Workspace folder" labeled row to the right-side detail summary in `ProjectListPanel.tsx`, showing path or "No folder bound" (rendered as inline expansion under the selected card via new `<ProjectSelectedSummary>` block — panel is single-column, "right-side" interpreted as detail summary surface)
- [x] 10.2 Show task count + deliverable count from existing thread-scoped data sources (`repos.taskRuns.findByThread` one-shot + `useDeliverables()` filtered by `threadId`; no new event subscription)
- [x] 10.3 Add Edit affordance on the same summary that opens `ProjectCreateDialog` in edit mode (via new `onRequestEditProject` prop)

## 11. useProjects hook + types plumbing

- [x] 11.1 Update `useProjects.ts` `createProject` callback signature to take object input matching new ProjectService API; also added `updateProject(projectId, patch)` for the dialog edit path
- [x] 11.2 Confirm all consumers of `useProjects().createProject` pass object literal — App.tsx now wraps via `handleProjectDialogCreate`/`handleProjectDialogUpdate`; no positional callers remain
- [x] 11.3 Update `ProjectSelector` props — dropped `onCreateProject?: (name) => Promise<ProjectRow>`, added `onRequestCreate?: () => void`; AppMainShell prop renamed to `onRequestCreateProject`

## 12. Build sequence + typecheck

- [x] 12.1 Run dependency-ordered build: `shared-types → ui-core → core → ui-office → web` (per CLAUDE.md serial rule) — all rebuilt clean, web `vite build` produced expected chunks
- [x] 12.2 Run `pnpm typecheck` and confirm zero errors — turbo run all-clean (26 successful, 0 failed)
- [x] 12.3 Run `pnpm lint` and confirm zero errors — touched files all pass biome check after running `--write` for organizeImports + format; pre-existing repo-wide lint errors in unrelated files (skill-install-env.ts, github-tarball.ts, etc.) are not in this change's scope

## 13. CLAUDE.md + canonical spec follow-up plan

- [x] 13.1 Update root `CLAUDE.md` — added Project / ProjectContextStrip / folder-picker entries to the Key Files table, plus a Cross-Cutting Facts bullet on the workspace_root binding, Tauri plugin registration, web stub, and renamed `ProjectService.createProject` API
- [x] 13.2 Update `packages/ui-office/CLAUDE.md` — added a `Project (G1 — workspace_root binding)` section summarizing folder-picker SSOT, ProjectCreateDialog modes, ProjectContextStrip rules, useProjects API, the migration pair, the Tauri three-piece set, and the web vite stub gotcha
- [x] 13.3 Plan canonical spec sync at archive time: new `openspec/specs/project-workspace-binding/spec.md` — change spec already lives at `openspec/changes/project-workspace-root-binding/specs/project-workspace-binding/spec.md`; archive will move it under canonical specs path

## 14. Live verify (web @5176)

- [x] 14.1 Open ProjectSelector with zero projects → guided empty state with CTA appears
- [x] 14.2 Click "Create your first project" → ProjectCreateDialog opens, folder row reads "Available on desktop"
- [x] 14.3 Create with name only → row inserted with `workspace_root === null`; chip switches to new project (live UI evidence: strip and summary both render "No folder bound")
- [x] 14.4 Selected project → ProjectContextStrip appears above ChatPanel tabs with `Project · {name} · No folder bound`, Edit visible, Open folder hidden
- [x] 14.5 Click Edit → ProjectCreateDialog opens in edit mode, fields pre-populated, folder row remains web-disabled
- [x] 14.6 Save edit with new description → update flushes, strip re-renders new name if changed
- [x] 14.7 Switch to direct chat tab → strip remains visible
- [x] 14.8 Deselect project (All) → strip vanishes with no empty row
- [x] 14.9 ProjectListPanel selected project summary shows "Workspace folder · No folder bound" + task / deliverable counts — 2026-04-26 fixed missing mount by wiring ProjectListPanel into ProjectSelector dropdown, then live-verified @5176

## 15. Live verify (desktop release `.app`)

- [x] 15.1 Build release `.app` (per AGENTS.md desktop verify policy — `.app`, not dev binary) — `pnpm --filter @offisim/desktop tauri build` produced `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- [x] 15.2 Open ProjectCreateDialog → folder row shows Choose button
- [x] 15.3 Click Choose → OS folder picker appears; selecting `/Users/haoshengli/Documents` renders absolute path in dialog
- [x] 15.4 Cancel folder picker → dialog folder row state unchanged, no error
- [x] 15.5 Create project with folder → row persisted with absolute path; ProjectContextStrip shows truncated path
- [x] 15.6 Click Open folder → Finder opens at the bound path
- [x] 15.7 Edit project, click Clear → folder row resets to empty; Save → update persists `workspace_root: null`; strip drops folder segment, Open folder hidden
- [x] 15.8 Edit project, pick a different folder → Save → strip reflects new path; Open folder reveals the new directory
- [x] 15.9 Missing folder failure path → persisted row temporarily set to `/tmp/offisim-missing-folder-for-live-verify`; click Open folder shows toast "Folder not found at /tmp/offisim-missing-folder-for-live-verify. Edit project to rebind."; DB restored to `/Users/haoshengli/Documents` after verify
- [x] 15.10 Restart desktop → existing project row still present and folder binding still renders after selecting the project (migration v34 idempotent on existing DB)

## 16. Archive gate three-check (pre /opsx:archive)

- [x] 16.1 Spec consistency: re-read `specs/project-workspace-binding/spec.md` against landed code; wording still matches current create/edit, selector, strip, folder-picker, opener, and summary behavior
- [x] 16.2 Tasks consistency: every `[x]` has build/typecheck/live evidence; 15.9 documents the controlled missing-path setup used for failure toast
- [x] 16.3 Doc / comment consistency: root + ui-office CLAUDE.md updated; `rg "Project IDE deferred"` returns no stale claim
- [x] 16.4 Protocol ledger: Tauri row in `openspec/protocols-ledger.md` updated with the two new plugins (dialog + opener)
