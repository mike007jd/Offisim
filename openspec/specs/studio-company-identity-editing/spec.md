# studio-company-identity-editing Specification

## Purpose
Define the single canonical surface for editing a company's identity (name + description). Studio top chrome owns inline editing; the company switcher row owns inline rename of `companies.name` only. No other surface — global Header button, workspace tab, or separate modal — may provide a parallel editor for these fields. Persistence routes through the `updateCompanyIdentity` helper which encapsulates the misleading-but-stable `companies.default_model_policy_json = JSON.stringify({ description })` round-trip.

## Requirements
### Requirement: Studio top chrome SHALL own inline editing of company name and description

The Studio editing surface (`StudioPage`) SHALL expose inline edit affordances for `companies.name` and the company description (stored in `companies.default_model_policy_json` as `JSON.stringify({ description })`) within its top chrome (the toolbar band or a thin band between toolbar and `PlotZoneBreadcrumb`). No other surface in the application — including a global Header button, a workspace tab, or a separate modal — SHALL provide a parallel UI for editing these two fields.

The name input SHALL render as single-line text. The description input SHALL render as a textarea that may be visually compact when unfocused and expand on focus. Both inputs SHALL persist with debounced auto-save on blur (or commit alongside the existing Studio Save button when zone state is also dirty), writing through:

- `companies.update(companyId, { name, default_model_policy_json: JSON.stringify({ description }) })`

The shape `{ description }` inside `default_model_policy_json` SHALL be the only key written by the identity editor; existing other keys MAY be tolerated on read but SHALL NOT be written.

#### Scenario: Studio toolbar shows the company name field in edit mode
- **WHEN** Studio mounts in `mode === 'edit'` with a real `companyId` and the company row loads with `name === 'Acme Co'`
- **THEN** the Studio top chrome renders an inline name input with current value `'Acme Co'`

#### Scenario: Studio toolbar shows the company description field in edit mode
- **WHEN** Studio mounts in `mode === 'edit'` and `companies.default_model_policy_json` parses to `{ description: 'A test lab' }`
- **THEN** the Studio top chrome renders a description textarea with current value `'A test lab'`

#### Scenario: Editing name auto-saves on blur
- **WHEN** the user changes the name input from `'Acme Co'` to `'Acme Inc'` and the input blurs
- **THEN** the change is persisted via `companies.update(companyId, { name: 'Acme Inc', default_model_policy_json: JSON.stringify({ description: <current> }) })`

#### Scenario: Editing description auto-saves on blur
- **WHEN** the user changes the description textarea and it blurs
- **THEN** the change is persisted via `companies.update(companyId, { name: <current>, default_model_policy_json: JSON.stringify({ description: <new> }) })`

#### Scenario: No global Header button opens a separate company editor
- **WHEN** grepping `packages/ui-office/src/components/layout/Header.tsx` for `onOpenCompanyEditor` or for a `Pencil` import used as a "company settings" trigger
- **THEN** zero matches exist

#### Scenario: No global modal registration named 'company-editor'
- **WHEN** grepping the codebase (excluding git history and openspec artifacts) for the literal string `'company-editor'`
- **THEN** zero matches exist

#### Scenario: Create mode permits editing name only locally until first save
- **WHEN** Studio mounts in `mode === 'create'` (no `companyId`)
- **THEN** the name input is editable but writes only to local state; description is rendered as a placeholder ("Set on save" or equivalent) and is not editable until the company is created via the existing `CompanyNameModal` save flow

### Requirement: Company switcher row SHALL expose inline rename for company name only

The Company switcher (`CompanySelectionPage`) SHALL allow each company row to inline-rename `companies.name` via an Edit affordance on the row. The switcher row SHALL NOT expose an inline editor for description.

#### Scenario: Switcher row exposes a Rename affordance
- **WHEN** `CompanySelectionPage` renders a company row
- **THEN** the row exposes an Edit/Rename affordance that, when activated, replaces the displayed name with an inline single-line input

#### Scenario: Switcher rename writes through to companies.name
- **WHEN** the user submits a new name via the inline rename input
- **THEN** the change is persisted via `companies.update(companyId, { name: <new> })` (the description column is NOT touched in this code path)

#### Scenario: Switcher row does not render a description editor
- **WHEN** `CompanySelectionPage` renders a company row in any state (collapsed or expanded)
- **THEN** there is no textarea, multi-line input, or "Edit description" button rendered inside the row

### Requirement: Company identity persistence SHALL go through a single helper

A single helper (`updateCompanyIdentity` exported from `packages/ui-office/src/lib/company-identity.ts` or equivalent location) SHALL encapsulate the awkward `companies.default_model_policy_json` round-trip for description. The Studio toolbar identity editor and the company switcher inline rename SHALL both call this helper rather than invoke `repos.companies.update` with a hand-rolled `JSON.stringify({ description })` payload.

