## ADDED Requirements

### Requirement: Employee presentation state is separate from ceremony state
The scene orchestrator SHALL keep employee presentation cue state as a sibling to ceremony state, not as ceremony phase text. Ceremony state SHALL continue to describe team-level phase choreography, while employee presentation state SHALL describe per-employee action bubbles, priorities, and TTL cleanup.

#### Scenario: Ceremony bubble and employee bubble coexist
- **WHEN** the ceremony phase shows a meeting-level bubble
- **AND** an employee receives a tool or waiting cue
- **THEN** the meeting-level ceremony bubble SHALL remain team-level
- **AND** the employee cue SHALL render on that employee only

#### Scenario: Presentation cleanup does not mutate ceremony phase
- **WHEN** an employee cue expires
- **THEN** the cue SHALL be removed from employee presentation state
- **AND** the ceremony phase SHALL NOT change solely because the cue expired

### Requirement: Scene intent dispatcher remains the runtime presentation bridge
Runtime event to presentation cue mapping SHALL pass through the scene intent bridge or an equivalent scene-runtime adapter. Rendering components SHALL NOT subscribe independently to every runtime event domain to recreate cue semantics.

#### Scenario: 3D and 2D consume one presentation state
- **WHEN** both 3D and 2D render paths need the active cue for an employee
- **THEN** they SHALL read from the same employee presentation state contract
- **AND** they SHALL NOT each implement separate runtime event mapping logic
