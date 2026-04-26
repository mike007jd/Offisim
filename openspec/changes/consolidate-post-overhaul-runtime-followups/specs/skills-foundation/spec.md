## ADDED Requirements

### Requirement: Skills foundation SHALL accept self-authored source variant

`SkillLoader.installSkill` SHALL accept a new `source` variant `{ kind: 'self-authored', modelKey: string }` alongside the existing `'installed'` / `'forked'` variants. The variant writes:
- `skills.source_kind = 'self-authored'`
- `skills.source_ref = 'llm-author:<modelKey>'`

The variant MUST NOT bypass the standard staging + commit + frontmatter validation pipeline (T2.1 + T2.2). It is an entry point label, not a permission relaxation.

`SkillLoader.installSkill({ source: { kind: 'self-authored' }, scope: 'company' })` SHALL throw a `SkillScopeError(kind='self-authoring-requires-employee-scope')` — self-authored skills are employee-scope only. Company scope MUST go through the publish flow.

#### Scenario: Self-authored install variant produces row with correct provenance

- **WHEN** `SkillLoader.installSkill({ source: { kind: 'self-authored', modelKey: 'minimax/MiniMax-M2.7' }, scope: 'employee', employeeId: 'emp-...', body: '<valid SKILL.md>' })` is called and frontmatter passes whitelist
- **THEN** vault SKILL.md is written, a `skills` row is inserted with `source_kind='self-authored'` + `source_ref='llm-author:minimax/MiniMax-M2.7'`, scope `employee`

#### Scenario: Self-authored with company scope rejected

- **WHEN** `installSkill` is called with `source.kind='self-authored'` and `scope='company'`
- **THEN** the call throws `SkillScopeError(kind='self-authoring-requires-employee-scope')` and no vault write or DB insert occurs
