## Why

The "Studio Profile" modal (the `CompanyEditor` overlay opened from Header pencil icon) is a leftover surface from the pre-Studio era. Two of its three tabs are dead weight today:

- **Employee Defaults** (`defaultModel` / `defaultTemperature` / `defaultMaxTokens`) writes to `officeLayouts.layout_json.policy`, but the runtime `ModelResolver` reads from `runtimePolicy.modelPolicy` (Settings → Runtime, owned by C2 `personnel-runtime-engine-binding`). Those fields are **orphan writes** — no consumer.
- **Zone Layout** is a read-only summary of zones that are actually edited inside Studio / OfficeEditorOverlay. It tells the user nothing they can't see in Studio itself.
- Only **Overview** (company name + description) carries real value, but a separate full-screen modal for two text fields is overkill and creates a third "where do I edit a company" surface (Studio toolbar / company switcher / pencil modal).

Studio is now the canonical surface for "edit this company's space" (D1 + D2 archived). Folding name + description into Studio's top toolbar collapses the IA and removes a confusing parallel entry.

## What Changes

- **BREAKING**: Remove the `CompanyEditor` modal (Header pencil button, `useCompanyEditor` hook, `'company-editor'` registered modal entry, and the global mount in `AppGlobalDialogs`).
- **BREAKING**: Remove the `PolicyEditor` component and stop writing `defaultModel` / `defaultTemperature` / `defaultMaxTokens` into `officeLayouts.layout_json.policy`. Continue reading the existing `policy` key on load (so old rows do not orphan zone data) but never write the key going forward.
- **NEW**: Studio top toolbar exposes an inline-editable Company Name (single-line) and Description (textarea, expand-on-focus). Save is debounced and writes through to `companies.name` and `companies.default_model_policy_json` (continuing the existing misleading-but-stable `JSON.stringify({ description })` shape — `packages/core/CLAUDE.md:25` documents this column is intentionally not renamed).
- **NEW**: Company switcher list rows expose inline Rename for `companies.name` (no description editor — multi-line in the popover is wrong shape).
- **DELETE**: `CompanyEditor.tsx`, `useCompanyEditor.ts`, `PolicyEditor.tsx`, the Header pencil button + its handler wiring, the `'company-editor'` modal registration, and any view-state / overlay key plumbing that exists solely for this modal.
- Schema column `companies.default_model_policy_json` stays as-is (per `packages/core/CLAUDE.md:25`). The `officeLayouts.layout_json.policy` key is deprecated in writes; readers still tolerate it on load for legacy rows.

## Capabilities

### New Capabilities
- `studio-company-identity-editing`: Studio toolbar owns inline editing of company name + description; company switcher row owns inline rename. Defines what fields are editable, save semantics, and which surfaces are forbidden from re-introducing a separate Profile modal.

### Modified Capabilities
- `studio-plot-zone-hierarchy`: Studio top chrome adds the company-identity inline editor next to the plot/breadcrumb area; document that name + description live here.
- `settings-controller-boundaries`: Reaffirm that company-level model defaults (model / temperature / maxTokens) are owned by Settings → Runtime via `runtimePolicy.modelPolicy`; no parallel surface is allowed to write equivalent fields elsewhere.
- `unified-shell-routing`: Header no longer exposes a "open company editor" entry point; editing the active company's identity routes through Studio.

## Impact

**Code (delete)**:
- `packages/ui-office/src/components/company/CompanyEditor.tsx`
- `packages/ui-office/src/components/company/PolicyEditor.tsx`
- `packages/ui-office/src/hooks/useCompanyEditor.ts`
- Header pencil button + `onOpenCompanyEditor` prop in `packages/ui-office/src/components/layout/Header.tsx`
- `'company-editor'` modal registration in `apps/web/src/components/app-shell/AppGlobalDialogs.tsx` and any `useEmployeeEditor`-style hook mount in `App.tsx`
- The `policy` write branch inside `useCompanyEditor.ts` (deleted with the hook) — readers retained for legacy rows only

**Code (add)**:
- New Studio toolbar identity editor primitive (`StudioCompanyIdentityEditor` or inline in `StudioPage` top chrome) — single SSOT for name + description editing
- Inline rename affordance in company switcher row (`CompanySwitcher` or equivalent)
- Repo write helper that performs the `companies.update({ name, default_model_policy_json: JSON.stringify({ description }) })` round-trip in one place (so the misleading column name lives in exactly one location)

**Data**:
- No SQLite migration. `companies.default_model_policy_json` shape unchanged. `officeLayouts.layout_json.policy` key not written but tolerated on read.

**Tests**: live verify only (per CLAUDE.md repo policy). Coverage points captured in tasks.md.

**Risk**:
- Any user who has hand-edited `defaultModel/Temp/MaxTokens` expecting it to influence runtime is wrong today — this change does not regress them, it surfaces the existing reality. C2's Settings → Runtime → "Default employee runtime" is the correct place.
- Description editing now lives only in Studio toolbar + (name only) switcher row. If a user wants to edit description without entering Studio, they must enter Studio. Acceptable for v1; description is low-frequency edit.
