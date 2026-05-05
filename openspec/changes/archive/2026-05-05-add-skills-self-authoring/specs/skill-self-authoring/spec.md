## ADDED Requirements

### Requirement: Self-authoring SHALL pass release-`.app` live verify before capability is considered shipped

Skill self-authoring SHALL pass release-`.app` live verify before it is considered shipped.
The four existing `skill-self-authoring` invariants are LLM tool
registration, frontmatter whitelist, T2.2 staging pipeline reuse, and
preview bubble `'create'` action variant. They SHALL hold on the
release `.app` lane, not only on dev builds and not only at unit-test
reachability. Release-app live verify is the canonical evidence of
shipping; archive of this change SHALL include verify evidence under
`.live-verify/`.

#### Scenario: Release session can reach create_skill_from_scratch

- **WHEN** an employee LLM in a release `.app` chat session is asked
  to author a new skill from scratch
- **THEN** the LLM SHALL be able to invoke `create_skill_from_scratch`
- **AND** the chat surface SHALL render the staging preview bubble
  with `action='create'`

#### Scenario: Release session enforces frontmatter whitelist with all four reason codes

- **WHEN** the LLM-authored body's frontmatter triggers any of
  `missing-required`, `forbidden-namespace`, `unknown-field`,
  `invalid-yaml`
- **THEN** the tool SHALL return `SkillFrontmatterError` with the
  matching reason code on the release `.app` lane
- **AND** SHALL NOT create a staging entry

#### Scenario: Release session two-phase commit matches T2.2 install path

- **WHEN** the user clicks `Create skill` on the preview bubble in a
  release session
- **THEN** the skill SHALL be written to vault through the same
  two-phase commit pipeline as T2.2 `install_skill_from_*`
- **AND** clicking `Cancel` SHALL remove staging without any vault
  write
