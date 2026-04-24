## MODIFIED Requirements

### Requirement: Typed parser for employee config_json

`parseEmployeeConfig(raw: string | null): EmployeeConfig` SHALL return an `EmployeeConfig` object with all fields optional. The accepted config fields are `modelPreference`, `temperature`, `maxTokens`, and `toolPermissionPolicy`. It SHALL validate `toolPermissionPolicy` shapes before returning them and drop malformed nested payloads.

#### Scenario: Parses modelPreference and toolPermissionPolicy
- **WHEN** called with `'{"modelPreference":"gpt-4","toolPermissionPolicy":{"defaultMode":"auto","overrides":[{"pattern":"mcp:*","mode":"always_ask"}]}}'`
- **THEN** returns both fields correctly typed

#### Scenario: Drops malformed toolPermissionPolicy
- **WHEN** called with `'{"toolPermissionPolicy":{"defaultMode":"maybe"}}'`
- **THEN** returns `{}` with no `toolPermissionPolicy` field set

### Requirement: UI form wrappers preserve form defaults

`parsePersonaJson` / `parseConfigJson` in `packages/ui-office/src/hooks/useEmployeeEditor.ts` SHALL continue returning form-ready data with UI default values (empty strings, `'medium'`, `'balanced'`, `'collaborative'`, `DEFAULT_APPEARANCE`, `0.7`, `4096`, `null` for unset tool-permission policy), built as a layer on top of the shared parsers. Their call signatures and return shapes SHALL NOT change.

#### Scenario: Missing field gets form default
- **WHEN** UI form wrapper parses `'{"expertise":"Design"}'`
- **THEN** returns `{ expertise: 'Design', style: '', customInstructions: '', communicationFrequency: 'medium', riskPreference: 'balanced', decisionStyle: 'collaborative', appearance: DEFAULT_APPEARANCE }`
