## ADDED Requirements

### Requirement: Production release gate SHALL block on security hardening

A production release candidate SHALL NOT be marked ready while any Gate A blocker remains open: provider-scoped LLM transport, project/provider-scoped trusted sidecars, project-scoped local path/git/deliverable commands, shell high-risk approval/audit, and marketplace listing ownership guard.

#### Scenario: Gate A open blocks release
- **WHEN** any Gate A task is incomplete or unverified
- **THEN** release status is `blocked`
- **AND** the OpenSpec change cannot be archived as complete

#### Scenario: Gate A verified requires release app evidence
- **WHEN** a Gate A fix touches desktop runtime behavior
- **THEN** verification includes release `.app` build and Computer Use or equivalent release-app interaction evidence

### Requirement: Gate B release blockers SHALL prevent archive

A hardening change SHALL NOT be archived as complete while any Gate B release blocker remains open, including canonical manifest validation, artifact integrity and SSRF fetch hardening, install materialization atomicity and idempotency, MCP stdio permissioning, API token scope enforcement, local runtime route guards, and platform migration checks.

#### Scenario: Gate B open blocks archive
- **WHEN** any Gate B task is incomplete or unverified
- **THEN** release status remains `blocked`
- **AND** the OpenSpec change cannot be archived as complete

### Requirement: Validation policy documentation SHALL match actual release gates

README and release runbook SHALL state that Offisim does not maintain a broad unit-test suite, but deterministic harnesses, targeted Rust safety tests, platform migration checks, and release `.app` live verification are retained as release gates. Documentation SHALL NOT claim the repository has no automated validation while `harness:*` scripts are active gates.

#### Scenario: README does not deny harness gates
- **WHEN** reading README Validation Policy
- **THEN** it acknowledges deterministic harness and targeted safety tests as release gates
- **AND** it still forbids reintroducing broad stale unit-test/smoke suites

#### Scenario: Release runbook lists hardening gates
- **WHEN** reading the release runbook
- **THEN** it lists provider transport, sidecar, marketplace integrity, platform migration, and desktop release `.app` verification gates

### Requirement: Final release verification SHALL record reproducible evidence metadata

Final verification for this hardening change SHALL run the repository validation gates and record enough evidence for another engineer to reproduce what was verified. Required evidence includes commit SHA, release app path, app bundle hash, environment, provider profile class used for verification, command outputs or log paths, and screenshots or Computer Use evidence for release `.app` flows.

The release gate SHALL include `pnpm validate` or `pnpm lint`, affected deterministic harnesses, desktop Rust formatting/lint/test gates where available, `openspec validate harden-release-security-and-marketplace --strict` before apply/archive when the CLI supports strict mode, and release `.app` live verification.

#### Scenario: Final evidence includes build identity
- **WHEN** final verification is recorded
- **THEN** the evidence includes commit SHA, release `.app` path, app bundle hash, and environment details
- **AND** the evidence points to logs/screenshots for each release `.app` behavior verified

#### Scenario: Strict OpenSpec validation runs before archive
- **WHEN** the change is ready to archive
- **THEN** `openspec validate harden-release-security-and-marketplace --strict` is run if supported by the installed CLI
- **AND** any validation failure blocks archive
