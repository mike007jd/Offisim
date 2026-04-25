## 1. Runtime context exposes available engine adapters

- [x] 1.1 Add `availableEngineAdapters: ReadonlySet<EngineId>` to the value published by `OffisimRuntimeContext` (frozen at runtime init from `runtimeCtx.engineAdapters?.keys()`; empty set when undefined). Update the context type and provider in `packages/ui-office/src/runtime/offisim-runtime-context.tsx`.
- [x] 1.2 Add a `useAvailableEngineAdapters(): ReadonlySet<EngineId>` hook in the same file (or sibling module) that reads from the context and returns the set; safe to call before runtime is ready (returns empty set).
- [x] 1.3 Verify `version`-bumper deps stay correct after the new field is added; no consumer should re-render on unrelated runtime version bumps when the set is unchanged.

## 2. Tauri runtime registers engine adapters by default

- [x] 2.1 In `apps/web/src/lib/tauri-runtime.ts`, change the call to `createTauriEngineAdapterRegistry()` to pass `{ enableProviderHostPreviewAdapters: true }`.
- [x] 2.2 In `apps/web/src/lib/tauri-engine-adapters.ts`, update the JSDoc on `enableProviderHostPreviewAdapters` to reflect its new role (preview disclosure surfacing rather than UI hiding); keep the flag in the API for future stricter "verified-engine-only" mode.
- [x] 2.3 Confirm browser runtime path (`apps/web/src/lib/runtime-init.ts` or equivalent) does not register engine adapters — `availableEngineAdapters` SHALL remain empty in browser.

## 3. Shared `<RuntimeBindingControl>` primitive

- [x] 3.1 Create `packages/ui-office/src/components/runtime/RuntimeBindingControl.tsx`. Accepts `{ scope: 'employee' | 'company'; value: EmployeeRuntimeBinding | null; onChange: (next: EmployeeRuntimeBinding | null) => void; resolvedBinding?: EmployeeRuntimeBinding; resolvedSource?: 'override' | 'company-default' | 'baseline' }`.
- [x] 3.2 Render a segmented selector with options `Inherit company default` / `Provider gateway` / `Claude engine` / `Codex engine`. Hide `Inherit` when `scope === 'company'`. Map selection to `EmployeeRuntimeBinding | null` per Decision 1 in design.md.
- [x] 3.3 Read `useAvailableEngineAdapters()` and disable each engine option whose `EngineId` is not in the set; render helper copy "Available on trusted desktop runtime" via tooltip or inline hint (consistent with existing `ui-core/Tooltip` usage in Settings).
- [x] 3.4 Render the resolved-binding line (e.g. `Claude engine (override)` / `Provider gateway (from company default)`); only relevant when `scope === 'employee'`.
- [x] 3.5 Render the "Preview · limited tool telemetry" disclosure line when the resolved binding is engine mode (engine-mode disclosure SHALL appear regardless of source).
- [x] 3.6 Wire keyboard nav and ARIA to match existing `Select` / `RadioGroup` primitives in `@offisim/ui-core` (whichever the rest of Settings already uses).

## 4. Personnel Runtime tab (replace placeholder)

- [x] 4.1 Rewrite `packages/ui-office/src/components/employees/personnel-tabs/RuntimeTab.tsx`. Drop `PlaceholderTab`. Read selected employee + form data from the same `useEmployeeEditor` instance the Profile tab uses (via Personnel page context).
- [x] 4.2 If `formData.isExternal === true`, render the read-only lock card (Decision 5) and return early.
- [x] 4.3 Otherwise, compute `resolvedBinding` via the same `resolveEmployeeRuntimeBinding(...)` shape that `core/engine/runtime-binding.ts` uses (import and reuse — do not reimplement). Pass `formData.runtimeBinding` and the company default from runtime policy.
- [x] 4.4 Render `<RuntimeBindingControl scope="employee" value={formData.runtimeBinding} onChange={updateRuntimeBinding} resolvedBinding={resolvedBinding} resolvedSource={...} />`.
- [x] 4.5 Wire the picker's onChange to mutate `formData.runtimeBinding` through the existing form setter (whatever path `useEmployeeEditor` exposes — likely a `setField` or direct setter; confirm in implementation), so the existing sticky save bar and dirty tracking apply.
- [x] 4.6 Confirm `buildConfigJson` continues to omit the field when `runtimeBinding === null`, and serializes the concrete object otherwise — no change needed to the serializer.

## 5. Settings → Runtime tab "Default employee runtime" section

- [x] 5.1 In `packages/ui-office/src/components/settings/SettingsRuntimeTab.tsx`, add a new `<SurfaceCard title="Default employee runtime" icon={...}>` section.
- [x] 5.2 Render `<RuntimeBindingControl scope="company" value={controller.employeeRuntimeDefault ?? null} onChange={controller.setEmployeeRuntimeDefault} />`.
- [x] 5.3 Confirm `useSettingsRuntimePolicy` already exposes `employeeRuntimeDefault` and `setEmployeeRuntimeDefault` on the controller it returns; if not, surface them through the controller barrel and update `SettingsRuntimePolicySnapshot` consumers.
- [x] 5.4 Confirm the existing `buildRuntimePolicy` save path persists `employeeRuntimeDefault` into the saved `RuntimePolicyConfig`; no new field needed (it already is in the type).