The helper signature SHALL be:

```ts
updateCompanyIdentity(
  repos: RuntimeRepositories,
  companyId: string,
  fields: { name?: string; description?: string },
): Promise<void>
```

When `description` is omitted from `fields`, the helper SHALL preserve the existing description (read-modify-write); when `description` is provided, it SHALL overwrite. When `name` is omitted, `companies.name` SHALL be untouched.

#### Scenario: Helper exists and is exported
- **WHEN** importing `updateCompanyIdentity` from the `@offisim/ui-office` package
- **THEN** the import resolves to a function

#### Scenario: Description-only update preserves name
- **WHEN** `updateCompanyIdentity(repos, 'co-1', { description: 'New desc' })` is called and the existing row has `name === 'Acme'`
- **THEN** `companies.update('co-1', { name: 'Acme', default_model_policy_json: JSON.stringify({ description: 'New desc' }) })` is invoked

#### Scenario: Name-only update preserves description
- **WHEN** `updateCompanyIdentity(repos, 'co-1', { name: 'Acme Inc' })` is called and the existing row has `default_model_policy_json` parsing to `{ description: 'Old desc' }`
- **THEN** `companies.update('co-1', { name: 'Acme Inc', default_model_policy_json: JSON.stringify({ description: 'Old desc' }) })` is invoked

#### Scenario: Write payload contains exactly the description key
- **WHEN** any call to `updateCompanyIdentity` persists
- **THEN** the JSON written to `default_model_policy_json` parses to an object whose keys are exactly `{ 'description' }` — no `policy`, `defaultModel`, `defaultTemperature`, or `defaultMaxTokens` keys

### Requirement: The CompanyEditor modal SHALL be removed from the codebase

The files `packages/ui-office/src/components/company/CompanyEditor.tsx`, `packages/ui-office/src/components/company/PolicyEditor.tsx`, and `packages/ui-office/src/hooks/useCompanyEditor.ts` SHALL NOT exist in the source tree after this change. The package barrel SHALL NOT export these symbols. The `'company-editor'` modal stack id SHALL NOT be registered.

#### Scenario: Source files do not exist
- **WHEN** running `ls packages/ui-office/src/components/company/CompanyEditor.tsx packages/ui-office/src/components/company/PolicyEditor.tsx packages/ui-office/src/hooks/useCompanyEditor.ts`
- **THEN** the command exits with a non-zero status (no such files)

#### Scenario: Package barrel does not export the deleted symbols
- **WHEN** grepping `packages/ui-office/src/index.ts` and `packages/ui-office/src/web.ts` for `CompanyEditor`, `PolicyEditor`, or `useCompanyEditor`
- **THEN** zero matches exist

#### Scenario: AppGlobalDialogs no longer mounts the modal
- **WHEN** grepping `apps/desktop/renderer/src/components/app-shell/AppGlobalDialogs.tsx` for `'@offisim/ui-office/company-editor'` or `m.CompanyEditor`
- **THEN** zero matches exist

### Requirement: Legacy policy fields SHALL no longer be written to officeLayouts.layout_json

After this change, no code path SHALL write a `policy` key (containing `defaultModel`, `defaultTemperature`, or `defaultMaxTokens`) into `officeLayouts.layout_json`. Readers MAY tolerate a legacy `policy` key on disk (silently ignore it) but SHALL NOT surface it to any UI.

The canonical location for company-level model and runtime defaults remains `runtimePolicy` (Settings → Runtime), owned by `settings-controller-boundaries`.

#### Scenario: No code writes policy into layout_json
- **WHEN** grepping `packages/ui-office/src/**/*.{ts,tsx}` for `JSON.stringify({ ...existing, policy }` or for `defaultModel:` / `defaultTemperature:` / `defaultMaxTokens:` write paths into `officeLayouts`
- **THEN** zero matches exist (excluding `openspec/`, `dist/`, and git history)

#### Scenario: Legacy rows do not crash readers
- **WHEN** an `officeLayouts.layout_json` row contains both `zones` and a legacy `policy: { defaultModel: 'gpt-4' }` key
- **THEN** the OfficeEditorOverlay / Studio load path parses zone data normally and does not throw on the legacy `policy` key

#### Scenario: ModelResolver remains the single consumer of model defaults
- **WHEN** grepping `packages/core/src/**/*.ts` for `defaultModel`, `defaultTemperature`, or `defaultMaxTokens` as **read** sites (i.e., property access not just type declaration)
- **THEN** zero matches exist outside of `ModelResolver` and its `runtimePolicy.modelPolicy` consumption path

