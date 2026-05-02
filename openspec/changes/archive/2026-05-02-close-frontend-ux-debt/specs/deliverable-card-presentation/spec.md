## MODIFIED Requirements

### Requirement: Contributor avatar stack replaces text badge list

`DeliverableCard` header SHALL render up to 3 contributor avatars (size 20) stacked horizontally with hover tooltip showing each employee's name. Each avatar SHALL be rendered through the shared `EmployeeAvatar` primitive (`packages/ui-office/src/components/shared/EmployeeAvatar.tsx`), which dispatches as follows:

- `isExternal === true` → `BrandAvatar2D` is **always** the renderer; if `brandKey` is `null` or unknown, `BrandAvatar2D`'s registry lookup falls back to a generic external-brand asset (the existing `lookupExternalBrand(null)` fallback). External contributors **never** render DiceBear, even when `brandKey` is unknown.
- `isExternal === false` → `DicebearAvatar` is the renderer (seeded by appearance / persona / name as `EmployeeAvatar` already implements).
- Legacy contributor records lacking `isExternal` SHALL be treated as `isExternal: false` (internal) and render via DiceBear; this is the only case where the absence of `brandKey` infers internal identity.

Additional contributors beyond 3 SHALL be collapsed into a single `+N` badge whose tooltip lists the overflow names.

`DeliverableCard.tsx` SHALL NOT call `DicebearAvatar` directly for contributor rendering. The pre-change `<DicebearAvatar seed={emp.employeeName} size={size} />` site SHALL be replaced with `<EmployeeAvatar agent={...} size={size} />` where `agent` carries the row-shape `{ is_external, brand_key, name, persona_json: null }` derived from the contributor record. The TODO comment at `DeliverableCard.tsx:104` SHALL be removed.

#### Scenario: Internal contributor renders DiceBear

- **WHEN** `item.contributingEmployees = [{ employeeId, employeeName: 'Maya', roleSlug: 'designer', isExternal: false, brandKey: null }]`
- **THEN** the header shows exactly one DiceBear avatar seeded with Maya's name; no `+N` badge appears

#### Scenario: External brand contributor renders BrandAvatar2D

- **WHEN** `item.contributingEmployees = [{ employeeId, employeeName: 'Hermes Bot', roleSlug: 'external', isExternal: true, brandKey: 'hermes' }]`
- **THEN** the header shows the Hermes brand SVG via `BrandAvatar2D`; no DiceBear seed is generated for this contributor

#### Scenario: External contributor with null brandKey renders BrandAvatar2D fallback

- **WHEN** `item.contributingEmployees = [{ employeeId, employeeName: 'Generic Bot', roleSlug: 'external', isExternal: true, brandKey: null }]`
- **THEN** the header renders `BrandAvatar2D` with its custom-external-brand fallback (via `lookupExternalBrand(null)`)
- **AND** DiceBear is **not** invoked for this contributor

#### Scenario: Mixed internal + external contributors

- **WHEN** `item.contributingEmployees = [Maya (internal), Hermes (external/hermes), Codex (external/codex)]`
- **THEN** the header renders three avatars in order: DiceBear (Maya), Hermes brand, Codex brand
- **AND** clicking through `EmployeeAvatar` dispatch shows internal vs external paths

#### Scenario: Four or more contributors fold into +N

- **WHEN** `item.contributingEmployees = [Maya, Hermes, Ryan, Sophie]` regardless of internal/external mix
- **THEN** the header shows three avatars (Maya DiceBear / Hermes brand / Ryan DiceBear) followed by a `+1` badge; tooltip on the badge lists Sophie

#### Scenario: Contributor record missing isExternal/brandKey falls back as internal

- **WHEN** a historical `Deliverable.contributingEmployees` element lacks `isExternal` or `brandKey` fields (legacy persisted shape)
- **THEN** rendering tolerates the absence by treating `isExternal` as `false` and `brandKey` as `null`, producing a DiceBear avatar
- **AND** no runtime error is thrown

## ADDED Requirements

### Requirement: Contributor brand metadata propagates from employee row through StepTaskOutput to deliverable emit

The contributor `isExternal` + `brandKey` fields SHALL propagate through every layer of the deliverable emit chain so that `DeliverableCard` always receives the correct values. The propagation chain has **three independent emit paths**, all of which SHALL carry the fields:

```
employee row (is_external + brand_key)
  → StepTaskOutput.{ isExternal, brandKey }   [packages/core/src/graph/state.ts]
  ├→ boss-summary-node.emitDeliverable        [packages/core/src/agents/boss-summary-node.ts]
  ├→ employee-completion.ts (direct emit)     [materialized artifact path]
  └→ employee-a2a-executor.ts (direct emit)   [external A2A artifact path]
  → DeliverableCreatedPayload.contributingEmployees[]
  → useDeliverables.Deliverable.contributingEmployees[]
  → DeliverableCard.ContributorStack render
```

