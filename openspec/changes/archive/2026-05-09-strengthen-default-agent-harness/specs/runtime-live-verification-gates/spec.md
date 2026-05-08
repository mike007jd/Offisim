## ADDED Requirements

### Requirement: Release verification SHALL prove default harness ownership
Release `.app` verification SHALL include a gate proving that fresh internal employee work executes through the default Offisim core harness unless an explicit trusted runtime override is configured.

The evidence SHALL record the selected main harness mode, employee runtime binding, provider lane, active context snapshot, task-run identity, tool/evidence path, and terminal task state.

#### Scenario: Fresh release app uses default harness
- **WHEN** the release `.app` runs a fresh internal employee task with no overrides
- **THEN** verification evidence shows main harness mode `offisim-core`
- **AND** the task-run, tool/evidence path, and terminal state are owned by Offisim core

#### Scenario: SDK provider lane does not become main harness
- **WHEN** the release `.app` selects a SDK provider lane for text/reasoning
- **THEN** verification evidence still shows main harness mode `offisim-core`
- **AND** local-tool tasks remain blocked or routed to gateway according to policy

### Requirement: Alternate agent engines SHALL require release evidence before being advertised
Any employee agent engine, main harness driver, or main harness replacement mode SHALL have release `.app` evidence before product UI or documentation can call it available. The evidence SHALL include at least one success path, one denied/blocked path, one cancellation path, and one checkpoint/resume path for the exact runtime profile.

#### Scenario: Employee agent profile lacks release evidence
- **WHEN** an employee agent profile lacks release `.app` success, blocked, cancellation, or resume evidence
- **THEN** the product UI marks it unavailable or preview-blocked
- **AND** release sign-off cannot claim it as supported

#### Scenario: Replacement mode evidence includes rollback
- **WHEN** a main harness replacement profile is release-verified
- **THEN** evidence includes checkpoint handoff and rollback behavior
- **AND** archive is blocked if rollback cannot be demonstrated

### Requirement: Release verification SHALL prove override policy is not arbitrary
Release `.app` verification SHALL include a gate proving that provider lane selection, employee runtime binding, SDK availability, and external peer discovery cannot silently override the main harness mode. Only explicit audited policy may select driver or replacement mode.

#### Scenario: SDK availability does not override default
- **WHEN** the release `.app` detects available Claude, Codex, or OpenAI agent SDK runtime support
- **THEN** main harness mode remains `offisim-core` until an explicit audited policy selects another mode
- **AND** the evidence records that no automatic override occurred

#### Scenario: Explicit override records rollback evidence
- **WHEN** the release `.app` verifies an explicit main harness override
- **THEN** evidence includes actor/scope/reason, previous mode, next mode, runtime profile, rollback checkpoint, and terminal verification status
- **AND** archive is blocked if any field is missing

#### Scenario: Release evidence tool is unavailable
- **WHEN** Computer Use cannot attach to the exact release `.app` window
- **THEN** shell, AppleScript, localhost, or dev-webview observations do not satisfy release verification
- **AND** archive remains blocked until a healthy Computer Use session captures the release `.app` evidence
