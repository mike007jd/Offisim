# skills-foundation Specification

## Purpose

Establish skills as first-class Offisim entities built on the Anthropic SKILL.md open standard. Covers the on-disk SKILL.md format contract (frontmatter whitelist, `offisim.*` namespace ban, body byte-preservation), the two-tier vault layout (company-global + employee-specific), the `skills` DB index table, the `SkillLoader` three-tier progressive-disclosure API (listing / body / asset), the employee prompt injection block, the Marketplace `kind: 'skill'` publish/install lifecycle, and the one-shot legacy `runtimeSkill` bootstrap migration. Does NOT cover fork / self-create / peer-transfer / self-improve / UI surfacing — those remain T2.2–T2.7 future scope.
## Requirements
### Requirement: SKILL.md open-standard format is the persistent skill unit

Every skill — regardless of scope — SHALL be persisted on disk as a directory containing a single `SKILL.md` file at its root, optionally accompanied by sibling `scripts/`, `references/`, and `assets/` subdirectories. `SKILL.md` MUST carry YAML frontmatter with `name` (kebab-case string) and `description` (one- or two-sentence string) as mandatory fields; `allowedTools` (string array), `license` (string), and `version` (string) are the only permitted optional frontmatter fields. Frontmatter MUST NOT contain Offisim-private namespaces (no `offisim.*` keys). Fork provenance SHALL be stored in the `skills` DB row only (`source_kind='forked'` + `source_ref='company-skill:<parentSkillId>@<parentVersion>'`); the SKILL.md frontmatter MUST NOT carry parent pointers, so exported or shared SKILL.md files remain compatible with the Anthropic open standard. The skill body following frontmatter SHALL be free-form Markdown.

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
- **THEN** `parseSkillMd` SHALL keep the raw value in the `unknownFields` record without raising
- **AND** Offisim persistence / indexing code paths SHALL NOT read from `unknownFields`

#### Scenario: Private namespace extension is rejected

- **WHEN** frontmatter contains any key beginning with `offisim.` (e.g. `offisim.capabilityIndex` or `offisim.parent_slug`)
- **THEN** `parseSkillMd` SHALL throw `SkillMdParseError` with `kind: 'private-namespace-forbidden'`
- **AND** serialization (`serializeSkillMd`) MUST NOT emit any key starting with `offisim.`

#### Scenario: Forked skills omit parent pointers from SKILL.md

- **WHEN** a fork is written via `installSkill({ source: { kind: 'fork', parentSkillId, parentVersion } })`
- **THEN** the written SKILL.md frontmatter SHALL be byte-identical to the parent's frontmatter (`parseSkillMd` on both yields equal frontmatter objects)
- **AND** the `skills` row SHALL carry `source_kind='forked'` and `source_ref='company-skill:<parentSkillId>@<parentVersion>'` as the sole provenance record

### Requirement: Skill persistence uses a two-tier vault layout on disk

Skills SHALL be persisted under the per-company vault tree, with two tiers determined by scope. **Company (global) skills** SHALL live at `companies/{companyId}/skills/{skillSlug}/SKILL.md` (relative to vault root). **Employee-specific skills** SHALL live at `companies/{companyId}/employees/{employeeSlug}/skills/{skillSlug}/SKILL.md`. `skillSlug` SHALL be produced by a filesystem-safe kebab-case algorithm mirroring `employeeSlug(name, id)` byte-for-byte, with the pure-non-ASCII fallback producing `skill-{id前8字符}`. Optional `scripts/`, `references/`, and `assets/` subdirectories MAY accompany `SKILL.md` at either tier. Both desktop (Tauri plugin-fs) and web (OPFS / FSAccess) runtimes SHALL key on the same relative path — the `VaultFileSystem` abstraction handles storage branching, so no separate IndexedDB key prefix is used.

#### Scenario: Global skill path resolution

