## Why

Skill install outcome surfacing has two divergent code paths:

1. **Chat assistant message** (`apps/web/src/runtime/interaction-follow-up.ts`) — produced when `respondToInteraction()` resolves a `skill_install_confirm`. Already kind-aware but with action-specific copy ("Skill creation cancelled." vs "Skill install cancelled."), missing the slug, and inconsistent with the rest of the system.
2. **Activity rail** (`packages/ui-office/src/runtime/runtime-activity-formatters.ts:147`) — fed by `interaction.resolved`, returned hardcoded `'Skill install confirmed'` / `'Skill install cancelled'` regardless of the real `SkillInstallConfirmOutcome.kind`, collapsing 6 distinct states into 2.

Result: users see two slightly different stories about the same install outcome, can't tell `installed` apart from `created` / `edited` / `staging-expired` / `error`, and the copy never includes the skill slug. T2.2 (b) backlog item.

## What Changes

- Single SSOT for outcome copy: `skillInstallOutcomeLabel(outcome)` in `@offisim/shared-types`. Both surfaces consume it.
- Slug bundled with the outcome at commit time (`SkillInstallCommitter` reads `row.slug`); no async DB lookup at render time.
- New runtime event `skill.install.outcome` (factory `skillInstallOutcome`, type constant `SKILL_INSTALL_OUTCOME = 'skill.install.outcome'`) carrying typed `SkillInstallOutcomeKind` + `interactionId` from the resolve site (`packages/core/src/services/interaction-service.ts`) so the activity rail mapper can branch by outcome without querying interaction-service state.
- `interaction-follow-up.ts` for `skill_install_confirm` SHALL call `skillInstallOutcomeLabel` for the assistant message; activity rail mapper SHALL call the same function. Per-kind copy: `installed` / `created` / `edited` / `cancelled` / `staging-expired` / `error` per design.md.
- The hardcoded `'Skill install confirmed'` / `'Skill install cancelled'` strings AND the action-specific cancellation strings SHALL be removed once both surfaces consume the SSOT.

## Capabilities

### New Capabilities
<!-- None — modifies an existing capability. -->

### Modified Capabilities

- `agent-mediated-skill-install`: adds a Requirement that BOTH the chat assistant message and the activity rail SHALL surface the typed `SkillInstallConfirmOutcome.kind` (with slug for variants that have one) via a single SSOT label function, not divergent or hardcoded strings.

## Impact

- **Code touched**:
  - `packages/shared-types/src/events/install.ts` — `SKILL_INSTALL_OUTCOME` constant, `SkillInstallOutcomeKind` (with `skillSlug` on success variants), `SkillInstallOutcomePayload`, `skillInstallOutcomeLabel(outcome)` SSOT function
  - `packages/core/src/events/install-events.ts` — `skillInstallOutcome` factory + barrel re-exports
  - `packages/core/src/services/interaction-service.ts` — `SkillInstallConfirmOutcome` re-aliases shared `SkillInstallOutcomeKind`; emit new event at resolve site
  - `packages/core/src/skills/skill-install-committer.ts` — populate `skillSlug` on success outcomes
  - `apps/web/src/runtime/interaction-follow-up.ts` — replace inline copy table with `skillInstallOutcomeLabel`
  - `packages/ui-office/src/runtime/runtime-activity-formatters.ts` — drop `skill_install_confirm` case from `interactionResolvedLabel`
  - `packages/ui-office/src/runtime/activity-feed/mappers/interaction-mappers.ts` — subscribe to `SKILL_INSTALL_OUTCOME`, push entry using shared label, skip `skill_install_confirm` in `interaction.resolved` handler
- **APIs / data**: outcome shape gains required `skillSlug` on success variants — internal contract only, not persisted. New event is additive. No schema migration.
- **Risk surface**: low — single emit point, single SSOT copy function, isolated from agent / runtime / Rust layers.
- **Verification gate**: release `.app` live verify of chat assistant message (the user-visible surface) for `created` (confirm self-author) and `cancelled` (dismiss self-author) outcomes. `installed` / `edited` covered by code review (same SSOT function, same slug delivery). `error` and `staging-expired` are committer-side states that require fault injection or TTL waiting — code-covered, not live-verified in this change.
