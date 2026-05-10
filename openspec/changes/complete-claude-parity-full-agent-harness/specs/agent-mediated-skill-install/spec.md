## ADDED Requirements

### Requirement: Skill mutation SHALL preserve confirmation and vault safety across parity routes

Skill install, sync, fork, edit, and create operations SHALL remain gated by staging, parsed `SKILL.md` validation, security-relevant preview, user confirmation, vault path containment, and DB/vault write ordering. Default harness, gateway-bridged full-agent routes, SDK-native full-agent routes, and external employees SHALL NOT bypass those gates.

Any route that cannot preserve confirmation interaction state and vault safety SHALL be unavailable for memory/todo/skill task families.

#### Scenario: Native agent cannot auto-install a skill

- **WHEN** a full-agent runtime proposes installing or editing a skill
- **THEN** Offisim creates the same confirmation interaction and staging evidence as the default harness
- **AND** no vault or `skills` row mutation occurs until the user confirms

#### Scenario: Skill evidence records route and confirmation

- **WHEN** a skill mutation is confirmed and committed
- **THEN** evidence records source, scope, target employee if any, confirmation id, runtime profile or gateway route, vault path, and task-run identity
- **AND** completion verification requires that evidence for skill mutation tasks

#### Scenario: External employee skill mutation stays internal-gated

- **WHEN** an external/A2A employee requests skill mutation work
- **THEN** Offisim applies the same staging, confirmation, vault, and completion gates
- **AND** external health or A2A compatibility does not count as skill mutation authority
