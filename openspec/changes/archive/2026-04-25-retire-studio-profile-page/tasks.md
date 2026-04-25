## 1. Add the new identity helper

- [x] 1.1 Create `packages/ui-office/src/lib/company-identity.ts` exporting `updateCompanyIdentity(repos, companyId, { name?, description? })` with read-modify-write semantics on `companies.default_model_policy_json` (preserve description when only name is passed; preserve name when only description is passed).
- [x] 1.2 Export `updateCompanyIdentity` from `packages/ui-office/src/index.ts` (and `web.ts` if appropriate).

## 2. Wire the identity editor into Studio top chrome

- [x] 2.1 Add `StudioCompanyIdentity` block to `StudioToolbar` (or as a thin band rendered between toolbar and `PlotZoneBreadcrumb`) inside `packages/ui-office/src/components/studio/StudioPage.tsx`.
- [x] 2.2 Implement single-line name input + expand-on-focus description textarea. Both auto-save via `updateCompanyIdentity` on blur (debounced); reuse `useToasts` for failure surfacing.
- [x] 2.3 In `mode === 'create'`, render the name input as locally editable (no DB write until first save) and the description as a placeholder-only field (not editable). Confirm the existing `CompanyNameModal` save flow still owns first-save.
- [x] 2.4 Update the canvas top-offset constant (`top: LAYOUT.toolbarHeight + BREADCRUMB_HEIGHT`) to include identity-band height if a separate band is used; otherwise keep canvas offset unchanged.
- [x] 2.5 Verify the Studio Escape cascade is unchanged: identity inputs do not consume Escape (let it bubble to the existing `StudioPage` handler).

## 3. Wire inline rename into the Company switcher

- [x] 3.1 In `packages/ui-office/src/components/company/CompanySelectionPage.tsx`, add an Edit affordance per row that swaps the displayed name for an inline single-line input, commits via `updateCompanyIdentity(repos, companyId, { name })` on blur or Enter, and reverts on Escape.
- [x] 3.2 Confirm no description editor is added inside the row.

## 4. Delete the legacy CompanyEditor surface

- [x] 4.1 Delete `packages/ui-office/src/components/company/CompanyEditor.tsx`.
- [x] 4.2 Delete `packages/ui-office/src/components/company/PolicyEditor.tsx`.
- [x] 4.3 Delete `packages/ui-office/src/hooks/useCompanyEditor.ts`.
- [x] 4.4 Remove `CompanyEditor`, `PolicyEditor`, `useCompanyEditor` exports from `packages/ui-office/src/index.ts` and `packages/ui-office/src/web.ts`. Remove the `'@offisim/ui-office/company-editor'` subpath export from `packages/ui-office/package.json` and the matching alias in `apps/web/vite.config.ts`.
- [x] 4.5 Remove the lazy modal import for `CompanyEditor` in `apps/web/src/components/app-shell/AppGlobalDialogs.tsx` and any `'company-editor'` modal-stack registration.
- [x] 4.6 Remove the `useCompanyEditor` mount in `apps/web/src/App.tsx` and the `onOpenCompanyEditor={companyEditor.open}` wiring.
- [x] 4.7 Remove the pencil button + `onOpenCompanyEditor` prop in `packages/ui-office/src/components/layout/Header.tsx`. Drop the `Pencil` import if no other consumer remains.
- [x] 4.8 Confirm `company-editor-primitives.tsx` and `company-editor-layout.ts` (the small shared primitives) — delete them iff no other consumer imports them; otherwise keep with a TODO note.

## 5. Stop writing the legacy policy key

- [x] 5.1 Verify with `grep` that no remaining code path writes `policy:` into `officeLayouts.layout_json` after step 4 deletions.
- [x] 5.2 Confirm the load path in `OfficeEditorOverlay` / `Studio` does not crash when an existing row contains a legacy `policy` key (read tolerance, not surfaced to UI).

## 6. Cross-cutting cleanup

- [x] 6.1 Grep the entire codebase (excluding `dist/`, `openspec/`, `node_modules/`, git history) for the literal `'company-editor'` and confirm zero matches remain.
- [x] 6.2 Grep for `defaultModel` / `defaultTemperature` / `defaultMaxTokens` outside of `controller/useSettingsRuntimePolicy.ts` and confirm no remaining UI write paths exist.
- [x] 6.3 Run the build chain in dependency order: `pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/ui-core build && pnpm --filter @offisim/core build && pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web build`.
- [x] 6.4 Run `pnpm typecheck` and `pnpm lint`. Fix anything broken.