- **WHEN** `resolveSkillPath({ companyId: 'abc', scope: 'company', skillSlug: 'do-research' })` is called
- **THEN** it SHALL return `{ skillMdPath: 'companies/abc/skills/do-research/SKILL.md', dir: 'companies/abc/skills/do-research', ... }`

#### Scenario: Employee-specific skill path resolution

- **WHEN** `resolveSkillPath({ companyId: 'abc', scope: 'employee', employeeSlug: 'alice-xyz', skillSlug: 'email-triage' })` is called
- **THEN** it SHALL return `{ skillMdPath: 'companies/abc/employees/alice-xyz/skills/email-triage/SKILL.md', ... }`

#### Scenario: Slug fallback for unsupported characters

- **WHEN** a skill name is `"📧"` or otherwise produces an empty slug via the kebab-case algorithm
- **THEN** the slug SHALL be `skill-{first-8-chars-of-skill-id}`
- **AND** this fallback SHALL match the employee slug strategy byte-for-byte

### Requirement: `skills` table indexes vault skills by scope and employee

A new DB table `skills` SHALL act as the query index for all vault-persisted skills. The table SHALL have columns: `skill_id TEXT PRIMARY KEY`, `company_id TEXT NOT NULL`, `employee_id TEXT NULL`, `scope TEXT NOT NULL CHECK (scope IN ('company','employee'))`, `slug TEXT NOT NULL`, `name TEXT NOT NULL`, `description TEXT NOT NULL`, `version TEXT NOT NULL DEFAULT '0.1.0'`, `source_kind TEXT NOT NULL CHECK (source_kind IN ('authored','installed','forked','synthesized'))`, `source_ref TEXT NULL`, `vault_path TEXT NOT NULL`, `created_at INTEGER NOT NULL`, `updated_at INTEGER NOT NULL`. Uniqueness SHALL be enforced via two partial UNIQUE indexes so that NULL `employee_id` collapses into a single company-scope bucket per slug: one on `(company_id, slug) WHERE employee_id IS NULL`, another on `(company_id, employee_id, slug) WHERE employee_id IS NOT NULL`. `scope === 'employee'` rows MUST have non-null `employee_id`; `scope === 'company'` rows MUST have null `employee_id` (asserted at the repo layer before reaching SQLite). The migration SHALL exist at `packages/db-local/src/migrations/025_skills_table.sql` and SHALL be mirrored in the desktop Tauri SQL plugin at embedded version 31; the platform DB SHALL NOT receive this migration. The same migration SHALL create a companion `settings` key-value table used by one-shot bootstrap markers.

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

The `SkillLoader` service SHALL expose three disclosure tiers. **Tier 1 (listing)**: `listSkillsForEmployee(companyId, employeeId): Promise<SkillMetadata[]>` returns the merged `{ id, slug, name, description, scope, version }` rows drawn from the DB index with zero filesystem IO. **Tier 2 (activation)**: `loadSkillBody(skillId): Promise<string>` returns the SKILL.md body (frontmatter stripped). **Tier 3 (on-demand)**: `loadSkillAsset(skillId, relPath): Promise<string>` returns a whitelisted sibling file under the skill directory. Tier 1 MUST NOT perform disk IO (the Promise resolves purely from DB rows). Tier 3 MUST reject any `relPath` that escapes the skill directory (no `..`, no absolute paths, no drive letters) and any path not prefixed with `scripts/`, `references/`, or `assets/` — all checks happen before any IO.

#### Scenario: Tier 1 listing is filesystem-free

- **WHEN** `listSkillsForEmployee('c1', 'e7')` is called in a code path instrumented with a filesystem spy
- **THEN** the filesystem spy SHALL record zero reads
- **AND** the returned array SHALL include every `skills` row with either (`company_id='c1', employee_id=NULL`) or (`company_id='c1', employee_id='e7'`) after slug-dedupe (employee wins)

#### Scenario: Tier 2 body load reads SKILL.md and strips frontmatter

- **WHEN** `loadSkillBody(skillId)` is called for a row whose `vault_path` points to a valid SKILL.md
- **THEN** the returned string SHALL be the markdown body only (frontmatter block `---...---` removed)
- **AND** any body content after the second `---` delimiter SHALL be preserved byte-for-byte

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