`StepTaskOutput` (defined at `packages/core/src/graph/state.ts`) SHALL carry `isExternal: boolean` and `brandKey: string | null` as required (non-optional) fields. Every `StepTaskOutput` construction site (employee node, external-employee-dispatch, sop-runner, and any future producer) SHALL populate both fields by reading from the underlying employee row's `is_external` (mapped to `boolean`) and `brand_key` (mapped to `string | null`). External A2A employees SHALL set `isExternal: true` and `brandKey` from the brand metadata.

All three deliverable emit sites (`boss-summary-node.emitDeliverable`, `employee-completion.ts`, `employee-a2a-executor.ts`) SHALL pass both fields through verbatim into `DeliverableCreatedPayload.contributingEmployees[]`. No layer is permitted to drop these fields silently. Direct emits that do not flow through `currentStepOutputs` SHALL read the fields directly from the producing employee's row.

Persisted state restored from a LangGraph checkpoint (`apps/web/src/lib/tauri-checkpoint.ts`) MAY contain pre-change `currentStepOutputs[]` entries lacking the new fields. The hydrate path SHALL backfill missing fields with `isExternal: false` / `brandKey: null` (legacy = internal) so the strict TypeScript shape is satisfied without runtime error. Harness scenario fixtures (`packages/core/harness/scenarios/*.json`) SHALL be updated in lockstep so that strict scenario validation does not require ad-hoc type coercion.

#### Scenario: Internal employee output carries internal flags

- **WHEN** an internal employee produces a `StepTaskOutput`
- **THEN** `output.isExternal === false` and `output.brandKey === null`
- **AND** the resulting `DeliverableCreatedPayload.contributingEmployees` element carries the same values

#### Scenario: External A2A employee output carries brand metadata

- **WHEN** an external A2A employee with `brand_key === 'hermes'` produces a `StepTaskOutput`
- **THEN** `output.isExternal === true` and `output.brandKey === 'hermes'`
- **AND** the resulting `DeliverableCreatedPayload.contributingEmployees` element carries the same values
- **AND** the rendered `DeliverableCard` shows the Hermes brand avatar via `EmployeeAvatar` dispatch

#### Scenario: Direct artifact emit from employee-completion preserves fields

- **WHEN** `employee-completion.ts` emits `deliverable.created` directly for a materialized artifact (without flowing through `boss-summary-node`)
- **THEN** the emitted `contributingEmployees[]` single element carries `isExternal` + `brandKey` derived from the producing employee's row
- **AND** the rendered `DeliverableCard` dispatches via `EmployeeAvatar` correctly (external → BrandAvatar2D, internal → DiceBear)

#### Scenario: Direct artifact emit from employee-a2a-executor preserves fields

- **WHEN** `employee-a2a-executor.ts` emits `deliverable.created` directly for an external A2A artifact (without flowing through `boss-summary-node`)
- **THEN** the emitted `contributingEmployees[]` single element carries `isExternal: true` + `brandKey` (registered or `null`) derived from the external employee's row
- **AND** the rendered `DeliverableCard` shows `BrandAvatar2D` (with brand-specific or fallback asset)

#### Scenario: Mixed contributors round-trip through persistence

- **WHEN** a deliverable is emitted with mixed internal/external contributors, persisted to `contributors_json`, and rehydrated
- **THEN** the rehydrated `Deliverable.contributingEmployees` preserves both `isExternal` and `brandKey` for every element
- **AND** the rendered card shows the same avatar mix as before persistence

#### Scenario: Legacy persisted contributors lack brand fields

- **WHEN** `contributors_json` was written before this change and lacks `isExternal` / `brandKey`
- **THEN** the persistence-service deserializer fills them with `isExternal: false` / `brandKey: null` without throwing
- **AND** the rendered card shows DiceBear avatars (legacy contributors treated as internal)

#### Scenario: Legacy LangGraph checkpoint restored without brand fields

- **WHEN** `TauriCheckpointSaver.loadLatest` restores a pre-change checkpoint whose `currentStepOutputs[]` entries lack `isExternal` / `brandKey`
- **THEN** the hydrate path backfills `isExternal: false` / `brandKey: null` for every missing entry
- **AND** the resumed graph executes without TypeScript-strict runtime errors
- **AND** any subsequent `deliverable.created` emit derived from these restored entries carries the backfilled (legacy = internal) values
