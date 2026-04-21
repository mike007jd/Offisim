## ADDED Requirements

### Requirement: Employee tool kit exposes `fork_skill` and `edit_skill_body`

Every employee — internal and external (`is_external === 1`) alike — SHALL be registered with two additional skill-mutation tools on every runtime turn, beyond the four T2.2 install tools: `fork_skill` and `edit_skill_body`. Tool registration MUST NOT depend on employee role, department, or workstation. `fork_skill` SHALL declare parameters `{ skillId: string (required), targetEmployeeId: string (optional) }`. `edit_skill_body` SHALL declare parameters `{ skillId: string (required), newBody: string (required) }`. Neither tool SHALL accept a free-form `scope` parameter — fork targets the caller's own employee-scope bucket by default (and refuses cross-employee targets), edit only operates on the caller's own employee-scope skills.

#### Scenario: Tools are injected for every employee

- **WHEN** `employee-node` builds the tool list for any employee (internal or external)
- **THEN** `fork_skill` and `edit_skill_body` SHALL appear in the tool schema alongside the four T2.2 install tools

#### Scenario: Tool schemas carry the right parameters

- **WHEN** the LLM retrieves the schema for `fork_skill`
- **THEN** the schema SHALL declare `skillId` as a required string and `targetEmployeeId` as an optional string; no `scope` parameter SHALL be exposed

- **WHEN** the LLM retrieves the schema for `edit_skill_body`
- **THEN** the schema SHALL declare `skillId` as a required string and `newBody` as a required string; no `scope` or `targetEmployeeId` parameter SHALL be exposed

### Requirement: `fork_skill` copies a company-scope skill into the caller's employee-scope bucket

`fork_skill({ skillId, targetEmployeeId? })` SHALL only accept a `skillId` that resolves to a `scope='company'` row in the caller's company. When `targetEmployeeId` is omitted, the fork SHALL target the calling employee. When `targetEmployeeId` is supplied and does not equal the calling employee's id, the handler SHALL return `{ kind: 'cross-employee-forbidden' }`. A successful resolve SHALL stage a fork preview and emit a `skill_install_confirm` interaction with `context.action === 'fork'`. On confirm, `SkillLoader.installSkill({ scope: 'employee', source: { kind: 'fork', parentSkillId, parentVersion }, ... })` SHALL write the employee-scope SKILL.md (byte-identical body from parent) + copy parent `scripts/` / `references/` / `assets/` subtrees, and insert a `skills` row with `source_kind='forked'` and `source_ref='company-skill:<parentSkillId>@<parentVersion>'`. The fork's `slug` SHALL equal the parent `slug`; the `version` SHALL start at `'0.1.0'` (independent from parent version).

#### Scenario: Happy-path fork

- **WHEN** employee `e7` calls `fork_skill({ skillId: 'sk_company_writing' })` and a company-scope row with id `sk_company_writing`, slug `writing-style`, version `0.3.2` exists
- **THEN** the handler SHALL stage the fork and emit an interaction with `context.action='fork'` and `context.parent = { skillId: 'sk_company_writing', slug: 'writing-style', name: '...', version: '0.3.2' }`
- **AND** on confirm, an employee-scope row SHALL be inserted with `employee_id='e7'`, `slug='writing-style'`, `source_kind='forked'`, `source_ref='company-skill:sk_company_writing@0.3.2'`
- **AND** the SKILL.md under `companies/{c}/employees/<e7-slug>/skills/writing-style/SKILL.md` SHALL have byte-identical body to parent

#### Scenario: Fork parent must be company-scope

- **WHEN** `fork_skill({ skillId: <employee-scope-skill-id> })` is invoked
- **THEN** the handler SHALL return `{ kind: 'fork-parent-not-company' }`
- **AND** no interaction SHALL be emitted and no IO SHALL occur

#### Scenario: Cross-employee fork is refused

- **WHEN** employee `e7` calls `fork_skill({ skillId: <company-skill>, targetEmployeeId: 'e8' })`
- **THEN** the handler SHALL return `{ kind: 'cross-employee-forbidden' }`
- **AND** no interaction SHALL be emitted

#### Scenario: Missing skillId is surfaced

