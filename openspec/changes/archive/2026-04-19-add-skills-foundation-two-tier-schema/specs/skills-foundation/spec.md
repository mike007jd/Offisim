## ADDED Requirements

### Requirement: SKILL.md open-standard format is the persistent skill unit

Every skill — regardless of scope — SHALL be persisted on disk as a directory containing a single `SKILL.md` file at its root, optionally accompanied by sibling `scripts/`, `references/`, and `assets/` subdirectories. `SKILL.md` MUST carry YAML frontmatter with `name` (kebab-case string) and `description` (one- or two-sentence string) as mandatory fields; `allowedTools` (string array), `license` (string), and `version` (string) are the only permitted optional frontmatter fields. Frontmatter MUST NOT contain Offisim-private namespaces (no `offisim.*` keys). The skill body following frontmatter SHALL be free-form Markdown.

#### Scenario: Valid SKILL.md parses to a skill object

- **WHEN** `parseSkillMd(raw)` is called with a well-formed file that contains frontmatter `name: do-research\ndescription: Research patterns for deep-dive tasks.` followed by markdown body
- **THEN** the parser SHALL return `{ name: 'do-research', description: 'Research patterns for deep-dive tasks.', body: '<markdown>' }`
- **AND** the returned object SHALL retain byte-identical `body` (no trimming, normalization, or reformatting)

#### Scenario: Missing mandatory frontmatter is rejected

- **WHEN** `parseSkillMd(raw)` receives frontmatter lacking either `name` or `description`
- **THEN** it SHALL throw `SkillMdParseError` with `kind: 'missing-required-field'` naming the missing field
- **AND** it MUST NOT fall back to deriving the field from filename or body content

#### Scenario: Unknown frontmatter keys are preserved but ignored by Offisim consumers

- **WHEN** frontmatter carries an unknown field (e.g. `author: alice`)
- **THEN** `parseSkillMd` SHALL keep the raw string in `unknownFields` record without raising
- **AND** Offisim persistence / indexing code paths SHALL NOT read from `unknownFields`

#### Scenario: Private namespace extension is rejected

- **WHEN** frontmatter contains any key beginning with `offisim.` (e.g. `offisim.capabilityIndex`)
- **THEN** `parseSkillMd` SHALL throw `SkillMdParseError` with `kind: 'private-namespace-forbidden'`
- **AND** serialization (`serializeSkillMd`) MUST NOT emit any key starting with `offisim.`

### Requirement: Skill persistence uses a two-tier vault layout on disk

Skills SHALL be persisted under the per-company vault tree, with two tiers determined by scope. **Company (global) skills** SHALL live at `{vaultRoot}/companies/{companyId}/skills/{skillSlug}/SKILL.md`. **Employee-specific skills** SHALL live at `{vaultRoot}/companies/{companyId}/employees/{employeeSlug}/skills/{skillSlug}/SKILL.md`. `skillSlug` SHALL be produced by the same filesystem-safe kebab-case algorithm used for `employeeSlug(name, id)`, with the pure-non-ASCII fallback producing `skill-{id前8字符}`. Optional `scripts/`, `references/`, and `assets/` subdirectories MAY accompany `SKILL.md` at either tier.

#### Scenario: Global skill path resolution

- **WHEN** `resolveSkillPath({ companyId: 'abc', scope: 'company', skillSlug: 'do-research' })` is called on desktop
- **THEN** it SHALL return `{vaultRoot}/companies/abc/skills/do-research/SKILL.md`

#### Scenario: Employee-specific skill path resolution

- **WHEN** `resolveSkillPath({ companyId: 'abc', scope: 'employee', employeeSlug: 'alice-xyz', skillSlug: 'email-triage' })` is called
- **THEN** it SHALL return `{vaultRoot}/companies/abc/employees/alice-xyz/skills/email-triage/SKILL.md`

#### Scenario: Slug fallback for unsupported characters

- **WHEN** a skill name is `"📧"` or otherwise produces an empty slug via the kebab-case algorithm
- **THEN** the slug SHALL be `skill-{first-8-chars-of-skill-id}`
- **AND** this fallback SHALL match the employee slug strategy byte-for-byte

#### Scenario: Web vault mirrors the same layout via IndexedDB keys

- **WHEN** the runtime is the web SPA (no real filesystem)
- **THEN** `VaultSyncService` SHALL key skill contents at `vault:{companyId}:skills:{skillSlug}:SKILL.md` (company scope) and `vault:{companyId}:employees:{employeeSlug}:skills:{skillSlug}:SKILL.md` (employee scope)
- **AND** the key scheme SHALL be stable so that `rehydrateSkillsFromVault` can scan by prefix