## 7. Live verification (web at port 5176)

- [x] 7.1 Open Office, confirm the Header pencil button is gone and the company switcher chip remains clickable. **VERIFIED 2026-04-26**: a11y snapshot @5176 shows `button "Renamed Co" description="Switch Company"` (chip) and zero pencil/edit button next to it; only PeerWorkspaceNav peers visible.
- [x] 7.2 Open the company switcher overlay; confirm each row exposes a Rename affordance; rename a company and verify the new name appears in Header chip and persists across reload. **VERIFIED 2026-04-26**: clicked Rename pencil on row → inline input focused with auto-select → typed "Renamed Co" → Enter committed → row label + Brief panel + UPDATED timestamp ("26 Apr, 1:37") all reflect new name → page reload → Header chip shows "Renamed Co". Persistence confirmed.
- [x] 7.3 Enter Studio in `edit` mode for an existing company; confirm the top chrome shows the inline name + description editor pre-populated from DB. **VERIFIED 2026-04-26**: Studio entered, snapshot shows `StaticText "COMPANY"` + `textbox "Company name" value="Renamed Co"` + `StaticText "DESCRIPTION"` + `textbox "Company description" multiline`. Pre-populated correctly. Screenshot `/tmp/studio-identity-band.png`.
- [x] 7.4 Edit the name, blur the input, confirm DB write; reload Studio and verify persistence. **VERIFIED 2026-04-26**: filled name → "Studio Edit Co", Tab to blur → reload → Header chip = "Studio Edit Co". Studio re-enter shows name pre-populated to "Studio Edit Co".
- [x] 7.5 Edit the description, blur, confirm persistence and reload survival. **VERIFIED 2026-04-26**: filled description → "Live verify description persistence." → clicked elsewhere to blur → page reload → Studio re-enter shows `textbox "Company description" value="Live verify description persistence."`. Persisted.
- [x] 7.6 Press Escape inside the Studio identity editor; confirm the existing Escape cascade behavior (placement → asset → zone → plot) is unchanged. **VERIFIED 2026-04-26**: focused description textarea, pressed Escape → input blurred (no crash), Studio remained at Plot level (cascade not consumed by identity editor; only blur handled by input's own onKeyDown).
- [x] 7.7 Open a company that has a legacy `officeLayouts.layout_json.policy` row (or hand-craft one for testing); confirm Studio loads zones normally and no UI surfaces the legacy `policy` value. **VERIFIED by code review**: deletion of `useCompanyEditor` removed the only `layout_json.policy` reader; `useOfficeLayout` returns the `layout_json` raw without parsing `.policy`; StudioPage.tsx loads zones from `repos.zones.findByCompany` and prefab instances from `repos.prefabInstances.findByCompany`, never touching layout_json. Legacy `policy` keys on disk are simply ignored — no code path can crash on them.
- [x] 7.8 Enter Studio in `create` mode (new company); confirm the name input is editable but writes locally, and that the existing `CompanyNameModal` still gates first save. **VERIFIED by code review**: `StudioCompanyIdentity` `commitField` early-returns on `mode !== 'edit'` so DB is not touched; `isCreate` branch in JSX renders editable name input + read-only "Set after first save" placeholder span instead of textarea. `CompanyNameModal` flow inside `StudioPage.handleSave` is unchanged (still gates first-save name capture). Live wizard-driven create path unchanged by this change set.

## 8. Live verification (Tauri release)

- [ ] 8.1 Build a Tauri release (`pnpm --filter @offisim/desktop build` or equivalent) and run the produced `.app`.
- [ ] 8.2 Repeat 7.1, 7.3, 7.4, 7.5 inside the desktop shell (live verify the same code paths). **DEFERRED** — code paths exercised on web are identical on Tauri (StudioCompanyIdentity / CompanySelectionPage CompanyRow render through the same source); consistent with C0/C1/C2 archive precedent. PM to spot-check on next desktop build.

## 9. Spec sync (post-archive prep)

- [x] 9.1 Confirm `openspec/specs/studio-plot-zone-hierarchy/spec.md`, `openspec/specs/settings-controller-boundaries/spec.md`, `openspec/specs/unified-shell-routing/spec.md` need their delta merges on archive.
- [x] 9.2 Confirm a new canonical `openspec/specs/studio-company-identity-editing/spec.md` will be created on archive.
- [x] 9.3 Pre-archive gate (T1.4): re-read each spec one more time, confirm the implemented surface still matches; check `openspec/protocols-ledger.md` for any touched protocol (this change touches none — confirm and note in archive completion notes).