When computing the list of skills an employee can see, `listSkillsForEmployee(companyId, employeeId)` SHALL union company-scope and employee-scope rows, de-duplicating by `slug`. On duplicate slug, the employee-scope row SHALL win (company-scope is hidden). Internal employees and external employees (where `is_external === 1`) SHALL follow the same merge rule; one employee MUST NOT see another employee's scope.

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

`employee-prompt-assembly.ts` SHALL consume `listSkillsForEmployee` output (when a `SkillLoader` is present on `RuntimeContext`) and inject an "Available skills" block into the employee system prompt only when the merged list is non-empty. The block format SHALL be a `## Available skills` Markdown heading followed by a bullet list of `- **{name}** — {description}` entries, each `description` truncated at 200 UTF-16 code units with an ellipsis if longer. The prompt MUST NOT include skill bodies, scripts, or assets (progressive disclosure tier 1 only). No `activate_skill` tool SHALL be registered in this change; the list is informational only. Skill listing failures (e.g. DB transient error) MUST be caught silently — prompt assembly MUST NOT throw.

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

`INSTALLABLE_KINDS` in `marketplace-meta.tsx` SHALL include both `'employee'` and `'skill'`, and `KIND_FILTERS` SHALL expose a `'skill'` entry so users can filter Market Explore by skill listings. `PublishDialog` SHALL render a kind selector when the user has publishable items of multiple kinds; when the user picks `'skill'`, the dialog SHALL drive a skill picker (sourced from the merged company + employee-scope skill index) and package the selected SKILL.md content into `manifest.custom.skill_md_content` via `buildSkillPackage` + `serializeSkillMd`. Installing a listing with `kind === 'skill'` SHALL create a new row in `skills` with `scope: 'company'`, `source_kind: 'installed'`, `source_ref: <listingId>`, and SHALL write the SKILL.md to the company-scope vault path before the DB insert (so partial state is not left behind on IO failure). Install MUST be idempotent on `listingId` (re-install returns the existing row) and MUST refuse slug collision against a row from a different source.

#### Scenario: Publish flow packages the skill

- **WHEN** the user opens Publish Dialog, selects kind `'skill'`, then picks a skill
- **THEN** the registry payload SHALL carry `kind: 'skill'` and the SKILL.md content SHALL be present at `manifest.custom.skill_md_content`
- **AND** no employee-specific identifiers (`employeeId`, employee `name`) SHALL be embedded in the published manifest

#### Scenario: Install adds a company-scope skill

- **WHEN** the user clicks Install on a listing with `kind='skill'` in a company where no skill with that slug already exists
- **THEN** a new `skills` row SHALL be inserted with `scope='company'`, `employee_id=NULL`, `source_kind='installed'`, `source_ref=<listingId>`
- **AND** the SKILL.md file SHALL be written under `companies/{companyId}/skills/{slug}/SKILL.md`

#### Scenario: Install respects company-scope slug uniqueness

- **WHEN** the user installs a skill listing whose resulting slug already exists as a company-scope row with a *different* `source_ref` in the target company
- **THEN** the install SHALL throw (not silently overwrite) and the existing row SHALL remain unchanged

#### Scenario: Install is idempotent on duplicate listingId

- **WHEN** the user re-installs the same `listingId` that was already installed into the same company
- **THEN** `SkillLoader.installCompanyScopeSkill` SHALL return the existing row without writing a duplicate SKILL.md or inserting a second skills row

### Requirement: Legacy `runtimeSkill` field is migrated and removed at bootstrap