### Requirement: `skills` table indexes vault skills by scope and employee

A new DB table `skills` SHALL act as the query index for all vault-persisted skills. The table SHALL have columns: `skill_id TEXT PRIMARY KEY`, `company_id TEXT NOT NULL`, `employee_id TEXT NULL`, `scope TEXT NOT NULL CHECK (scope IN ('company','employee'))`, `slug TEXT NOT NULL`, `name TEXT NOT NULL`, `description TEXT NOT NULL`, `version TEXT NOT NULL DEFAULT '0.1.0'`, `source_kind TEXT NOT NULL CHECK (source_kind IN ('authored','installed','forked','synthesized'))`, `source_ref TEXT NULL`, `vault_path TEXT NOT NULL`, `created_at INTEGER NOT NULL`, `updated_at INTEGER NOT NULL`. A UNIQUE constraint SHALL enforce one skill per `(company_id, employee_id, slug)` triple (treating `employee_id IS NULL` as the company-scope bucket). `scope === 'employee'` rows MUST have non-null `employee_id`; `scope === 'company'` rows MUST have null `employee_id`. The migration SHALL exist at `db-local/migrations/025-skills-table.sql` and SHALL be mirrored in the desktop Tauri SQL plugin at embedded version 31; platform DB SHALL NOT receive this migration.

#### Scenario: Company-scope row insertion

- **WHEN** `skillRepo.insert({ scope: 'company', companyId: 'c1', employeeId: null, slug: 'onboarding-tour', ... })` is called
- **THEN** the row SHALL persist with `scope='company'` and `employee_id=NULL`
- **AND** a second insert with the same `(c1, null, 'onboarding-tour')` SHALL fail the UNIQUE constraint

#### Scenario: Employee-scope row insertion

- **WHEN** `skillRepo.insert({ scope: 'employee', companyId: 'c1', employeeId: 'e7', slug: 'email-triage', ... })` is called
- **THEN** the row SHALL persist with `scope='employee'` and `employee_id='e7'`
- **AND** a second insert with the same `(c1, e7, 'email-triage')` SHALL fail the UNIQUE constraint
- **AND** an insert with the same slug but a different `employee_id` SHALL succeed

#### Scenario: Scope / employee_id consistency

- **WHEN** any insert or update would produce `scope='company' AND employee_id IS NOT NULL` or `scope='employee' AND employee_id IS NULL`
- **THEN** the write SHALL fail a runtime precondition check in `skillRepo` before reaching SQLite

### Requirement: SkillLoader implements progressive disclosure in three tiers

The `SkillLoader` service SHALL expose three disclosure tiers. **Tier 1 (listing)**: `listSkillsForEmployee(companyId, employeeId)` returns a synchronous array of `SkillMetadata` (`{ id, slug, name, description, scope, version }`) drawn from the DB index with no filesystem reads. **Tier 2 (activation)**: `loadSkillBody(skillId)` returns a `Promise<string>` containing the SKILL.md body (frontmatter stripped). **Tier 3 (on-demand)**: `loadSkillAsset(skillId, relPath)` returns `Promise<Buffer | string>` for a path under the skill directory limited to the `scripts/`, `references/`, or `assets/` subtrees. Tier 1 MUST NOT do any disk IO. Tier 3 MUST reject any `relPath` that escapes the skill directory (no `..`, no absolute paths).

#### Scenario: Tier 1 listing is synchronous and filesystem-free

- **WHEN** `listSkillsForEmployee('c1', 'e7')` is called in a code path instrumented with a filesystem spy
- **THEN** the filesystem spy SHALL record zero reads
- **AND** the returned array SHALL include every `skills` row with either (`company_id='c1', employee_id=NULL`) or (`company_id='c1', employee_id='e7'`)
- **AND** the return type SHALL be a plain array (not a Promise)

#### Scenario: Tier 2 body load reads SKILL.md and strips frontmatter

- **WHEN** `loadSkillBody(skillId)` is called for a row whose `vault_path` points to a valid SKILL.md
- **THEN** the returned string SHALL be the markdown body only (frontmatter block `---...---` removed)
- **AND** any leading blank line after frontmatter stripping SHALL be preserved byte-for-byte

#### Scenario: Tier 3 asset path containment

