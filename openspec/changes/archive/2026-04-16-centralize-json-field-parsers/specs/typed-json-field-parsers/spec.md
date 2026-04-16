## ADDED Requirements

### Requirement: Typed parsers for employee persona_json
`parseEmployeePersona(raw: string | null): EmployeePersona` SHALL return an `EmployeePersona` object with all fields optional. It SHALL return an empty object `{}` when raw is null or invalid JSON.

#### Scenario: Valid persona JSON
- **WHEN** called with `'{"expertise":"Design","avatarSeed":"atlas"}'`
- **THEN** returns `{ expertise: 'Design', avatarSeed: 'atlas' }` with other fields undefined

#### Scenario: Invalid JSON
- **WHEN** called with `'{not valid'`
- **THEN** returns `{}`

#### Scenario: Null input
- **WHEN** called with `null`
- **THEN** returns `{}`

### Requirement: Typed parsers for employee config_json
`parseEmployeeConfig(raw: string | null): EmployeeConfig` SHALL return an `EmployeeConfig` object with all fields optional.

#### Scenario: Parses modelPreference and runtimeSkill
- **WHEN** called with `'{"modelPreference":"gpt-4","runtimeSkill":{"skillName":"s1","summary":"x"}}'`
- **THEN** returns both fields correctly typed

### Requirement: Validated parser for prefab bindings
`parsePrefabBindings(raw: string | null): PrefabBinding[]` SHALL return a validated array. Items missing required fields (`slotName`, `resourceRef`) SHALL be filtered out. It SHALL return `[]` on null/invalid input.

#### Scenario: Valid bindings
- **WHEN** called with `'[{"slotName":"s1","resourceRef":"r1"}]'`
- **THEN** returns `[{ slotName: 's1', resourceRef: 'r1' }]`

#### Scenario: Invalid item filtered
- **WHEN** called with `'[{"slotName":"s1"},{"slotName":"s2","resourceRef":"r2"}]'`
- **THEN** returns only the valid item `[{ slotName: 's2', resourceRef: 'r2' }]`

### Requirement: Parsers live in shared-types
The typed parsers SHALL be defined in `@offisim/shared-types` so they are importable by both `@offisim/core` and `@offisim/ui-office`.

#### Scenario: Both packages can import
- **WHEN** core and ui-office both need to parse persona_json
- **THEN** both import `parseEmployeePersona` from `@offisim/shared-types`

### Requirement: UI form wrappers preserve form defaults
`parsePersonaJson` / `parseConfigJson` in `useEmployeeEditor.ts` SHALL continue returning form-ready data with UI default values (empty strings, 'medium', 'balanced', etc.), built as a layer on top of the shared parsers.

#### Scenario: Missing field gets form default
- **WHEN** UI form wrapper parses `'{"expertise":"Design"}'`
- **THEN** returns `{ expertise: 'Design', style: '', customInstructions: '', communicationFrequency: 'medium', ... }` preserving existing UX