On first runtime initialisation that has a live vault, `migrateRuntimeSkills({ skills, settings, employees, companies, fs })` SHALL scan every `employees.config_json.runtimeSkill` across all companies and, for each non-null `runtimeSkill`, produce an employee-scope `skills` row plus its SKILL.md file (with `source_kind: 'synthesized'`, `source_ref: 'legacy:runtimeSkill'`). After a successful per-employee migration, the `runtimeSkill` key SHALL be stripped from that employee's `config_json`. A `settings.skills_migration_v1_done='true'` marker SHALL be written after the first full pass; subsequent runs SHALL exit early when the marker is present. `RuntimeSkillConfig`, `RuntimeSkillCapability`, and `EmployeeConfig.runtimeSkill` SHALL NOT be exported from `@offisim/shared-types`; no backwards-compatibility runtime branch SHALL be kept. Browser (FSAccess / OPFS) and Tauri runtimes SHALL both invoke the shared `onVaultReadyForSkills(loader, repos, fs)` handler on vault activation — wiring lives in `apps/web/src/lib/browser-runtime.ts` and `apps/web/src/lib/tauri-runtime.ts`.

#### Scenario: Migration maps fields correctly

- **WHEN** an employee has `config_json.runtimeSkill = { skillName: 'Email Triage', summary: 'Process inbox.', instructions: '...body...', capabilityIndex: { summary: 'Tagging and routing', capabilities: [{ label: 'categorize' }, { label: 'prioritize' }] }, allowedTools: ['bash'] }`
- **THEN** a new `skills` row SHALL be inserted with `scope='employee'`, `source_kind='synthesized'`, `source_ref='legacy:runtimeSkill'`, `slug` derived from the skill name via `skillSlug`, `description='Process inbox.'`
- **AND** the corresponding SKILL.md SHALL carry frontmatter `name: <slug>`, `description: Process inbox.`, `allowedTools: [bash]`
- **AND** the body SHALL contain `...body...` followed by a `## Capabilities` section enumerating `categorize` and `prioritize`
- **AND** the employee's `config_json.runtimeSkill` SHALL be removed

#### Scenario: Migration marker prevents re-execution

- **WHEN** `settings.skills_migration_v1_done='true'` is already present
- **THEN** `migrateRuntimeSkills` SHALL exit early without touching any employee

#### Scenario: Malformed legacy record is dropped without aborting migration

- **WHEN** an employee's `runtimeSkill` is missing both `skillName` and `summary`
- **THEN** the migration SHALL log a warning and skip that employee (no skill row, no SKILL.md)
- **AND** subsequent employees in the same pass SHALL still be processed
- **AND** the marker SHALL still be written at the end of the pass

#### Scenario: `RuntimeSkillConfig` is no longer in shared-types

- **WHEN** any consumer imports from `@offisim/shared-types`
- **THEN** the exported symbols SHALL NOT include `RuntimeSkillConfig`, `RuntimeSkillCapability`, or an `EmployeeConfig.runtimeSkill` field
- **AND** a type-check over the workspace SHALL NOT surface any lingering references

### Requirement: `SkillLoader.installSkill` accepts a `fork` source kind

`SkillLoader.installSkill` SHALL accept `source: { kind: 'fork'; parentSkillId: string; parentVersion: string }` as an additional variant of its `source` union. When invoked with a fork source, the loader SHALL write the employee-scope vault path byte-identically to the parent's body + asset tree (caller supplies the copied `files.skillMd` and `files.assets[]`), insert a `skills` row with `source_kind='forked'`, and encode `source_ref='company-skill:<parentSkillId>@<parentVersion>'` via `encodeSkillSourceRef`. Fork SHALL only be accepted with `scope='employee'` and a non-null `employeeId`; a `{ scope: 'company', source: { kind: 'fork' } }` call SHALL throw `SkillInstallError` with `kind: 'scope-target-conflict'`. Slug-collision idempotency rules are inherited unchanged: same `(companyId, employeeId, slug)` with same `source_ref` returns `{ wasExisting: true }`; different `source_ref` throws `slug-collision`.

#### Scenario: Fork source is accepted with employee scope

