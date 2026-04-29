## 1. URL routing module: types + parser + serializer

- [ ] 1.1 Create `apps/web/src/lib/url-routing/types.ts` exporting `ParsedUrl`, `ParsedInitialState`, `UrlOverlayKey` (subset of `OverlayKey` excluding `'company-select'`), `UrlSyncMode = 'push' | 'replace'`, and the `WorkspaceRoute` discriminated union (one shape per workspace + overlay).
- [ ] 1.2 Create `apps/web/src/lib/url-routing/parser.ts` exporting `parseUrl(loc: { pathname: string; search: string }): ParsedUrl` and `parseInitialUrl(): ParsedInitialState`. The parser SHALL implement the full URL Grammar Table from the design doc, including the 6 workspaces (Office, SOPs, Market, Personnel, Activity, Settings) and the `office-editor` / `employee-creator` / `studio` overlays.
- [ ] 1.3 Implement workspace-specific parsers in `parser.ts`: `parseOfficePath`, `parseSopsPath`, `parseMarketPath`, `parsePersonnelPath`, `parseActivityPath`, `parseSettingsPath`. Each returns `Partial<WorkspaceSessionState>` plus optional overlay key. Unknown segments SHALL fall through to the workspace base default.
- [ ] 1.4 Implement `apps/web/src/lib/url-routing/serializer.ts` exporting `serializeUrl(state: { workspace, sessionState, overlay }): string` plus per-workspace helpers (`serializeOfficeUrl`, `serializeSopsUrl`, `serializeMarketUrl`, `serializePersonnelUrl`, `serializeActivityUrl`, `serializeSettingsUrl`). Round-trip identity is contract: `parseUrl(serializeUrl(state)) === state` for every state in the canonical corpus.
- [ ] 1.5 Implement `apps/web/src/lib/url-routing/fallback.ts` exporting `applyFallbackRules(parsed: ParsedUrl, runtime: { activeCompanyId, agents, sops, listings }): { result: ParsedUrl; toast?: { message: string; level: 'info' } }`. Implements the Decision 5 fallback table: missing primary entity emits info toast; cosmetic param drops are silent.
- [ ] 1.6 Implement `apps/web/src/lib/url-routing/index.ts` re-exporting the public API (`parseUrl`, `serializeUrl`, `parseInitialUrl`, `applyFallbackRules`, types).
- [ ] 1.7 Add a unit-style guard inside `parser.ts` that warns (`console.warn`) if `pathname.length > 1024` or `search.length > 1024` and truncates inputs — defensive guard for malformed deep links from external sources.
- [ ] 1.8 Implement `serializeUrl` to use `encodeURIComponent` for free-text values (`q`, `actor`, search strings) and to drop empty-string params from the query.

## 2. useUrlSync hook + popstate handling

- [ ] 2.1 Create `apps/web/src/lib/url-routing/useUrlSync.ts` exporting `useUrlSync({ workspace, sessionState, overlay, activeCompanyId, applyParsed }): void`. Internally uses `useSyncExternalStore` over a single `popstate` subscription.
- [ ] 2.2 The hook SHALL compute `nextUrl = serializeUrl(currentInputs)` on every render and compare to `window.location.pathname + window.location.search`. If different AND the change is not popstate-driven, emit `history.replaceState(null, '', nextUrl)` for in-place changes, `history.pushState(null, '', nextUrl)` for workspace-identity changes (per Decision 4).
- [ ] 2.3 The hook SHALL classify a change as identity-change vs in-place: identity-change includes (a) `workspace` differs from previous, (b) overlay key differs, (c) primary entity in path differs (employee id, sop id, etc), (d) Office viewMode toggles, (e) Office overlay flags toggle (dashboard/kanban/marketplace listing). All other changes are in-place.
- [ ] 2.4 The popstate listener SHALL call `parseUrl(window.location)`, then `applyFallbackRules(parsed, runtime)`, then call the `applyParsed(result)` callback, which writes through `setActiveWorkspace`, `updateWorkspaceState`, and `setActiveOverlay`. Fall-back toast emission SHALL happen at this layer.
- [ ] 2.5 Suppress URL writes during the popstate-driven re-application — use a ref-based `isApplyingPopstate` flag set true before the setter calls and reset after a microtask. Avoids the loop `popstate → setState → useUrlSync → pushState`.
- [ ] 2.6 Verify React 19 strict-mode double-mount tolerance — popstate subscription must clean up cleanly on unmount.

