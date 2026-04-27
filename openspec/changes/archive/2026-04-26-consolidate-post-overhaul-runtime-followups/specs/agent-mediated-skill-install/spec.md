## ADDED Requirements

### Requirement: `skill_install_confirm` interaction SHALL accept `'create'` action

The `skill_install_confirm` interaction kind SHALL accept `action='create'` alongside the existing `'install'` / `'fork'` / `'edit'` actions. Payload contract for `'create'`:
- `action: 'create'`
- `stagedSkillId: string` — staging handle
- `skillBody: string` — full SKILL.md text being previewed
- `slug: string` — kebab-case slug derived from frontmatter `name`
- `scope: 'employee'` — self-authored skills are employee-scope only
- `targetEmployeeId: string` — must equal the chat's resolvedEmployeeId
- `modelKey: string` — provider+model identifier (`minimax/MiniMax-M2.7`)
- `frontmatterError?: { reason: 'missing-required' | 'forbidden-namespace' | 'unknown-field' | 'invalid-yaml'; detail: string }` — present only if frontmatter failed whitelist; preview disabled in this case

The `confirm` outcome routes through the same `SkillInstallCommitter` two-phase commit as `'install'` / `'fork'` / `'edit'`. The `cancel` outcome discards the staging entry.

#### Scenario: Confirm 'create' triggers vault write

- **WHEN** a `skill_install_confirm` interaction with `action='create'` is confirmed by the user
- **THEN** `SkillInstallCommitter` executes the commit phase, writes `companies/{cid}/employees/{slug}/skills/{slug}/SKILL.md`, inserts the `skills` row with `source_kind='self-authored'`, and the chat surface renders "Skill created."

#### Scenario: Cancel 'create' discards staging

- **WHEN** a `skill_install_confirm` interaction with `action='create'` is cancelled
- **THEN** `skillStagingManager` discards the staging entry, no vault file is written, and the chat surface renders "Skill creation cancelled."

#### Scenario: Frontmatter error path disables confirm

- **WHEN** a `skill_install_confirm` interaction with `action='create'` carries `frontmatterError`
- **THEN** the `Create skill` button is disabled, the error reason + detail render inline, and a `Retry` button re-prompts the LLM via the chat input