- **WHEN** `installSkill({ scope: 'employee', companyId: 'c1', employeeId: 'e7', source: { kind: 'fork', parentSkillId: 'sk_p', parentVersion: '0.3.2' }, files: { skillMd, assets } })` is called with a new employee-scope slug
- **THEN** the resulting row SHALL have `source_kind='forked'`, `source_ref='company-skill:sk_p@0.3.2'`, `scope='employee'`, `employee_id='e7'`

#### Scenario: Fork source with company scope is rejected

- **WHEN** `installSkill({ scope: 'company', source: { kind: 'fork', parentSkillId: 'sk_p', parentVersion: '0.3.2' }, ... })` is called
- **THEN** it SHALL throw `SkillInstallError` with `kind: 'scope-target-conflict'`

#### Scenario: Fork idempotency matches install idempotency

- **WHEN** two back-to-back fork installs share identical `(companyId, employeeId, slug)` and `source_ref='company-skill:sk_p@0.3.2'`
- **THEN** the second call SHALL return the existing row with `wasExisting: true` and MUST NOT write duplicate files or insert a second row

### Requirement: `SkillLoader.editSkillBody` is the sole entry point for skill body mutation

`SkillLoader.editSkillBody({ skillId, newBody })` SHALL be the only function that mutates an existing skill's SKILL.md body without changing its identity (slug / vault_path / source descriptor). It SHALL look up the row, read the current SKILL.md via `VaultFileSystem.readFile`, parse the frontmatter via `parseSkillMd`, serialise a new SKILL.md via `serializeSkillMd(frontmatter, newBody)` (preserving the frontmatter byte-for-byte as output by the serialiser), write the file via `VaultFileSystem.writeFile`, bump the row's `version` patch component (semver-safe patch bump: `major.minor.patch → major.minor.(patch+1)`), and update `updated_at`. It MUST NOT mutate `source_kind`, `source_ref`, `slug`, `scope`, `company_id`, `employee_id`, or `vault_path`. It SHALL reject (throw `SkillEditError`) when the row does not exist (`kind: 'skill-not-found'`), when the on-disk SKILL.md cannot be parsed (`kind: 'skill-md-invalid'`), or when the version cannot be patch-bumped (`kind: 'version-bump-failed'`). It SHALL NOT validate ownership / scope — tool-level handlers carry that responsibility (the loader is a generic write API for every future skill mutation path including T2.6 self-improve).

#### Scenario: Edit preserves identity fields

- **WHEN** `editSkillBody({ skillId: 'sk_e7_w', newBody: 'new body text' })` is called on a row with `slug='writing-style'`, `source_kind='forked'`, `source_ref='company-skill:sk_p@0.3.2'`, `version='0.3.2'`, `vault_path='companies/c1/employees/alice-xyz/skills/writing-style/SKILL.md'`
- **THEN** the row after the call SHALL have `version='0.3.3'`, `updated_at` refreshed, and `slug`, `source_kind`, `source_ref`, `vault_path` unchanged
- **AND** the SKILL.md on disk SHALL open with the same frontmatter block (byte-identical to pre-edit frontmatter) followed by `new body text`

#### Scenario: Non-existent skillId

- **WHEN** `editSkillBody({ skillId: 'sk_missing', newBody: '...' })` is called
- **THEN** it SHALL throw `SkillEditError` with `kind: 'skill-not-found'`
- **AND** no filesystem IO SHALL occur

#### Scenario: Corrupted on-disk SKILL.md

- **WHEN** the on-disk file at the row's `vault_path` cannot be parsed (e.g. malformed frontmatter)
- **THEN** the loader SHALL throw `SkillEditError` with `kind: 'skill-md-invalid'`
- **AND** the file SHALL NOT be overwritten

#### Scenario: Version patch bump

- **WHEN** `editSkillBody` is called on a row with `version='0.1.0'`, then again on the resulting row
- **THEN** the first call SHALL bump to `'0.1.1'`, the second to `'0.1.2'`
- **WHEN** a row's `version` is not semver-compatible (e.g. `'draft'`)
- **THEN** the loader SHALL throw `SkillEditError` with `kind: 'version-bump-failed'`

