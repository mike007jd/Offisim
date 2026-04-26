## ADDED Requirements

### Requirement: `MiniMax-M2.7-highspeed` is no longer the default model

As of 2026-04-26 (commit `f3bb26dd`), the global default MiniMax model SHALL be `MiniMax-M2.7`, not `MiniMax-M2.7-highspeed`. Reason: the highspeed token plan is no longer supported by the upstream provider for our key tier, returning `2061: token plan not support model, MiniMax-M2.7-highspeed` on every request.

All of the following SHALL reflect `MiniMax-M2.7` as the default and SHALL NOT reference `highspeed` as a runtime fallback:
- `apps/web/vite.config.ts` `MINIMAX_MODEL` default.
- `packages/ui-office/src/lib/provider-config.ts` env-fallback default.
- `catalog/provider-source-registry/` curated entries (no `highspeed` model item).
- All other env / config / preset paths that resolve a default MiniMax model name.

The `highspeed` model name SHALL only appear in change history (`openspec/changes/archive/...`) and in this spec scenario as the rejected alternative.

#### Scenario: Default MiniMax model resolves to MiniMax-M2.7

- **WHEN** a fresh runtime initializes with no stored ProviderConfig and `MINIMAX_API_KEY` is present in env
- **THEN** the auto-created provider config has `model: 'MiniMax-M2.7'`, not `MiniMax-M2.7-highspeed`

#### Scenario: catalog has no highspeed entry

- **WHEN** scanning `catalog/provider-source-registry/` curated entries for MiniMax models
- **THEN** no entry references `MiniMax-M2.7-highspeed` as an active model option (only `MiniMax-M2.7` and any other supported aliases)