- **WHEN** `loadSkillAsset(skillId, '../../../etc/passwd')` is called
- **THEN** it SHALL reject with `SkillAssetError` `kind: 'path-traversal'`
- **AND** no filesystem read SHALL occur
- **WHEN** `loadSkillAsset(skillId, '/absolute/path')` is called
- **THEN** it SHALL reject with `SkillAssetError` `kind: 'absolute-path-forbidden'`

#### Scenario: Tier 3 subtree whitelist enforcement

- **WHEN** `loadSkillAsset(skillId, 'randomfile.txt')` is called (not under `scripts/`, `references/`, or `assets/`)
- **THEN** it SHALL reject with `SkillAssetError` `kind: 'subtree-forbidden'`

### Requirement: Employee skill visibility merges scopes with employee override

When computing the list of skills an employee can see, `listSkillsForEmployee(companyId, employeeId)` SHALL union company-scope and employee-scope rows, de-duplicating by `slug`. On duplicate slug, the employee-scope row SHALL win (company-scope is hidden). A skill not yet assigned to the employee (in any scope) SHALL NOT appear. Internal employees and external employees (where `is_external === 1`) SHALL follow the same merge rule; external employees see only their own scope and company scope, never another external employee's scope.

#### Scenario: No conflict merge

- **WHEN** the DB holds one company-scope skill `{slug:'onboarding'}` and one employee-scope skill `{slug:'email-triage', employeeId:'e7'}`
- **THEN** `listSkillsForEmployee('c1','e7')` SHALL return both, in any order

#### Scenario: Slug conflict: employee overrides company

- **WHEN** the DB holds company-scope `{slug:'email-triage', description:'global version'}` and employee-scope `{slug:'email-triage', description:'personal version', employeeId:'e7'}`
- **THEN** `listSkillsForEmployee('c1','e7')` SHALL return exactly one row for `email-triage`
- **AND** that row SHALL be the employee-scope one (with `description: 'personal version'`)

#### Scenario: Cross-employee isolation

- **WHEN** employee `e7` has an employee-scope skill `{slug:'email-triage'}` and employee `e8` queries their skills
- **THEN** `listSkillsForEmployee('c1','e8')` SHALL NOT include `e7`'s skill

### Requirement: Employee prompt assembly injects a progressive-disclosure skill list

`employee-prompt-assembly.ts` SHALL consume `listSkillsForEmployee` output and inject an "Available skills" block into the employee system prompt only when the merged list is non-empty. The block format SHALL be a Markdown heading followed by a bullet list of `- **{name}** — {description}` entries, each `description` truncated at 200 UTF-16 code units with an ellipsis if longer. The prompt MUST NOT include skill bodies, scripts, or assets (progressive disclosure tier 1 only). No `activate_skill` tool SHALL be registered in this change; the list is informational only.

#### Scenario: Non-empty list injection

- **WHEN** the employee has two visible skills `{name:'email-triage',description:'Process inbox.'}` and `{name:'weekly-report',description:'Draft Monday weekly update.'}`
- **THEN** the system prompt SHALL contain a section starting with `## Available skills` followed by two bullets listing each skill's name and description
- **AND** no `activate_skill` tool definition SHALL appear in the tools schema for this round

#### Scenario: Empty list omits the section

- **WHEN** the employee has zero visible skills
- **THEN** the system prompt SHALL NOT contain any `## Available skills` section

#### Scenario: Description truncation

- **WHEN** a skill has a 500-character description
- **THEN** the injected line SHALL truncate at 200 code units and append `…`
- **AND** no skill body SHALL leak into the prompt

### Requirement: Marketplace recognises `'skill'` as a first-class installable kind

`INSTALLABLE_KINDS` in `marketplace-meta.tsx` SHALL be extended from `['employee']` to `['employee','skill']`, and `KIND_FILTERS` SHALL gain a `'skill'` entry so users can filter Market Explore by skill listings. `PublishDialog` SHALL render a kind selector when the user has publishable items of multiple kinds; when the user picks `'skill'`, the dialog SHALL drive an employee → skill selection flow that packages the selected employee-scope skill's SKILL.md (body + metadata) into the listing payload. Installing a listing with `kind === 'skill'` SHALL create a new row in `skills` with `scope: 'company'`, `source_kind: 'installed'`, `source_ref: <listingId>`, and SHALL write the SKILL.md to the company-scope vault path.

#### Scenario: Publish flow for employee-scope skill

