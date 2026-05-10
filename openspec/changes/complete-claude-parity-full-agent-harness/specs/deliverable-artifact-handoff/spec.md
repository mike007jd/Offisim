## ADDED Requirements

### Requirement: Deliverable creation SHALL be accepted evidence only through artifact events

Tasks that require producing files, reports, HTML, CSV, JSON, code artifacts, or other deliverables SHALL require accepted deliverable/artifact evidence. Final text describing a file SHALL NOT satisfy deliverable tasks unless a corresponding `deliverable.created` event, artifact state, and UI card commitment exist.

Default harness, gateway-bridged routes, and SDK-native full-agent profiles SHALL all map deliverable work into the same task-run identity and completion-evidence model.

#### Scenario: Artifact claim without event is blocked

- **WHEN** an employee says it created `report.md` or `index.html`
- **AND** no matching `deliverable.created` event or artifact state exists for the task-run identity
- **THEN** completion verification blocks the task
- **AND** the activity feed records missing deliverable evidence

#### Scenario: Full-agent artifact evidence is normalized

- **WHEN** a full-agent runtime creates a file artifact natively
- **THEN** Offisim records normalized artifact evidence with file name, mime type, size/hash where available, runtime profile, checkpoint identity, and task-run identity
- **AND** chat/Outputs surfaces render the same deliverable primitive used by default harness deliverables

#### Scenario: Late artifact event still counts

- **WHEN** a `deliverable.created` event arrives after final text commits
- **THEN** the artifact attaches to the committed message through the existing out-of-order event path
- **AND** completion evidence remains linked to the same task-run identity
