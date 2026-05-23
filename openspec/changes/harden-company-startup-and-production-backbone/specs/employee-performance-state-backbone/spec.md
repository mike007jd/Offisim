## ADDED Requirements

### Requirement: Employee performance state is separate from AI execution state
The system SHALL maintain employee performance state as a sibling layer to AI execution state. Performance state SHALL describe acting/choreography semantics such as greeting, sitting, being held, being carried, valid-drop hover, invalid-drop hover, celebrating, and settling. It MUST NOT replace or mutate `AgentState.state` values used by runtime routing, task status, billing, or completion logic.

#### Scenario: Dragging does not change AI state
- **WHEN** an idle employee is picked up for drag/drop
- **THEN** the employee performance state SHALL become `held` or `carried`
- **AND** the employee AI execution state SHALL remain `idle`

#### Scenario: Working employee can have acting state
- **WHEN** an employee is executing real work and receives a non-conflicting performance cue
- **THEN** the runtime state SHALL remain `executing`
- **AND** the performance state MAY expose a renderer-consumable acting overlay without changing task routing

### Requirement: Drag lifecycle emits semantic performance states
The scene interaction layer SHALL emit or reduce a deterministic drag lifecycle for employees: pointer down, drag threshold crossed, carried, hover valid drop target, hover invalid drop target, drop accepted, drop rejected, cancel, and settle. Each lifecycle transition SHALL include employee id, source zone/workstation, current target if any, and reason when rejected.

#### Scenario: Valid drop lifecycle
- **WHEN** the user drags an employee over a valid workstation zone and releases
- **THEN** the lifecycle SHALL include `carried`, `drop-valid`, `drop-accepted`, and `settle`
- **AND** the workstation assignment request SHALL be emitted only after `drop-accepted`

#### Scenario: Invalid drop lifecycle
- **WHEN** the user drags an employee over no valid target and releases
- **THEN** the lifecycle SHALL include `drop-invalid` or `drop-rejected`
- **AND** no workstation assignment request SHALL be persisted

### Requirement: Startup acting states do not imply work
Startup ceremony MAY apply performance states such as `greet`, `enter`, `sit`, `look-around`, `celebrate`, and `settle`. These states SHALL NOT emit task, plan, tool, LLM, or deliverable events.

#### Scenario: Startup greeting is non-work
- **WHEN** startup ceremony asks an employee to greet or sit
- **THEN** only performance/scene lifecycle state SHALL change
- **AND** no AI work event SHALL be emitted

### Requirement: Performance state consumers share one contract
3D, 2D, release verification probes, and deterministic harness scenarios SHALL consume the same performance state contract. They MAY render it differently, but they MUST NOT each recreate separate drag/startup semantics from raw pointer or lifecycle events.

#### Scenario: 2D and 3D read the same drag state
- **WHEN** an employee is in `carried` performance state
- **THEN** both 2D and 3D scene paths SHALL receive the same employee id, source zone, target zone, and validity state from the shared contract