- **WHEN** `fork_skill({ skillId: 'sk_does_not_exist' })` is invoked
- **THEN** the handler SHALL return `{ kind: 'skill-not-found', skillId: 'sk_does_not_exist' }`

#### Scenario: Fork assets are copied

- **WHEN** the parent skill has `scripts/run.sh` and `references/guide.md`
- **THEN** on fork confirm, both files SHALL be written under the employee's skill directory byte-identically
- **AND** the same tier-3 asset guards (path-traversal / absolute / subtree) SHALL apply — a parent containing an out-of-subtree asset SHALL fail fork with the appropriate `SkillAssetError` kind

#### Scenario: Fork is idempotent on identical parent version

- **WHEN** employee `e7` forks `sk_company_writing@0.3.2` twice in a row and confirms both
- **THEN** the second confirm SHALL return the existing employee-scope row with `wasExisting: true` and MUST NOT duplicate the SKILL.md file or insert a second row

### Requirement: `edit_skill_body` overwrites the caller's own employee-scope skill body

`edit_skill_body({ skillId, newBody })` SHALL only accept a `skillId` that resolves to a `scope='employee'` row whose `employee_id` equals the calling employee's id. `newBody` SHALL be validated in the handler before staging: it MUST be non-empty (≥ 10 bytes after UTF-8 encoding), MUST NOT begin with a `---\n` frontmatter block (the existing frontmatter is preserved, never replaced), and MUST be ≤ 64 KiB. On validation pass, the handler SHALL stage `{ action: 'edit', skillId, newBody, employeeId, companyId }` and emit a `skill_install_confirm` interaction with `context.action='edit'` + `context.bodyDiff = { oldPreview, newPreview }` (each truncated to 160 UTF-16 code units). On confirm, `SkillLoader.editSkillBody({ skillId, newBody })` SHALL read the row, parse the existing SKILL.md frontmatter, write back a SKILL.md combining the preserved frontmatter with the new body, bump `skills.version` patch (e.g. `0.1.0 → 0.1.1`, `0.3.2 → 0.3.3`), refresh `updated_at`, and NOT mutate `source_kind` / `source_ref` / `slug` / `vault_path`.

#### Scenario: Happy-path edit

- **WHEN** employee `e7` calls `edit_skill_body({ skillId: 'sk_e7_writing', newBody: 'Keep sentences under 10 words.\n' })` and the row belongs to `e7`
- **THEN** the handler SHALL stage the edit and emit an interaction with `context.action='edit'` and a `bodyDiff` containing truncated old and new previews
- **AND** on confirm, the SKILL.md at the row's `vault_path` SHALL be re-written with the original frontmatter and the new body
- **AND** the row's `version` SHALL be bumped one patch level, `updated_at` refreshed; `source_kind`, `source_ref`, `slug`, `vault_path` SHALL be unchanged

#### Scenario: Edit on a company-scope skill is refused

- **WHEN** `edit_skill_body({ skillId: <company-scope-skill> })` is invoked
- **THEN** the handler SHALL return `{ kind: 'company-scope-forbidden' }`
- **AND** no staging, interaction, or IO SHALL occur

#### Scenario: Edit on another employee's skill is refused

- **WHEN** employee `e7` calls `edit_skill_body({ skillId: <e8's employee-scope skill> })`
- **THEN** the handler SHALL return `{ kind: 'not-skill-owner' }`

#### Scenario: newBody validation

- **WHEN** `edit_skill_body({ skillId: <own>, newBody: '' })` or `{ newBody: '---\nname: x\n---\nbody' }` or `{ newBody: <65_000 bytes> }` is invoked
- **THEN** the handler SHALL return `{ kind: 'invalid-new-body', reason: <'empty'|'frontmatter-in-body'|'too-large'> }`
- **AND** no staging, interaction, or IO SHALL occur

#### Scenario: Frontmatter is preserved byte-for-byte across edit

- **WHEN** the original SKILL.md has frontmatter `name: email-triage\ndescription: Triage inbox.\nallowedTools:\n  - bash\n` and an edit is confirmed
- **THEN** the resulting SKILL.md SHALL open with the exact same frontmatter block (whitespace, key order, quoting preserved by `serializeSkillMd`)
- **AND** the body between the frontmatter delimiter and EOF SHALL be the new `newBody`

### Requirement: Fork and edit reuse T2.2 `skill_install_confirm` interaction with an `action` discriminator

