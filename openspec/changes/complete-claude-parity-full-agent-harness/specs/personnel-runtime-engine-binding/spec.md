## ADDED Requirements

### Requirement: Runtime binding UI SHALL show truthful profile availability

Personnel/runtime binding surfaces SHALL show each runtime profile's actual tier, availability, evidence status, and missing gates. A text-only preview profile SHALL NOT be visually or verbally presented as full-agent. A full-agent profile SHALL NOT become selectable until all required gates pass.

#### Scenario: Blocked full-agent shows actionable blockers

- **WHEN** a full-agent profile is unavailable
- **THEN** the UI shows the missing gates such as native tool evidence, MCP lifecycle, cancellation, resume/fork, rollback, sandbox, usage/cost, benchmark, or release `.app` evidence
- **AND** the user cannot select it as production runtime

#### Scenario: Available full-agent shows evidence

- **WHEN** a full-agent profile passes every promotion gate
- **THEN** the UI shows it as available with evidence references
- **AND** the selected employee task envelope records that profile identity
