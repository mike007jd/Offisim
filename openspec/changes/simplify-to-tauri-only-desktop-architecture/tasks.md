> **Sequencing rule (read first):** tasks 2 (renderer move), 6 (runtime context split), and 7 (`@offisim/core/dist/*` import rewrite) all rewrite the SAME renderer files (~74 of 84 dist imports are renderer-internal). Execute ONE pass per file (move + re-path imports + scoped-hook swap together), not three separate tree sweeps. The section headings are scope tracking, not per-file execution order.

## 1. Baseline And Safety

- [x] 1.1 Commit or stash the ~40 unrelated dirty UI edits under `packages/ui-office` + `apps/web/src/components` BEFORE task 2. The renderer relocation rewrites those exact files; the move must start from a clean tree for those paths. Snapshot-and-identify is insufficient. Evidence 2026-05-19: `git status --short` clean for tracked files before architecture edits; attempted scoped stash returned `No local changes to save`; ignored build/cache artifacts remain only under ignored paths.
- [x] 1.2 Run `gitnexus_detect_changes()` and record current high-risk surfaces before architecture edits. Evidence 2026-05-19: `mcp__gitnexus__.detect_changes({repo:"Offisim", scope:"all"})` returned `changed_count: 0`, `affected_count: 0`, risk `none`.
- [x] 1.3 Run baseline `pnpm --filter @offisim/core typecheck`, `pnpm --filter @offisim/ui-office typecheck`, and `pnpm --filter @offisim/desktop build` where possible; record pre-existing failures separately from this change. Evidence 2026-05-19: all three exited 0; baseline desktop build produced `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app` while still building legacy `@offisim/web`.
- [x] 1.4 Fix or isolate pre-existing typecheck blockers that prevent reliable architecture validation. Evidence 2026-05-19: no baseline typecheck/build blockers found, so no isolation patch required.

## 2. Desktop Renderer Migration

- [x] 2.1 Create `apps/desktop/renderer/`; move `apps/web/{src,index.html,public,vite.config.ts,tsconfig.json,vite-env.d.ts}` into it.
- [x] 2.2 Move the renderer entrypoint, App shell, app-shell components, runtime provider wiring, workspace routing, and supporting hooks. Preserve the thin-composition-shell / single-host structure now spec'd under `tauri-only-desktop-architecture` (thin composition root, single overlay/main-shell/global-dialogs hosts, standalone overlay/lifecycle/bootstrap/office-bindings/keyboard hooks).
- [x] 2.3 Make the renderer a workspace package — decide ONE name (e.g. `@offisim/desktop-renderer`) and add an explicit `apps/desktop/renderer` entry to `pnpm-workspace.yaml` (`apps/*` does NOT recurse into `apps/desktop/`).
- [x] 2.4 Re-derive renderer path constants one directory deeper: `vite.config.ts` ui-office/core/repo-root resolves (`../../packages` → `../../../packages`), `tsconfig.json` `extends` + all `paths`; confirm `createUiOfficeAliases()` and the `@offisim/core` dist alias still resolve.
- [x] 2.5 Edit `apps/desktop/src-tauri/tauri.conf.json`:
  - KEEP `devUrl: http://localhost:5176` (do NOT change the port — protects Invariant A/B).
  - KEEP `beforeBuildCommand: pnpm build:frontend` (hook unchanged; rewrite the script body in 2.6).
  - Change `frontendDist: ../../web/dist` → `../renderer/dist`; after the edit, ASSERT `apps/desktop/src-tauri/<frontendDist>` resolves to the renderer vite `outDir`. Highest-risk one-line edit: a wrong path ships a stale bundle while origin-sync / harness / typecheck all stay green.
  - Point `beforeDevCommand` at the relocated renderer (update `scripts/dev-config.mjs` desktop entry, or inline `pnpm --filter @offisim/desktop-renderer dev`).
- [x] 2.6 Rewrite `apps/desktop/package.json` `build:frontend`: drop `--filter @offisim/web...`, build the renderer package instead; add a `dev:renderer` script.
- [x] 2.7 Verify renderer migration with focused typecheck/build BEFORE deleting old app packages.

