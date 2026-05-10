## ADDED Requirements

### Requirement: Employee runtime routing SHALL remain explicit and modular

Adding default-harness parity, full-agent employees, gateway-bridged routes, SDK-native routes, driver/replacement proposals, or external/A2A employees SHALL NOT collapse employee runtime routing back into an inline monolith. The employee node SHALL keep explicit routing order and delegate route bodies to scoped modules.

The routing order SHALL distinguish external employee, verified runtime engine profile, gateway/provider prompt loop, completion verification, and error finalization. No branch may silently fall back to another owner without a typed event and evidence record.

#### Scenario: Full-agent branch is a sibling executor

- **WHEN** employee runtime binding selects a verified full-agent profile
- **THEN** `employee-node` delegates to a full-agent/engine executor module rather than inlining adapter, sidecar, tool, completion, or rollback logic
- **AND** the employee-node barrel size and public API constraints remain intact

#### Scenario: Fallback is observable

- **WHEN** profile-fit checks reject a selected full-agent profile and the task routes to `offisim-core`
- **THEN** the fallback emits a typed reroute/fallback event with source profile, reason, target owner, and task-run identity
- **AND** completion evidence records the actual owner that executed the task

#### Scenario: Completion side effects remain shared

- **WHEN** default harness, full-agent, gateway-bridged, or external employee work completes
- **THEN** completion side effects flow through the shared completion/evidence path
- **AND** deliverable, memory, skill, task-state, and citation side effects do not fork into route-specific hidden implementations
