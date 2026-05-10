## ADDED Requirements

### Requirement: Release verification SHALL prove parity routes in the release app

Any parity or full-agent availability claim SHALL include release `.app` verification from the exact current worktree bundle path. Evidence SHALL include bundle timestamp/hash, active runtime/profile, project/workspace identity, task/run identity, screenshots or Computer Use observations, DB/event/audit rows where applicable, commands run, and remaining blockers.

Dev webview, localhost SPA, backend-only harness output, or source inspection SHALL NOT satisfy release `.app` parity gates.

#### Scenario: Full-agent release smoke records evidence

- **WHEN** a full-agent profile is promoted
- **THEN** release `.app` evidence proves text success, local tool success, denied path, cancellation, MCP lifecycle, resume/fork, checkpoint/rollback, budget exhaustion, sandbox escape denial, and completion classification
- **AND** the evidence is recorded before the task is checked

#### Scenario: Missing Computer Use leaves gate open

- **WHEN** Computer Use or release app attachment is unavailable
- **THEN** the release verification task remains unchecked
- **AND** the route cannot be marked production available

### Requirement: Archive gate SHALL reject blocked/full-agent contradiction

The change SHALL NOT archive while specs, ledgers, tasks, runtime matrices, UI copy, or memory correction notes contradict each other about full-agent availability. It SHALL be invalid to archive with "full-agent implemented" in one truth source and "full-agent permanently blocked/text-only only" in another current truth source.

#### Scenario: Truth-source contradiction blocks archive

- **WHEN** `sdk-native-full-power` is available in runtime profiles
- **AND** provider matrix, protocols ledger, root guidance, or memory correction notes still describe it as permanently blocked
- **THEN** archive is blocked until the stale truth source is corrected

