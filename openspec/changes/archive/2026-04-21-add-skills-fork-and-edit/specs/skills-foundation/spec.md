## ADDED Requirements

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

## MODIFIED Requirements

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
