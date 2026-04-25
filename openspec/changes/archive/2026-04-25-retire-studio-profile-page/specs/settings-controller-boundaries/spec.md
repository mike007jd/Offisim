## ADDED Requirements

### Requirement: Company-level model defaults SHALL be owned exclusively by Settings → Runtime via runtimePolicy

Company-level defaults for `model`, `temperature`, and `maxTokens` (the values consumed by `ModelResolver` at runtime) SHALL be owned exclusively by `runtimePolicy.modelPolicy`, configured through Settings → Runtime tab. No other UI surface in the application SHALL provide an editor that writes equivalent fields to a parallel store.

In particular, no code SHALL write `defaultModel`, `defaultTemperature`, or `defaultMaxTokens` keys into `officeLayouts.layout_json.policy` or any other location that is not `runtimePolicy.modelPolicy`. Legacy data on disk MAY exist but SHALL NOT be surfaced to users via any editor.

The `personnel-runtime-engine-binding` capability remains the SSOT for company-level employee runtime defaults (provider gateway vs trusted engine), exposed alongside the model defaults inside the same Runtime tab.

#### Scenario: No parallel write path for default model fields
- **WHEN** grepping `packages/ui-office/src/**/*.{ts,tsx}` (excluding `dist/` and tests) for assignments to `defaultModel:`, `defaultTemperature:`, or `defaultMaxTokens:` as part of an object passed to a repository write
- **THEN** zero matches exist outside of `controller/useSettingsRuntimePolicy.ts` or other Settings → Runtime sibling hooks

#### Scenario: ModelResolver consumes runtimePolicy only
- **WHEN** grepping `apps/web/src/lib/browser-runtime.ts` and `apps/web/src/lib/tauri-runtime.ts` for `new ModelResolver(`
- **THEN** every call site passes `runtimePolicy` (the `RuntimePolicyConfig` from Settings) as the first argument

#### Scenario: PolicyEditor component does not exist
- **WHEN** running `ls packages/ui-office/src/components/company/PolicyEditor.tsx`
- **THEN** the command exits with a non-zero status (no such file)
