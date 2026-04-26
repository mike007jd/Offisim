## ADDED Requirements

### Requirement: Employee can author a new skill from scratch via LLM tool

The system SHALL register a `create_skill_from_scratch` employee tool that accepts an LLM-authored SKILL.md body (frontmatter + markdown body) and routes it through the existing skill-install staging pipeline. The tool SHALL be available to all employees in companies where `skillStagingManager` + `skillLoader` are wired (same gating as T2.2 `install_skill_from_*` and T2.3 `fork_skill` / `edit_skill_body`).

The tool SHALL accept input `{ skillBody: string; targetEmployeeId?: string }` where:
- `skillBody` is the full SKILL.md text (frontmatter + body) the LLM produced.
- `targetEmployeeId` defaults to the authoring employee; explicit override is allowed only for the same employee in the current chat — the tool MUST reject mismatch with the chat's selectedEmployeeId.

The tool SHALL **NOT** invoke `installSkill` directly. Instead it SHALL stage the skill through `skillStagingManager` and emit an `interaction` event of kind `skill_install_confirm` with `action='create'` so the user previews + confirms before vault write.

#### Scenario: Employee invokes create_skill_from_scratch with valid LLM output

- **WHEN** an employee LLM in chat invokes `create_skill_from_scratch` with a SKILL.md body whose frontmatter passes the whitelist (name + description present, no `offisim.*`, no unknown fields)
- **THEN** the tool stages the skill, emits `skill_install_confirm` interaction with `action='create'`, and the chat surface renders the preview bubble showing the SKILL.md preview, slug, and `Create skill` / `Cancel` buttons

#### Scenario: Tool rejects targetEmployeeId mismatch

- **WHEN** the tool is invoked with a `targetEmployeeId` that does not match the active chat's selectedEmployeeId
- **THEN** the tool returns an error reading "Skill author must match the active chat employee" and no staging occurs

### Requirement: Frontmatter MUST pass strict whitelist before staging

Self-authoring SHALL apply a strict frontmatter whitelist on top of T2.1 `parseSkillMd`:
- `name` (kebab-case) and `description` are required.
- `allowedTools`, `license`, `version` are the only optional fields permitted.
- ALL `offisim.*` keys are rejected (preserve open-standard portability per SKILL.md spec).
- Any unknown frontmatter field rejects the body — there is no permissive passthrough.

On rejection the tool SHALL emit a `SkillFrontmatterError` with a specific reason code (`missing-required` / `forbidden-namespace` / `unknown-field` / `invalid-yaml`) and pass it back to chat so the LLM can retry with corrected output.

#### Scenario: Frontmatter with offisim.* key is rejected

- **WHEN** the LLM-authored body's frontmatter contains any `offisim.*` key (e.g., `offisim.priority: high`)
- **THEN** the tool returns `SkillFrontmatterError(reason='forbidden-namespace')` with the offending key, no staging entry is created, and the chat surface re-prompts the LLM to retry without `offisim.*` keys

#### Scenario: Frontmatter with unknown field is rejected

- **WHEN** the LLM-authored body's frontmatter contains a key not in the whitelist (e.g., `category: ops`)
- **THEN** the tool returns `SkillFrontmatterError(reason='unknown-field')` and no staging occurs

#### Scenario: Frontmatter missing required field is rejected

- **WHEN** the LLM-authored body's frontmatter omits `name` or `description`
- **THEN** the tool returns `SkillFrontmatterError(reason='missing-required')` and no staging occurs

### Requirement: Self-authored skills SHALL reuse T2.2 staging + two-phase commit pipeline

Self-authoring SHALL go through the existing `SkillInstallCommitter` (T2.2) without adding a parallel commit path. Specifically:
- Staging is created via `skillStagingManager.stage(...)` with the same TTL as T2.2 / T2.3.
- Confirm action invokes `SkillLoader.installSkill({ source: { kind: 'self-authored' } })` which writes vault SKILL.md + inserts `skills` row.
- The new `skills` row MUST have `source_kind='self-authored'` and `source_ref='llm-author:<modelKey>'` where `<modelKey>` is the active provider+model identifier (e.g., `minimax/MiniMax-M2.7`).
- Default scope is `employee` (the authoring employee); company scope is **NOT** allowed via self-authoring (must go through publish flow separately).

`staging-expired` and `skill-install-error` outcomes SHALL bubble back to chat via the same `respondToInteraction` outcome path that T2.3 uses; users seeing an expired staging SHALL get a clear retry CTA.

#### Scenario: Confirmed self-authored skill writes to vault and skills table

- **WHEN** the user clicks `Create skill` on the preview bubble for a valid staged self-authored skill
- **THEN** vault `companies/{cid}/employees/{slug}/skills/{slug}/SKILL.md` is written and a `skills` row is inserted with `scope='employee'`, `source_kind='self-authored'`, `source_ref='llm-author:<modelKey>'`

#### Scenario: Cancel discards staged skill without vault write

- **WHEN** the user clicks `Cancel` on the preview bubble
- **THEN** `skillStagingManager` discards the staging entry, no vault file is written, no `skills` row is inserted, and the chat surface renders "Skill creation cancelled."

### Requirement: Preview bubble SHALL expose `'create'` action variant

The existing `SkillInstallConfirmBubble` SHALL gain a `'create'` action branch alongside `'install'` / `'fork'` / `'edit'`. Visual treatment:
- Header: `Create new skill from {employeeName}`
- Body: SKILL.md preview (frontmatter + markdown body, monospace), slug, scope label (`Employee · {employeeName}`), and the inferred provider+model (`Authored by {modelKey}`).
- Primary CTA: `Create skill` (cyan accent).
- Secondary: `Cancel` (ghost).
- On rejection (frontmatter error) the bubble SHALL display the `SkillFrontmatterError` reason + offending key/field, with a `Retry` CTA that re-prompts the LLM.

The bubble SHALL **NOT** allow inline editing of the SKILL.md body — users either accept LLM output or reject it. (Editing post-create is T2.3 `edit_skill_body`.)

#### Scenario: Preview bubble renders create action

- **WHEN** the chat surface receives an `interaction` event of kind `skill_install_confirm` with `action='create'`
- **THEN** `SkillInstallConfirmBubble` renders with the create header, SKILL.md preview, scope label, model attribution, and `Create skill` / `Cancel` CTAs

#### Scenario: Frontmatter error path renders inline error

- **WHEN** the chat surface receives an `interaction` event of kind `skill_install_confirm` with `action='create'` and the staged skill carries a `SkillFrontmatterError`
- **THEN** the bubble renders the error reason ("Forbidden namespace: offisim.priority") + offending key + `Retry` CTA, and `Create skill` is disabled