## 3. App.tsx initialization

- [ ] 3.1 At module load (or in a `useState` initializer running once), call `parseInitialUrl()` to compute the initial `{ workspace, sessionPatch, overlay }` triple.
- [ ] 3.2 Pass `initial` prop to `useWorkspaceSessionState({ initial })` and `useOverlayState({ initial })`.
- [ ] 3.3 Wire `useUrlSync` once at the App level, hand it the live `(activeWorkspace, workspaceSessionState, activeOverlay, activeCompanyId)` snapshot plus the `applyParsed` callback that calls the three setters.
- [ ] 3.4 Handle the company-select gate (Decision 6): if `activeCompanyId === null` AND the parsed URL targets a non-Office workspace OR a primary entity, hold the parsed result in a `pendingDeepLinkRef`. After `activeCompanyId` becomes non-null, replay the stored URL via `applyParsed` then clear the ref.
- [ ] 3.5 Add a popstate listener that clears `pendingDeepLinkRef` if the user navigates back during the company-select gate.

## 4. useWorkspaceSessionState refactor

- [ ] 4.1 Modify `apps/web/src/components/workspaces/useWorkspaceSessionState.ts` signature to accept `{ initial?: { activeWorkspace?: WorkspaceKey; sessionPatch?: Partial<WorkspaceSessionState> } }`.
- [ ] 4.2 In the `useState` initializer, merge `initial.sessionPatch` over `createDefaultSessionState()` and use `initial.activeWorkspace ?? 'office'`.
- [ ] 4.3 Remove the `historyStack: WorkspaceKey[]` field from `InternalState` — back navigation now flows through `popstate` parsing rather than an internal stack.
- [ ] 4.4 Update `setActiveWorkspace` to no longer push onto the history stack; just update active workspace + run the existing office-leave cleanup.
- [ ] 4.5 Update `goBack` to call `window.history.back()` instead of unwinding through `historyStack`. Internal drill-in (the `tryWorkspaceInternalBack` rules) is now invoked only by Escape-key shortcut handlers, NOT by browser back.
- [ ] 4.6 `canGoBack` SHALL return `hasInternalDrillIn(activeWorkspace, sessionState) || window.history.length > 1`.
- [ ] 4.7 Verify `tryWorkspaceInternalBack`, `hasInternalDrillIn`, `resolveBackNavigation` exports remain (they are still used by the Escape handler), but `BackNavigationOutcome` semantics adjust: `'workspace'` outcome now means "let browser back fire", `'internal'` means "consumed locally + replaceState the URL".

## 5. useWorkspaceBackNavigation refactor

- [ ] 5.1 Modify `apps/web/src/components/workspaces/useWorkspaceBackNavigation.ts` to remove the initial `pushState({ workspace })` mount call.
- [ ] 5.2 Replace the `popstate` handler with a delegation to the URL-driven path: `popstate` no longer triggers `goBack()` — instead it triggers `parseUrl(window.location) → applyFallbackRules → applyParsed`. The whole hook becomes a thin compatibility wrapper that the App can keep importing.
- [ ] 5.3 Internal drill-in unwind via Escape SHALL go through a separate Escape handler in `useAppKeyboardShortcuts` that calls `tryWorkspaceInternalBack`, then writes the result via `updateWorkspaceState`. The URL syncs through `useUrlSync` automatically (replaceState).

## 6. useOverlayState refactor

- [ ] 6.1 Modify `apps/web/src/hooks/useOverlayState.ts` signature to accept `{ initial?: OverlayKey | null; activeCompanyId: string | null }`.
- [ ] 6.2 Initialize `activeOverlay` from `initial` if present, else fall back to existing rule (`'company-select'` if no company).
- [ ] 6.3 The setter functions (`openStudio`, `openEmployeeCreator`, `openOfficeEditor`, `openCompanySelect`, `closeOverlay`) keep their signatures; the URL sync flows through `useUrlSync`.

## 7. createRouteToPersonnel + cross-surface helpers