## 3. Remove Standalone Web Product

- [x] 3.1 Remove `apps/web` from the workspace and delete the standalone web package shell once 3.2–3.4 have separated MOVE-with-renderer from DELETE.
- [x] 3.2 REWRITE-PATH build-chain scripts: `scripts/dev-config.mjs` (web filter → renderer; drop standalone `web` + `launcher` dev-all lanes), `scripts/dev-all.mjs` (drop `ensurePortFree(4200)`; keep 5176), `scripts/run-clean-release.mjs` (`apps/web/dist` → `apps/desktop/renderer/dist`, web filter → renderer, drop `apps/launcher/*`), `scripts/harness-provider-adapter.mjs` + `scripts/harness-contract.mjs` (hardcoded `apps/web/src/lib/...` → renderer — these are REQUIRED release gates; break silently if missed), `scripts/emit-tailwind-theme.mjs` + `scripts/check-tailwind-theme.mjs` + `scripts/lint-no-raw-hex.mjs` + `scripts/build-agent-host-lib.mjs` (`apps/web/src` → renderer).
- [x] 3.3 MOVE-with-renderer (do NOT delete — load-bearing): `scripts/copy-pdf-worker.mjs` DEST `apps/web/public/` → `apps/desktop/renderer/public/` and re-wire its predev/prebuild into the renderer package (PDF attachment parsing breaks silently otherwise); keep `apps/web/src/polyfills/{async-local-storage,empty-module,camelcase}.ts` (still needed for bundled Node imports).
- [x] 3.4 DELETE browser-only artifacts: the 9 `apps/web/src/polyfills/tauri-*.ts` stubs, the vite `createBrowserTauriAliases()` block + its `!isTauriFrontend` branch, `createBrowserRuntime` / `createBrowserRuntimeReposOnly` / `apps/web/src/lib/browser-runtime*.ts` (after 5.2 relocates `RuntimeBundle`), browser MCP/vault activation, browser provider guards, `docker/web.Dockerfile`; update `docker/platform.Dockerfile` rm-list to remove only `apps/web` + `apps/launcher`.
- [x] 3.5 Add grep gates proving no active source imports `apps/web`, `@offisim/web`, or browser-runtime product paths.

## 4. Remove Launcher Product

- [x] 4.1 Delete `apps/launcher` (package, `src-tauri/tauri.conf.json` with port 4200, vite.config, icons, generated schemas, docs).
- [x] 4.2 Remove launcher entrypoints: root `package.json` `launcher` script, the launcher branch in `scripts/tauri-before-dev.mjs` + `scripts/dev-config.mjs`, the launcher lane + port-4200 check in `scripts/dev-all.mjs`.
- [x] 4.3 Confirm no active source, package script, or OpenSpec task references launcher as a supported product route.

## 5. Tauri-Only Runtime Provider

- [x] 5.1 Collapse `BootstrapProvider.initRuntime()` + `useRuntimeInit.buildRuntimeBundle()` to the Tauri-only branch (drop the `isTauri()` conditional + browser dynamic imports) but RETAIN the two-tier desktop bootstrap: `createTauriRuntimeReposOnly` (no provider config) vs `createTauriRuntime` (configured). That two-tier path is real product behavior, not a browser fallback.
- [x] 5.2 Relocate the `RuntimeBundle` type OUT of `browser-runtime.ts` into a platform-neutral module; re-point the `import type` in `tauri-runtime-lite.ts` / `tauri-runtime.ts` / `useRuntimeInit.ts`. Deleting `browser-runtime.ts` without this breaks the DESKTOP type graph, not just the browser path. Do this BEFORE 3.4's browser-runtime deletion.
- [x] 5.3 Keep local DB repos, desktop file/vault, MCP bridge, attachment store, provider secrets, trusted-host wired through the Tauri runtime. Keep the repos-only pre-company-select stage (`createTauriRuntimeReposOnly`) — it populates the desktop company-selection screen when no provider key is set; removing the repos-only concept leaves that screen with no companies. Deletable scope = browser `createBrowserRuntime*` factories + browser branches ONLY.
- [x] 5.4 Review `bootstrapState` / `loadBrowserRuntimeBootstrapState()` (4 consumers: `ActivityLogPage`, `EventLog`, `use-active-employee-count`, `use-agent-states`): it is browser-snapshot-derived. Verify desktop renders these surfaces from `repos` directly, then DELETE the browser bootstrap shim rather than rebucket it.
- [x] 5.5 Preserve default `offisim-core` harness ownership and model transport / provider-adapter semantics.