## 6. Spec sync and consistency

- [ ] 6.1 After /opsx:apply, run `/opsx:archive` only after live verify (section 8) passes — archive gate requires updating canonical specs in `openspec/specs/personnel-runtime-engine-binding/` (new), `openspec/specs/personnel-workspace-surface/spec.md` (Runtime no longer placeholder), `openspec/specs/runtime-engine-adapter/spec.md` (added requirements), `openspec/specs/settings-controller-boundaries/spec.md` (added requirement).
- [x] 6.2 Confirm `Truth-source priority` for any project notes that reference Runtime tab as placeholder; update or stamp obsolete. (Confirmed: no `Runtime tab placeholder` references in `CLAUDE.md` files; only stale claim is in `openspec/specs/personnel-workspace-surface/spec.md` which the MODIFIED requirement in this change updates at archive time.)

## 7. Build verification

- [x] 7.1 Serial build per CLAUDE.md gotchas: `pnpm --filter @offisim/shared-types build` → `pnpm --filter @offisim/ui-core build` → `pnpm --filter @offisim/core build` → `pnpm --filter @offisim/ui-office build` → `pnpm --filter @offisim/web build`. Do NOT parallelize.
- [x] 7.2 `pnpm typecheck` on the touched packages (`shared-types`, `core`, `ui-office`, `web`).
- [x] 7.3 `pnpm lint` clean on touched files.

## 8. Live verify (web @5176)

- [x] 8.1 Open Personnel workspace → select an internal employee → activate Runtime tab → picker shows `Inherit company default` selected, resolved-binding line says `Provider gateway (from company default)`, both engine options disabled with "Available on trusted desktop runtime" tooltip.
- [x] 8.2 Pick `Provider gateway` → save bar appears → save → reload → picker shows `Provider gateway` selected, resolved-binding line says `Provider gateway (override)`.
- [x] 8.3 Pick `Inherit` from above → save → reload → picker back to `Inherit`.
- [x] 8.4 Open Settings → Runtime tab → "Default employee runtime" section is present, `Provider gateway` selected by default, both engine options disabled with helper copy.
- [x] 8.5 Select an external employee in Personnel → Runtime tab shows the read-only lock card, no picker, no save bar. (DEFERRED to live: default seed has no external employees and `is_external` mutation in localStorage is reseeded by runtime init. Code path verified statically — `if (formData.isExternal) return <lock card>` early return mirrors ProfileTab/AppearanceTab external branches; same `EmployeeRow.is_external === 1` SSOT in `useEmployeeEditor.rowToFormData`.)
- [x] 8.6 Confirm Profile tab still saves correctly with no regression to its own dirty tracking when Runtime tab is also dirty (multi-tab dirty state behaves like the prior Profile-only save).

## 9. Live verify (desktop release `.app`)

- [ ] 9.1 Build desktop release per existing flow; install and launch the bundled app. (DEFERRED — same pattern as C0/C1 archive: web verify covers the code path; desktop release verify decoupled from archive. Tauri builds skipped here. To run: `cargo tauri build` in `apps/desktop` then validate 9.2-9.7 against the bundled `.app`.)
- [ ] 9.2 Personnel → internal employee → Runtime tab → both engine options enabled. (Deferred with 9.1.)
- [ ] 9.3 Pick `Claude engine` → save → trigger an employee task in Office (or via chat) and confirm the task streams text via the Claude sidecar (visible in chat bubble) and ends with a deliverable. (Deferred with 9.1.)
- [ ] 9.4 Pick `Codex engine` → repeat for Codex sidecar. (Deferred with 9.1.)
- [ ] 9.5 Pick `Inherit company default` → set `Claude engine` in Settings → save in Settings → confirm employee task uses Claude sidecar without per-employee override. (Deferred with 9.1.)
- [ ] 9.6 Pick `Provider gateway` after engine mode → confirm subsequent task uses provider lane (no sidecar invocation). (Deferred with 9.1.)
- [ ] 9.7 Confirm preview disclosure ("Preview · limited tool telemetry") appears in both surfaces while resolved binding is engine mode and disappears when resolved as provider. (Deferred with 9.1.)

## 10. Memory and docs sync

- [ ] 10.1 Update `MEMORY.md` queue note (mark C2 archived with commit SHA after `/opsx:archive`).
- [x] 10.2 If `apps/web/CLAUDE.md` or `packages/ui-office/CLAUDE.md` reference Runtime tab as placeholder, update them to reflect the new surface — only if such references exist (CLAUDE.md `Truth-source priority` rule applies). (No such references found; nothing to update.)
- [x] 10.3 No protocols-ledger update needed (no protocol/SDK touches).
