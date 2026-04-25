## Context

Today there are three concurrent surfaces that touch a company's identity / defaults:

1. **Header pencil button** → opens `CompanyEditor` modal (3 tabs: Overview / Zone Layout / Employee Defaults). Triggered from `apps/web/src/App.tsx:269` `companyEditor.open`. State owned by `useCompanyEditor` (`packages/ui-office/src/hooks/useCompanyEditor.ts`). Mounted lazily via `AppGlobalDialogs.tsx:13` (`'company-editor'` modal entry).
2. **Studio top toolbar** (`StudioPage` → `StudioToolbar`) — currently has tools / grid / save / back, no identity editor. There is already a `CompanyNameModal` for the create-mode save flow.
3. **Header company switcher** (`Building2` button → `CompanySelectionPage` overlay) — list rows are read-only.

`useCompanyEditor` writes:
- `companies.name` (real)
- `companies.default_model_policy_json` ← `JSON.stringify({ description })`. Despite the column name, this only stores description today (`packages/core/CLAUDE.md:25` documents this misleading column is intentionally not renamed)
- `officeLayouts.layout_json.policy` ← `{ defaultModel, defaultTemperature, defaultMaxTokens }`. **No reader anywhere in `core`** — `ModelResolver` (the only consumer of model-policy at runtime) is constructed from `runtimePolicy.modelPolicy` (`apps/web/src/lib/browser-runtime.ts:272` and `tauri-runtime.ts:249`). C2 `personnel-runtime-engine-binding` made `runtimePolicy.employeeRuntimeDefault` the canonical company-level binding.

Studio is now the canonical "edit this company's space" surface (D1 `studio-plot-zone-hierarchy` + D2 `studio-asset-edit-contract` archived 2026-04-26). Folding identity editing into Studio's top chrome collapses the IA.

## Goals / Non-Goals

**Goals:**
- Retire the `CompanyEditor` modal as a surface (delete the file, the hook, the modal registration, and the Header pencil entry point).
- Move name + description editing into Studio top chrome with inline-edit semantics (single-line for name, expand-on-focus textarea for description). Save uses the same `companies.update({ name, default_model_policy_json: JSON.stringify({ description }) })` shape — schema unchanged.
- Add inline rename for `companies.name` to each row in the Company switcher list.
- Remove `PolicyEditor` and the `policy` write path entirely. Tolerate legacy `policy` keys on read (do not crash) but never write them again.

**Non-Goals:**
- **No SQLite migration**. Column `companies.default_model_policy_json` keeps its misleading name (per the CLAUDE.md gotcha "字段名误导但不可重命名"). Future schema cleanup is a separate change.
- **No relocation of model defaults UI**. The legacy `defaultModel` / `defaultTemperature` / `defaultMaxTokens` fields are deleted with no replacement panel — Settings → Runtime → "Default employee runtime" (C2) already owns company-level model defaults via `runtimePolicy`.
- **No description editor in the company switcher row**. Multi-line edit in a popover is the wrong shape; description-only edits route through Studio.
- **No new "Company" tab in Settings**. Settings stays provider/runtime/mcp/external.
- **No Header pencil replacement icon**. The entry point is the Studio toolbar — that's the answer to "where do I edit this company".

## Decisions

### D1. Studio toolbar owns inline editing of name + description
**Choice:** Add a `StudioCompanyIdentity` block to `StudioToolbar` (or a thin band between toolbar and `PlotZoneBreadcrumb`). Name renders as a single-line text input that looks like display text until clicked; description renders as a textarea that expands on focus.

**Why:** Studio is the canonical "edit this company" surface post-D1/D2. Identity is a peer to layout — both belong to the same workspace. Putting name + description here avoids inventing a fourth modal or polluting the global Header.

**Alternatives considered:**
- *Settings new "Company" tab* — rejected: settings IA is for provider/runtime/mcp/external (per `settings-controller-boundaries`); adding a Company tab fragments where users go to edit a company.
- *Inline in Header next to the company switcher* — rejected: Header is workspace-agnostic chrome and already crowded; a textarea cannot live there.
- *Bring back a modal but smaller* — rejected: the whole point of D3 is fewer modal surfaces.