- [ ] 7.1 Refactor `apps/web/src/lib/personnel-routing.ts` `createRouteToPersonnel` to compute the URL via `serializePersonnelUrl(employeeId, tab)`, call `history.pushState(null, '', url)`, then call `applyParsed(parseUrl({ pathname: url, search: '' }))`. Single navigation per call.
- [ ] 7.2 Update the deps interface to accept `applyParsedUrl: (parsed: ParsedUrl) => void` instead of separate `setActiveWorkspace` + `updateWorkspaceState`. App.tsx wires a stable `applyParsedUrl` callback that the helper consumes.
- [ ] 7.3 Audit other "edit employee" callsites (Settings → External row, Office shortcut, EmployeeInspector) and confirm they still go through `routeToPersonnel` — no separate `setActiveWorkspace('personnel')` + `updateWorkspaceState` writes.

## 8. Tauri release SPA fallback config

- [ ] 8.1 Open `apps/desktop/src-tauri/tauri.conf.json` (or `.json5` if used) and verify the `app.windows[0]` config + the `frontendDist` path. Add a static-file fallback so non-`/` pathnames serve `index.html` (Tauri 2 uses the `tauri.conf.json` `bundle.windows.fallbackHtml` or equivalent — check current version's exact field).
- [ ] 8.2 If the Tauri 2 version in use does not support a built-in SPA fallback, add a small Rust-side asset resolver in `apps/desktop/src-tauri/src/lib.rs` (under the existing `setup` block) that intercepts asset requests for non-existent paths and returns the bytes of `index.html` from the bundled assets. Wrap behind a `cfg!(not(debug_assertions))` so dev mode (which proxies to `http://localhost:5176`) is untouched.
- [ ] 8.3 Update `apps/desktop/src-tauri/capabilities/default.json` if the asset resolver requires a new capability, otherwise no change.
- [ ] 8.4 `cd apps/desktop/src-tauri && cargo check && cargo clippy -- -D warnings`.

## 9. Build + verify gates (serial per CLAUDE.md)

- [ ] 9.1 `pnpm --filter @offisim/shared-types build` — no shared-types changes expected, but run for safety.
- [ ] 9.2 `pnpm --filter @offisim/ui-core build` — no ui-core changes expected.
- [ ] 9.3 `pnpm --filter @offisim/core build` — no core changes expected.
- [ ] 9.4 `pnpm --filter @offisim/ui-office build` — no ui-office signature changes; verify tree shake.
- [ ] 9.5 `pnpm --filter @offisim/web typecheck`.
- [ ] 9.6 `pnpm --filter @offisim/web build` — verify bundle size delta is in the ≤ +5 KB range (custom router is small; the diff should be minimal). Record the before/after size in the verification notes.
- [ ] 9.7 `pnpm --filter @offisim/desktop build` — release `.app` + `.dmg` bundle for live verify.
- [ ] 9.8 `npx biome check apps/web/src/lib/url-routing apps/web/src/components/workspaces apps/web/src/hooks/useOverlayState.ts apps/web/src/lib/personnel-routing.ts apps/web/src/App.tsx` — zero new errors.

## 10. Live verification (web dev server)

- [ ] 10.1 Start `apps/web` dev server. Open `http://localhost:5176/`. Confirm Office workspace renders. Confirm address bar reads `/`.
- [ ] 10.2 Click each workspace nav button (SOPs, Market, Personnel, Activity, Settings). Confirm URL updates to `/sops`, `/market`, `/personnel`, `/activity`, `/settings/provider` respectively. Hit Cmd+R after each — confirm state persists.
- [ ] 10.3 Click an employee card on Personnel. Confirm URL becomes `/personnel/<id>`. Click each tab (Profile, Appearance, Runtime, Skills, Memory, History). Confirm `?tab=<name>` updates without pushing onto history (browser back skips tab toggles).
- [ ] 10.4 Open Settings, switch tabs (Provider → Runtime → MCP → External). Confirm URL is `/settings/<section>`.
- [ ] 10.5 Open Market, click a listing in explore feed. Confirm URL is `/market/explore/<listingId>`. Switch to Manage tab, click published. Confirm URL is `/market/manage/published`. Apply a filter (kind, sort, search). Confirm URL has filter params.
- [ ] 10.6 Open Activity Log, click an event. Confirm URL is `/activity?event=<id>`. Apply a filter. Confirm URL accumulates filter params.
- [ ] 10.7 Open SOPs, select a SOP. Confirm URL is `/sops/<id>`. Click a step. Confirm URL is `/sops/<id>?step=<stepId>`.
- [ ] 10.8 In Office, toggle viewMode 3D ↔ 2D. Confirm URL `?view=2d` / `?view=3d` (3D state may also serialize for symmetry, or omit if it equals default — confirm against design doc).
- [ ] 10.9 In Office, open Dashboard then Kanban then Marketplace listing. Confirm `?dashboard=1`, `?kanban=1`, `?listing=<id>` flags accumulate.
- [ ] 10.10 Open `/personnel/new` directly via paste. Confirm employee-creator overlay opens over Personnel.
- [ ] 10.11 Open `/?overlay=office-editor` directly via paste. Confirm office-editor overlay opens.
- [ ] 10.12 Open `/studio?company=<existing-company-id>` directly via paste. Confirm Studio overlay opens with that company.
- [ ] 10.13 Browser back from each workspace state — confirm correct previous state restored. Browser forward — confirm forward parity.
- [ ] 10.14 Paste 18 representative URLs (one per row of the URL Grammar Table) into a fresh window each. Confirm round-trip restoration.
- [ ] 10.15 Paste an invalid URL (`/personnel/non_existent_id`). Confirm fall-back to `/personnel` + info toast `Couldn't open the link — employee not found.`
- [ ] 10.16 Paste an invalid workspace key (`/garbage`). Confirm fall-back to `/` (Office), no toast.
- [ ] 10.17 Cross-window test: Cmd+drag a tab into a new window OR open the URL in a fresh window. Confirm state restored without disturbing the source.
- [ ] 10.18 With company-select overlay open (no active company), paste `/personnel/maya?tab=memory`. Select a company. Confirm Personnel + Maya + Memory tab restored after company select closes.
- [ ] 10.19 Open devtools network tab, observe NO duplicate fetch storms during back/forward navigation. Each URL change triggers at most the same request set as the initial load for that workspace.

## 11. Live verification (Tauri release `.app`)

> Coverage status: web verification covers the URL grammar + popstate
> + initial parse path. Tauri release verification adds the SPA
> fallback + `tauri://localhost` origin path. Main session is blocked
> from driving Tauri via computer-use per
> `feedback_no_computer_use_for_verification.md` — task list documents
> what to verify; user runs the Tauri portion.

- [ ] 11.1 Launch Tauri release `.app`. Confirm initial URL is `/` (or whatever Tauri sets).
- [ ] 11.2 Click through workspaces — confirm URL bar (visible via dev menu) tracks pathnames.
- [ ] 11.3 Open Tauri dev menu, navigate via webview URL bar to `tauri://localhost/personnel/<existing-id>?tab=appearance`. Confirm Personnel + employee + tab restored. (Tests SPA fallback.)
- [ ] 11.4 Reload (`Cmd+R` inside webview). Confirm state preserved across reload.
- [ ] 11.5 Quit `.app`, relaunch. Confirm URL resets to `/` (acceptable per design — Tauri does not persist webview URL across launches).
- [ ] 11.6 Trigger a real `offisim://install?listing_id=X&version=Y` deep link from outside the app (custom URL scheme, e.g. `open offisim://install?listing_id=foo&version=1.0` from terminal). Confirm `useDeepLinkInstall` fires AND the install flow opens — confirm URL channel and event channel are independent.

## 12. Spec / docs / memory sync

- [ ] 12.1 Update `apps/web/CLAUDE.md` (if present) or `CLAUDE.md` Workspace IA section: add a paragraph documenting URL grammar + that workspace switches go through URL serializer.
- [ ] 12.2 Update `packages/ui-office/CLAUDE.md` Workspace IA & Navigation section: clarify that `useDeepLinkInstall` is preserved as the install async channel, separate from the URL routing path.
- [ ] 12.3 Update `openspec/protocols-ledger.md` Tauri row to add the `tauri://localhost` SPA fallback line if not present.
- [ ] 12.4 Refresh `MEMORY.md` to record that change H is in flight, and update the Active Backlog when archived.
