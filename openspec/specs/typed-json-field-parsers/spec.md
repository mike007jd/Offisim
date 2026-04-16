# typed-json-field-parsers

## Purpose

Centralised, typed parsers for the three JSON blob fields stored on employee and prefab rows (`employees.persona_json`, `employees.config_json`, `prefab_instances.bindings_json`). Eliminates scattered `JSON.parse` call sites, gives `@offisim/core` and `@offisim/ui-office` a single typed source of truth, and keeps the UI form wrappers (`parsePersonaJson` / `parseConfigJson` in `useEmployeeEditor.ts`) as a thin default-filling layer on top.

## Requirements

### Requirement: Typed parser for employee persona_json
`parseEmployeePersona(raw: string | null): EmployeePersona` SHALL return an `EmployeePersona` object with all fields optional. It SHALL return an empty object `{}` when `raw` is null or invalid JSON or a non-object payload.

#### Scenario: Valid persona JSON
- **WHEN** called with `'{"expertise":"Design","avatarSeed":"atlas"}'`
- **THEN** returns `{ expertise: 'Design', avatarSeed: 'atlas' }` with other fields undefined

#### Scenario: Invalid JSON
- **WHEN** called with `'{not valid'`
- **THEN** returns `{}`

#### Scenario: Null input
- **WHEN** called with `null`
- **THEN** returns `{}`

### Requirement: Typed parser for employee config_json
`parseEmployeeConfig(raw: string | null): EmployeeConfig` SHALL return an `EmployeeConfig` object with all fields optional. It SHALL validate `runtimeSkill` and `toolPermissionPolicy` shapes before returning them and drop malformed nested payloads.

#### Scenario: Parses modelPreference and runtimeSkill
- **WHEN** called with `'{"modelPreference":"gpt-4","runtimeSkill":{"skillName":"s1","summary":"x"}}'`
- **THEN** returns both fields correctly typed

#### Scenario: Drops malformed runtimeSkill
- **WHEN** called with `'{"runtimeSkill":{"skillName":42}}'`
- **THEN** returns `{}` with no `runtimeSkill` field set

### Requirement: Validated parser for prefab bindings_json
`parsePrefabBindings(raw: string | null): PrefabBinding[]` SHALL return a validated array. Items missing required fields (`slotName`, `resourceRef`) SHALL be filtered out. It SHALL return `[]` on null/invalid input.

#### Scenario: Valid bindings
- **WHEN** called with `'[{"slotName":"s1","resourceRef":"r1"}]'`
- **THEN** returns `[{ slotName: 's1', resourceRef: 'r1' }]`

#### Scenario: Invalid item filtered
- **WHEN** called with `'[{"slotName":"s1"},{"slotName":"s2","resourceRef":"r2"}]'`
- **THEN** returns only the valid item `[{ slotName: 's2', resourceRef: 'r2' }]`

### Requirement: Parsers live in shared-types
The typed parsers SHALL be defined in `@offisim/shared-types` (`packages/shared-types/src/json-field-parsers.ts`) so they are importable by both `@offisim/core` and `@offisim/ui-office` without creating a circular dependency.

#### Scenario: Both packages can import
- **WHEN** core and ui-office both need to parse persona_json
- **THEN** both import `parseEmployeePersona` from `@offisim/shared-types`

### Requirement: UI form wrappers preserve form defaults
`parsePersonaJson` / `parseConfigJson` in `packages/ui-office/src/hooks/useEmployeeEditor.ts` SHALL continue returning form-ready data with UI default values (empty strings, `'medium'`, `'balanced'`, `'collaborative'`, `DEFAULT_APPEARANCE`, `0.7`, `4096`, `null` for unset skill/policy), built as a layer on top of the shared parsers. Their call signatures and return shapes SHALL NOT change.

#### Scenario: Missing field gets form default
- **WHEN** UI form wrapper parses `'{"expertise":"Design"}'`
- **THEN** returns `{ expertise: 'Design', style: '', customInstructions: '', communicationFrequency: 'medium', riskPreference: 'balanced', decisionStyle: 'collaborative', appearance: DEFAULT_APPEARANCE }`

### Requirement: No scattered JSON.parse on these three fields
Consumers in `@offisim/core` and `@offisim/ui-office` SHALL NOT call `JSON.parse` directly on `persona_json`, `config_json`, or `bindings_json` values. All reads SHALL go through `parseEmployeePersona` / `parseEmployeeConfig` / `parsePrefabBindings`.

#### Scenario: Grep gate
- **WHEN** the repository is scanned with `JSON\.parse.*(persona_json|config_json|bindings_json)`
- **THEN** no matches exist under `packages/**/src/**` or `apps/**/src/**`
