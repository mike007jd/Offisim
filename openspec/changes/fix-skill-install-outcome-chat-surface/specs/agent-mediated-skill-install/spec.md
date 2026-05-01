## ADDED Requirements

### Requirement: Skill install committer outcome SHALL surface to chat with per-kind copy via a single SSOT

When a `skill_install_confirm` interaction resolves, BOTH the chat assistant message (`apps/web/src/runtime/interaction-follow-up.ts`) AND the activity rail (`packages/ui-office/src/runtime/runtime-activity-formatters.ts` consumed via `subscribeInteractionMappers`) SHALL surface a message that reflects the actual `SkillInstallConfirmOutcome.kind`. The message SHALL distinguish between successful resolution paths (`installed` / `created` / `edited`), explicit cancellation (`cancelled`), staging timeout (`staging-expired`), and committer error (`error`).

The copy SSOT is `skillInstallOutcomeLabel(outcome)` exported from `@offisim/shared-types`. Both surfaces MUST consume this single function — no inline copy tables, no action-specific variants, no hardcoded `'Skill install confirmed' | 'Skill install cancelled'` strings.

The `skillSlug` for `installed` / `created` / `edited` outcomes SHALL be populated by `SkillInstallCommitter` from the written `skill_row.slug` and carried in the outcome itself; no async DB lookup happens at render time.

A new event `skill.install.outcome` (type constant `SKILL_INSTALL_OUTCOME`) SHALL be emitted at the resolve site (`packages/core/src/services/interaction-service.ts`) carrying the typed outcome plus `interactionId`. The activity rail mapper SHALL consume this event and SHALL skip `skill_install_confirm` in its `interaction.resolved` handler to avoid double-logging.

#### Scenario: Installed outcome surfaces success copy with slug
- **WHEN** an agent tool such as `install_skill_from_git` runs, the user confirms the staging preview, and the committer returns `{ kind: 'installed', skillId, skillSlug, wasExisting }`
- **THEN** the chat assistant message and the activity rail both surface `Skill {skillSlug} installed.`

#### Scenario: Created outcome surfaces self-authoring copy with slug
- **WHEN** the `create_skill_from_scratch` flow returns `{ kind: 'created', skillId, skillSlug, wasExisting }` after user confirms
- **THEN** the chat assistant message and the activity rail both surface `Skill {skillSlug} created from scratch.`

#### Scenario: Edited outcome surfaces edit copy
- **WHEN** the `edit_skill_body` flow returns `{ kind: 'edited', skillId, skillSlug }`
- **THEN** the chat assistant message and the activity rail both surface `Skill body updated.`

#### Scenario: Cancelled outcome surfaces single cancellation copy
- **WHEN** the user clicks Cancel in `SkillInstallConfirmBubble` for any action (install / fork / edit / create) and the resolver returns `{ kind: 'cancelled' }`
- **THEN** the chat assistant message and the activity rail both surface `Skill action cancelled.` (single copy regardless of action kind)

#### Scenario: Staging-expired outcome surfaces retry guidance
- **WHEN** the staging entry expires before the user resolves the interaction and the resolver returns `{ kind: 'staging-expired' }`
- **THEN** the chat assistant message and the activity rail both surface `Skill staging timed out — try again.`

#### Scenario: Error outcome surfaces typed failure
- **WHEN** the committer throws after the user confirms and `applySkillInstallConfirm` wraps it as `{ kind: 'error', errorKind, message }`
- **THEN** the chat assistant message and the activity rail both surface `Skill action failed: {errorKind}: {message}` with `message` truncated at 120 UTF-16 characters
