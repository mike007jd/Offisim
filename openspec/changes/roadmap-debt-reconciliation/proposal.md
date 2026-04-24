## Why

Roadmap reviews are overstating current backlog by mixing historical excluded items with real capability debt. At the same time, several canonical specs and package `CLAUDE.md` files still describe legacy `runtimeSkill` or skill-activation behavior that no longer matches the codebase.

## What Changes

- Add a single roadmap debt ledger that classifies items into `True debt`, `Docs/process cleanup`, and `Historical excluded`.
- Refresh stale canonical specs and package `CLAUDE.md` files so they reflect the current Available skills / skill-mutation / employee config contracts.
- Annotate selected archived task files where remaining unchecked items are deferred or superseded, so they are not misread as active roadmap debt.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `employee-node-boundaries`: align the employee runtime contract with prompt-listed skills and skill install/fork/edit tool-kit behavior instead of legacy `runtimeSkill` and activation-tool flow.
- `typed-json-field-parsers`: align the employee config parser contract with the current `modelPreference` / `temperature` / `maxTokens` / `toolPermissionPolicy` shape.

## Impact

- `openspec/roadmap-debt-ledger.md`
- `openspec/specs/employee-node-boundaries/spec.md`
- `openspec/specs/typed-json-field-parsers/spec.md`
- selected archived `tasks.md` files under `openspec/changes/archive/`
- `packages/ui-office/CLAUDE.md`
- `packages/core/CLAUDE.md`