**Save semantics:** debounced auto-save on blur (and on hard commit via Save button if Studio still has dirty zones). The Studio toolbar's existing Save button handles dirty-zone persistence; identity edits piggyback on the same `handleSave` path or run their own thin commit if zones are clean.

### D2. Company switcher row exposes inline rename only
**Choice:** Each company row in `CompanySelectionPage` gets a small Edit affordance for `companies.name`. Description editing is **not** offered here.

**Why:** Users renaming a company without entering it is reasonable; describing a company without entering it is not the common path.

**Alternatives considered:**
- *Description editor expanded inside the row* — rejected: shape mismatch (multi-line in a list row is awkward).
- *No edit in switcher at all* — rejected: forces users to enter Studio just to fix a typo, regression vs current.

### D3. Delete `PolicyEditor` and the `policy` write path with no replacement
**Choice:** `PolicyEditor.tsx` deleted. `useCompanyEditor.save` is gone with the hook. No code path writes `officeLayouts.layout_json.policy` after this change. Readers (none in `core`; only the now-deleted hook) are also removed. Legacy `policy` keys persisted on disk are simply ignored (no migration).

**Why:** The fields were orphan writes — `ModelResolver` reads from `runtimePolicy.modelPolicy`. C2 already provides `runtimePolicy.employeeRuntimeDefault` as the canonical company-level "what runtime do new employees default to" surface. Two parallel "company default" stories is the antipattern that motivated D3 in the first place.

**Alternatives considered:**
- *Migrate the `policy` key into `runtimePolicy.modelPolicy`* — rejected: `runtimePolicy.modelPolicy` is already populated from Provider config defaults; copying stale `defaultModel` strings (often blank) on top of working values would corrupt working configs.
- *Hide the UI but keep the write path* — rejected: orphan writes are tech debt, not a feature.

### D4. Single repo write helper for name + description
**Choice:** Extract a `updateCompanyIdentity(repos, companyId, { name, description })` helper that performs the awkward `JSON.stringify({ description })` round-trip into `default_model_policy_json` exactly once. Studio toolbar editor and switcher rename both call this helper.

**Why:** The misleading column name is a documented gotcha. Centralizing the awkward shape behind one helper means future readers see one violation, not two.

**Where to put it:** `packages/ui-office/src/lib/company-identity.ts` (new), exported from the package barrel.

### D5. No new modal stack id; no new overlay key
**Choice:** Studio inline editor lives inside the existing Studio overlay. No `useRegisterModal` registration needed for the inline editor (Studio already owns the modal stack as `'studio-page'` overlay). Switcher inline rename uses an inline edit affordance, not a popover modal.

**Why:** Fewer modal stack layers reduces escape-cascade complexity. Esc inside Studio still cascades per the D1 contract; identity edit blur-commits and does not consume Esc.

## Risks / Trade-offs

- **[Risk]** Users who manually entered Employee Defaults expecting them to influence runtime will be confused they're gone. → **Mitigation**: this matches existing reality (orphan writes today). Settings → Runtime is the documented canonical surface; no support burden change. Acceptable.
- **[Risk]** Description editing only inside Studio is friction for users who only want to edit description without entering Studio. → **Mitigation**: low-frequency operation; Studio entry is one click from the company switcher.
- **[Risk]** Removing the `'company-editor'` modal registration could leave a stale `useRegisterModal` reference somewhere. → **Mitigation**: tasks include grep for `'company-editor'` literal across the codebase.
- **[Risk]** Studio toolbar in **create mode** (new company, no `companyId`) cannot save identity — name is captured by `CompanyNameModal` on first save. → **Mitigation**: in create mode, the inline editor renders read-only placeholder text ("Set on save") for description; name field is editable but writes to local state only until first save.
- **[Trade-off]** `companies.default_model_policy_json` keeps its misleading name. Acceptable per CLAUDE.md gotcha; cleanup is out of scope.

## Migration Plan

No schema migration. Code-only change. Live verify on web (5176) + Tauri release.

**Rollback strategy:** revert the change set; `companies` and `officeLayouts` rows written under the new code remain valid under the old code (same shape; identity is in same column, `policy` key is just absent from new writes).

## Open Questions

None — Q1 (name + description location) and Q2 (delete legacy policy fields) confirmed by PM 2026-04-26.
