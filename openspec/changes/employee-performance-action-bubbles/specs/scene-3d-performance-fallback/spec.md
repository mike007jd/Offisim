## ADDED Requirements

### Requirement: 3D performance fallback preserves employee presentation cues
When 3D rendering falls back to 2D because of performance or crash protection, employee presentation cue meaning SHALL be preserved in the 2D view. The fallback path MUST NOT drop who is working, waiting, blocked, reporting, or handing off.

#### Scenario: Active cue survives forced 2D fallback
- **WHEN** an employee has an active presentation cue in 3D
- **AND** the scene enters forced 2D fallback
- **THEN** the 2D view SHALL render a cue with the same category, source identity, and priority for that employee

#### Scenario: Retrying 3D preserves current cue state
- **WHEN** the user retries 3D while employee cues are active
- **THEN** the 3D scene SHALL render the currently active cues from shared presentation state
- **AND** retrying 3D SHALL NOT recreate stale expired cues