- **WHEN** the user opens Publish Dialog, selects kind `'skill'`, then picks employee `e7` and their skill `email-triage`
- **THEN** the registry payload SHALL contain `kind: 'skill'`, `content.md: <serializeSkillMd(row, body)>`, and manifest metadata (`name`, `description`, `version`)
- **AND** no employee-specific identifiers (`employeeId`, employee `name`) SHALL be embedded in the published manifest

#### Scenario: Install adds a company-scope skill

- **WHEN** the user clicks Install on a listing with `kind='skill'`, `name='email-triage'` in a company where no skill with that slug already exists
- **THEN** a new `skills` row SHALL be inserted with `scope='company'`, `employee_id=NULL`, `source_kind='installed'`, `source_ref=<listingId>`
- **AND** the SKILL.md file SHALL be written under `{vaultRoot}/companies/{companyId}/skills/email-triage/SKILL.md`

#### Scenario: Install respects company-scope slug uniqueness

- **WHEN** the user installs a skill listing whose resulting slug already exists as a company-scope row in the target company
- **THEN** the install SHALL surface an error (not silently overwrite) and the existing row SHALL remain unchanged
- **AND** the UI SHALL offer a disambiguation affordance (e.g. rename) — exact UX deferred to later change; this spec requires only the refusal-to-overwrite behaviour

#### Scenario: Install is idempotent on duplicate listingId

- **WHEN** the user re-installs the same `listingId` that was already installed into the same company
- **THEN** the operation SHALL no-op (return the existing `skills` row) instead of creating a duplicate

### Requirement: Legacy `runtimeSkill` field is migrated and removed at bootstrap

On first runtime initialisation after this change, `migrateRuntimeSkills(repos)` SHALL scan every `employees.config_json.runtimeSkill` and, for each non-null `runtimeSkill`, produce an employee-scope `skills` row plus its SKILL.md file (with `source_kind: 'synthesized'`, `source_ref: 'legacy:runtimeSkill'`). After a successful per-employee migration, the `runtimeSkill` key SHALL be stripped from that employee's `config_json`. A settings marker row `skills_migration_v1_done=true` SHALL be written after the first full pass; subsequent runs SHALL skip the migration when the marker is present. `RuntimeSkillConfig`, `RuntimeSkillCapability`, and `EmployeeConfig.runtimeSkill` SHALL be removed from `packages/shared-types/src/json-field-parsers.ts`; consumers SHALL switch to `SkillLoader.listSkillsForEmployee(...)`. No backwards-compatibility runtime branch SHALL be kept.

#### Scenario: Migration maps fields correctly

- **WHEN** an employee has `config_json.runtimeSkill = { skillName: 'Email Triage', summary: 'Process inbox.', instructions: '...body...', capabilityIndex: { summary: 'Tagging and routing', capabilities: [{ label: 'categorize' }, { label: 'prioritize' }] }, allowedTools: ['bash'] }`
- **THEN** a new `skills` row SHALL be inserted with `scope='employee'`, `slug='email-triage'`, `name='email-triage'`, `description='Process inbox.'`, `source_kind='synthesized'`, `source_ref='legacy:runtimeSkill'`
- **AND** the corresponding SKILL.md SHALL carry frontmatter `name: email-triage`, `description: Process inbox.`, `allowedTools: [bash]`
- **AND** the body SHALL contain `...body...` followed by a `## Capabilities` section enumerating `categorize` and `prioritize`
- **AND** the employee's `config_json.runtimeSkill` SHALL be removed

#### Scenario: Migration marker prevents re-execution

- **WHEN** `skills_migration_v1_done=true` is already present in settings
- **THEN** `migrateRuntimeSkills` SHALL exit early without touching any employee

#### Scenario: Malformed legacy record is dropped without aborting migration

- **WHEN** an employee's `runtimeSkill` is missing both `skillName` and `summary`
- **THEN** the migration SHALL log a warning and skip that employee (no skill row, no SKILL.md)
- **AND** subsequent employees in the same pass SHALL still be processed
- **AND** the marker SHALL still be written at the end of the pass

#### Scenario: `RuntimeSkillConfig` is no longer in shared-types

- **WHEN** any consumer imports from `@offisim/shared-types`
- **THEN** the exported symbols SHALL NOT include `RuntimeSkillConfig`, `RuntimeSkillCapability`, or an `EmployeeConfig.runtimeSkill` field
- **AND** a type-check over the workspace SHALL surface errors on any lingering reference (these MUST be fixed in this change, not left dangling)
