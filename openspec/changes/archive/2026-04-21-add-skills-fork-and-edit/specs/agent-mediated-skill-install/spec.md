## MODIFIED Requirements

### Requirement: New `skill_install_confirm` interaction kind is typed and round-trips

`InteractionKind` in `@offisim/shared-types` SHALL include `'skill_install_confirm'`. A new `SkillInstallConfirmInteractionContext` SHALL be added to the `InteractionContext` union with fields: `type: 'skill_install_confirm'`, `stagingRef: string` (opaque handle resolving server-side to the staged skill payload), `skillName: string`, `skillDescription: string`, `allowedTools: readonly string[]`, `sourceKind: 'git' | 'upload' | 'claude-code' | 'codex' | 'fork'`, `sourceRef: string`, `resolvedScope: 'company' | 'employee'`, `resolvedEmployeeId: string | null`, `resolvedEmployeeName: string | null`, `assetPaths: readonly string[]`, `skillMdBody: string`, `action: 'install' | 'fork' | 'edit'` (optional — defaults to `'install'` when omitted, for backwards compatibility with T2.2 callers), `parent?: { skillId: string; slug: string; name: string; version: string }` (required iff `action === 'fork'`, omitted otherwise), `bodyDiff?: { oldPreview: string; newPreview: string }` (required iff `action === 'edit'`, omitted otherwise; each preview string SHALL be ≤ 160 UTF-16 code units, with trailing `…` appended when the original body exceeded 160). `InteractionRequest.options` for this kind SHALL carry at minimum `{ id: 'confirm', label: 'Install' | 'Fork' | 'Save' }` (label picked per action) and `{ id: 'cancel', label: 'Cancel' }`. No existing `InteractionKind` member SHALL be renamed or removed. Chat UI routing MUST dispatch `skill_install_confirm` to `SkillInstallConfirmBubble`; unknown kinds already fall through to a generic bubble, and this change SHALL NOT alter that fallback. `SkillInstallConfirmBubble` SHALL branch its rendered preview on `context.action`.

#### Scenario: Type surface

- **WHEN** any downstream package imports `InteractionKind` from `@offisim/shared-types`
- **THEN** the union SHALL include `'skill_install_confirm'` alongside `'permission_request'`, `'plan_review'`, `'agent_question'`

#### Scenario: Context discrimination

- **WHEN** an `InteractionRequest` has `kind: 'skill_install_confirm'` and `context.type === 'skill_install_confirm'`
- **THEN** TypeScript narrowing SHALL surface the `stagingRef`, `allowedTools`, `sourceKind`, `resolvedScope`, `resolvedEmployeeId`, `assetPaths`, `action`, `parent`, and `bodyDiff` fields

#### Scenario: Options default pair

- **WHEN** the tool handler constructs the interaction request for `action === 'install'`
- **THEN** `options` SHALL contain at minimum `[{ id: 'confirm', label: 'Install' }, { id: 'cancel', label: 'Cancel' }]` in that order

#### Scenario: Fork and edit options use action-specific labels

- **WHEN** the handler constructs an interaction with `action === 'fork'`
- **THEN** `options` SHALL be `[{ id: 'confirm', label: 'Fork' }, { id: 'cancel', label: 'Cancel' }]`
- **WHEN** the handler constructs an interaction with `action === 'edit'`
- **THEN** `options` SHALL be `[{ id: 'confirm', label: 'Save' }, { id: 'cancel', label: 'Cancel' }]`

#### Scenario: Legacy T2.2 install requests omit action

- **WHEN** a `skill_install_confirm` request originates from the four T2.2 tools (`install_skill_from_git`, `install_skill_from_upload`, `sync_from_claude_code`, `sync_from_codex`)
- **THEN** the `context.action` field MAY be omitted on the wire
- **AND** the UI and committer SHALL treat an omitted `action` as `'install'`

#### Scenario: Fork request carries parent metadata

- **WHEN** `action === 'fork'`
- **THEN** `context.parent` SHALL be present with `skillId`, `slug`, `name`, `version` populated from the parent row at the time of staging
- **AND** `context.bodyDiff` MUST be absent

#### Scenario: Edit request carries body diff previews

- **WHEN** `action === 'edit'`
- **THEN** `context.bodyDiff` SHALL be present with `oldPreview` and `newPreview` each ≤ 160 UTF-16 code units
- **AND** `context.parent` MUST be absent

### Requirement: Unified `SkillLoader.installSkill` is the sole mutation entry point

`SkillLoader.installSkill({ scope, companyId, employeeId?, source, files })` SHALL be the only function that writes NEW skill data to the vault and inserts into the `skills` table. It SHALL accept `scope: 'company' | 'employee'`, `companyId: string`, `employeeId?: string` (required when scope is `'employee'`, forbidden when scope is `'company'`), `source: { kind: 'git' | 'upload' | 'claude-code' | 'codex' | 'marketplace' | 'fork'; ... }`, and `files: { skillMd: string; assets?: Array<{ relPath: string; content: Uint8Array | string }> }`. It SHALL enforce: (a) the tier-3 path-traversal and subtree whitelist rules from `skills-foundation` on every `assets[].relPath` BEFORE any IO; (b) slug uniqueness per scope using the existing partial UNIQUE indexes; (c) write-through order of vault bytes before DB row (SKILL.md → asset files → `skills` insert) so partial failures leave no phantom rows. `installCompanyScopeSkill(...)` SHALL remain as a thin wrapper that calls `installSkill({ scope: 'company', source: { kind: 'marketplace', listingId }, ... })` — its public signature and semantics SHALL NOT change. Skill body MUTATIONS of existing rows SHALL NOT go through `installSkill`; they SHALL go through `SkillLoader.editSkillBody` defined in `skills-foundation`.