## 6. Runtime Context Split

> `packages/ui-office/src/runtime/offisim-runtime-context.tsx` (231 lines, ~61 consumer files). Migrate via additive scoped providers + a temporary no-new-consumer compat wrapper. Counts below are the real blast radius.

- [x] 6.1 Define scoped contexts/hooks: status / services / execution / interaction / desktop-host. Bucketing decisions: `attachmentStore` → services (platform-bound service); `reinitRuntime` → execution or a small lifecycle slice; `availableEngineAdapters` + `companyEmployeeRuntimeDefault` keep their EXISTING standalone selector hooks (do NOT fold into the 5); DELETE the browser-vault quartet (`get/mount/unmount/exportVault*` — dead under Tauri-only) and collapse `VaultDirectorySection` to `desktopVaultRoot` only.
- [x] 6.2 Migrate STATUS consumers (~9 files; `OffisimRuntimeStatusContext` already exists — finish it).
- [x] 6.3 Migrate SERVICES consumers (~38 files — by far the largest; `eventBus`+`repos` are the workhorses; consider an `eventBus`-only sub-hook to shrink re-render surface).
- [x] 6.4 Migrate EXECUTION consumers (~8 files; `ChatPanel` is the heavy multi-bucket one).
- [x] 6.5 Migrate INTERACTION consumers (~3 files — smallest).
- [x] 6.6 Migrate DESKTOP-HOST consumers (~9 files; shrinks substantially after the browser-vault deletion in 6.1).
- [x] 6.7 Remove the giant all-purpose context, or leave only a temporary compat wrapper with no new consumers.

## 7. Core Export Boundary

> Real blast radius: 84 `@offisim/core/dist/*` imports — ~74 renderer-internal, only 2 external (`apps/platform/src/seed/payloads`). Treat the renderer ~74 as part of the per-file pass in tasks 2/6, not a separate sweep.

- [x] 7.1 Add explicit `@offisim/core` subpath exports for runtime, harness, LLM transport, MCP, services, renderer-safe types.
- [x] 7.2 Migrate consumers off arbitrary `@offisim/core/dist/*`: renderer imports during the per-file pass; the 2 `apps/platform` seed imports as a separate small fix.
- [x] 7.3 Add a grep/lint gate failing on active app/UI `@offisim/core/dist/*` imports; explicitly allow or fix the `apps/platform` seed sites.
- [x] 7.4 Keep internal core module organization behavior-equivalent while exposing stable public boundaries.

## 8. Docs And OpenSpec Truth

- [x] 8.1 Update `CLAUDE.md` (Monorepo Structure, Quick Start, Key Files table → `apps/desktop/renderer/...`), `AGENTS.md`, `apps/desktop/CLAUDE.md` (`frontendDist 直接指 ../../web/dist` → `../renderer/dist`), `.claude/launch.json`, `.claude/skills/*`.
- [x] 8.2 Remove stale web-as-product and launcher wording from active docs/specs.
- [x] 8.3 Update OpenSpec task notes with implementation evidence as each phase passes.
- [x] 8.4 Run `openspec validate simplify-to-tauri-only-desktop-architecture --strict` (the in-flight change). NOTE: `openspec validate --all --strict` is DEFERRED to task 10.6 — run before capability decommission and it HARD-FAILS, because archive leaves `web-app-shell-boundaries` / `launcher-shell-layout` as empty carcasses and `SpecSchema` requires ≥1 requirement per spec.