`SkillInstallConfirmInteractionContext` SHALL carry an `action: 'install' | 'fork' | 'edit'` discriminator. When the field is absent on a legacy request, consumers SHALL treat it as `'install'` (backwards compat with T2.2 payloads). When `action === 'fork'`, the context SHALL additionally carry `parent: { skillId: string; slug: string; name: string; version: string }`. When `action === 'edit'`, the context SHALL additionally carry `bodyDiff: { oldPreview: string; newPreview: string }` (each ≤ 160 UTF-16 code units with `…` appended when truncated). No new `InteractionKind` SHALL be introduced. The chat UI component `SkillInstallConfirmBubble` SHALL branch its preview layout on `context.action`: install shows staged asset list + allowedTools warnings as today; fork shows the parent header line + target employee name and omits body preview; edit shows the old/new body previews side-by-side and omits asset listing.

#### Scenario: Install action is the default when omitted

- **WHEN** a legacy T2.2 `skill_install_confirm` request arrives without `context.action`
- **THEN** the committer and the UI SHALL treat it as `action='install'` and commit via the existing install path

#### Scenario: Fork action carries parent metadata

- **WHEN** `context.action === 'fork'`
- **THEN** `context.parent` SHALL be a populated object with `skillId`, `slug`, `name`, `version` strings
- **AND** the UI bubble SHALL render a header `Fork "⟨parent.name⟩@⟨parent.version⟩" → ⟨resolvedEmployeeName⟩` and MUST NOT show a body preview expander

#### Scenario: Edit action carries body diff previews

- **WHEN** `context.action === 'edit'`
- **THEN** `context.bodyDiff` SHALL be a populated object with `oldPreview` and `newPreview` strings, each ≤ 160 UTF-16 code units (with trailing `…` when the original exceeded 160)
- **AND** the UI bubble SHALL render both previews side-by-side and MUST NOT show asset listings

### Requirement: Fork and edit commit through the `skill_install_confirm` handler branching on action

The `SkillInstallCommitter.handle(request, response)` method SHALL branch on `request.context.action`. For `action === 'install'` (or omitted), it SHALL call `SkillLoader.installSkill(...)` as today. For `action === 'fork'`, it SHALL call `SkillLoader.installSkill({ scope: 'employee', source: { kind: 'fork', parentSkillId, parentVersion }, ... })`. For `action === 'edit'`, it SHALL call `SkillLoader.editSkillBody({ skillId, newBody })`. On `selectedOptionId === 'cancel'` or staging timeout, the committer SHALL release staging for all three actions the same way (free tmp dirs, no DB mutation). Errors from either loader path SHALL be surfaced via the existing `error.occurred` event bus with `errorKind` set to the thrown `SkillInstallError.kind` or `SkillEditError.kind` — the outcome returned to the interaction service SHALL be `{ kind: 'installed' | 'edited' | 'cancelled' | 'staging-expired' | 'error' }`.

#### Scenario: Fork confirm writes employee-scope row

- **WHEN** a confirm response arrives for a fork staging and the committer invokes `installSkill({ scope: 'employee', source: { kind: 'fork', ... } })`
- **THEN** the loader SHALL write the employee-scope vault path and insert the row with `source_kind='forked'`, `source_ref='company-skill:<parentId>@<parentVersion>'`
- **AND** the outcome returned to the interaction service SHALL be `{ kind: 'installed', skillId, wasExisting }`

#### Scenario: Edit confirm writes via editSkillBody

- **WHEN** a confirm response arrives for an edit staging
- **THEN** the committer SHALL call `SkillLoader.editSkillBody({ skillId, newBody })`
- **AND** the outcome returned SHALL be `{ kind: 'edited', skillId }`

#### Scenario: Cancel on any action releases staging

- **WHEN** a cancel response arrives for action install, fork, or edit
- **THEN** the committer SHALL call `staging.release(stagingRef)` and return `{ kind: 'cancelled' }`
- **AND** no vault IO SHALL occur

#### Scenario: Staging expiration for fork/edit

- **WHEN** a confirm response arrives after staging has expired (5-second TTL)
- **THEN** `staging.take(stagingRef)` SHALL return null
- **AND** the committer SHALL return `{ kind: 'staging-expired' }` regardless of action