#### Scenario: Employee scope writes to employee vault path

- **WHEN** `installSkill({ scope: 'employee', companyId: 'c1', employeeId: 'e7', source: { kind: 'git', ref: 'https://github.com/foo/bar@main' }, files: { skillMd: '...', assets: [{ relPath: 'scripts/go.sh', content: '...' }] } })` succeeds
- **THEN** SKILL.md SHALL be written to `companies/c1/employees/<alice-slug>/skills/<skill-slug>/SKILL.md`
- **AND** `scripts/go.sh` SHALL be written under the same skill directory
- **AND** a `skills` row SHALL be inserted with `scope='employee'`, `employee_id='e7'`, `source_kind='installed'`, `source_ref='<source descriptor>'`

#### Scenario: Fork source routes to employee vault path

- **WHEN** `installSkill({ scope: 'employee', companyId: 'c1', employeeId: 'e7', source: { kind: 'fork', parentSkillId: 'sk_p', parentVersion: '0.3.2' }, files: { skillMd: '<parent body>', assets: [...parent assets...] } })` succeeds
- **THEN** the SKILL.md SHALL be written under the employee vault path
- **AND** the row SHALL carry `source_kind='forked'` and `source_ref='company-skill:sk_p@0.3.2'`

#### Scenario: Path traversal is rejected before any IO

- **WHEN** `files.assets = [{ relPath: 'scripts/../../../etc/passwd', ... }]` is passed
- **THEN** `installSkill` SHALL throw with an error kind `path-traversal` matching `skills-foundation` tier-3 contract
- **AND** no file SHALL be written and no `skills` row SHALL be inserted

#### Scenario: Absolute asset path is rejected

- **WHEN** `files.assets = [{ relPath: '/absolute/payload', ... }]` is passed
- **THEN** `installSkill` SHALL throw with error kind `absolute-path-forbidden`

#### Scenario: Subtree whitelist is enforced for assets

- **WHEN** `files.assets = [{ relPath: 'arbitrary/file.txt', ... }]` (not under `scripts/` / `references/` / `assets/`)
- **THEN** `installSkill` SHALL throw with error kind `subtree-forbidden`

#### Scenario: Slug collision respects scope

- **WHEN** a company-scope row with slug `do-research` already exists from Marketplace (`source_kind='installed'`) and the user attempts to agent-install another skill resolving to the same slug from git
- **THEN** `installSkill` SHALL throw a collision error preserving the existing row
- **WHEN** the same slug exists as company scope but the user agent-installs with `scope: 'employee'`
- **THEN** the employee-scope row SHALL be written (per `skills-foundation` partial UNIQUE rule), and at prompt assembly the employee row SHALL override the company row

#### Scenario: Write-through order prevents phantom DB rows

- **WHEN** an IO failure occurs while writing `scripts/go.sh` after `SKILL.md` has been written
- **THEN** `installSkill` SHALL reject with the underlying IO error
- **AND** no `skills` row SHALL exist for that attempted install
- **AND** the partially-written directory SHALL be cleaned up before the error is re-thrown

## ADDED Requirements

### Requirement: Committer branches on context action across install, fork, and edit

`SkillInstallCommitter.handle(request, response)` SHALL inspect `request.context.action` (defaulting to `'install'` when absent) and dispatch: for `'install'` and `'fork'` it SHALL read the staged tree from `SkillStagingManager.take(stagingRef)` and call `SkillLoader.installSkill(...)`, passing the `source` recorded at staging time (which already discriminates install vs fork). For `'edit'` it SHALL call `SkillLoader.editSkillBody({ skillId, newBody })` from the staging entry's edit fields. On `selectedOptionId !== 'confirm'` the committer SHALL call `staging.release(stagingRef)` and return `{ kind: 'cancelled' }`. On missing staging (expired TTL) it SHALL return `{ kind: 'staging-expired' }`. On loader throw, it SHALL emit `errorOccurred` on the event bus with the thrown error's kind + message, and return `{ kind: 'error', errorKind, message }`. Successful install/fork SHALL return `{ kind: 'installed', skillId, wasExisting }`; successful edit SHALL return `{ kind: 'edited', skillId }`.

#### Scenario: Install commits via installSkill

- **WHEN** the committer handles a confirm response for a staged install (action absent or `'install'`)
- **THEN** it SHALL call `SkillLoader.installSkill(...)` and return `{ kind: 'installed', skillId, wasExisting }`

#### Scenario: Fork commits via installSkill with fork source

- **WHEN** the committer handles a confirm response for a staging whose `action === 'fork'`
- **THEN** it SHALL call `SkillLoader.installSkill(...)` with the staged `source: { kind: 'fork', parentSkillId, parentVersion }` and return `{ kind: 'installed', skillId, wasExisting }`

#### Scenario: Edit commits via editSkillBody

- **WHEN** the committer handles a confirm response for a staging whose `action === 'edit'`
- **THEN** it SHALL call `SkillLoader.editSkillBody({ skillId, newBody })` with the staged fields and return `{ kind: 'edited', skillId }`

#### Scenario: Cancel releases staging regardless of action

- **WHEN** the committer handles a cancel response for any of install / fork / edit
- **THEN** it SHALL call `staging.release(stagingRef)` and return `{ kind: 'cancelled' }`

#### Scenario: Expired staging surfaces uniformly

- **WHEN** the committer handles a confirm response after the 5-second staging TTL elapsed
- **THEN** `staging.take(stagingRef)` SHALL return null and the committer SHALL return `{ kind: 'staging-expired' }` — same outcome for install / fork / edit actions