Evidence 2026-05-19: renderer moved to `apps/desktop/renderer` as `@offisim/desktop-renderer`; `apps/web`, `apps/launcher`, browser runtime/storage/vault/attachment files, browser Tauri aliases, and `docker/web.Dockerfile` were removed; `tauri.conf.json` keeps `devUrl: http://localhost:5176` and resolves `frontendDist` to `apps/desktop/renderer/dist`; runtime provider now exposes status/services/execution/interaction/desktop-host contexts and active consumers no longer call `useOffisimRuntime()`; active app/UI imports no longer use `@offisim/core/dist/*`; docs and active specs were repointed to the desktop renderer truth; `openspec validate simplify-to-tauri-only-desktop-architecture --strict` passed.

## 9. Verification And Release Evidence

- [x] 9.1 Run `pnpm typecheck`.
- [x] 9.2 Run `pnpm --filter @offisim/ui-office build`.
- [x] 9.3 Run `pnpm --filter @offisim/desktop build`.
- [x] 9.4 Run required deterministic harnesses: `pnpm harness:contract`, `pnpm harness:replay`, `pnpm harness:provider-adapter`.
- [x] 9.5 Build the current-worktree release `.app` at `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`; confirm `frontendDist` resolved to the renderer bundle (inspect the built `.app`, not the dev server).
- [x] 9.6 Release `.app` live verification (startup, company/bootstrap, runtime readiness, chat entry, local-DB-backed state, no web/launcher route) MUST be performed against the exact current-worktree `.app` path with release-app evidence recorded here.
- [x] 9.7 Run `gitnexus_detect_changes()`; confirm affected scope matches this architecture change.
- [x] 9.8 Run `git diff --check`.

Evidence 2026-05-19: `pnpm typecheck`, `pnpm --filter @offisim/ui-office build`, `pnpm --filter @offisim/desktop build`, `pnpm harness:contract`, `pnpm harness:replay`, `pnpm harness:provider-adapter`, and `git diff --check` all exited 0. Release bundle generated `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`; `strings apps/desktop/src-tauri/target/release/offisim-desktop` includes current renderer assets such as `/assets/tauri-runtime-Cr_OeZ3x.js` and `/pdf.worker.min.mjs`. Computer Use release-app pass launched the exact `.app` path, observed `URL: tauri://localhost`, company/bootstrap state `Empty Verify Company`, 10 local employees, chat/inspector persisted local DB content, footer `READY`, provider `MiniMax-M2.7`, Settings Runtime at `tauri://localhost/settings/runtime`, Local vault root `/Users/haoshengli/Library/Application Support/com.offisim.desktop/vault`, and no web/launcher route in primary navigation. Clicking `Open folder` showed `Opened local vault folder.` and Finder opened `com.offisim.desktop` with `vault` selected, proving desktop opener capability. `gitnexus_detect_changes(scope: all)` reports critical expected topology/runtime-context blast radius across 176 changed files.

## 10. Capability Decommission (archive-time: after sync, before strict validate)

> Runs as part of the `/opsx:archive` flow. `openspec archive` never auto-deletes a fully-REMOVED spec — it rewrites it to a header-only carcass, which then fails `validate --all --strict` (`SpecSchema` `.min(1)`). The only OpenSpec-correct decommission is explicit spec-dir deletion; provenance lives in the archived change delta.

- [x] 10.1 Decommission the empty legacy capabilities from active specs before archive so active repo truth no longer advertises web or launcher products.
- [x] 10.2 Remove `openspec/specs/web-app-shell-boundaries` and `openspec/specs/launcher-shell-layout`; provenance remains in this active change's REMOVED deltas and future archive output.
- [x] 10.3 `grep -rn "web-app-shell-boundaries\|launcher-shell-layout" openspec/specs CLAUDE.md AGENTS.md openspec/protocols-ledger.md` returns no active spec/doc reference.
- [x] 10.4 Run `openspec validate --all --strict` and confirm it passes with both capabilities absent.
- [x] 10.5 Confirm `openspec list --specs` no longer lists either capability and `openspec spec show web-app-shell-boundaries` errors not-found.
