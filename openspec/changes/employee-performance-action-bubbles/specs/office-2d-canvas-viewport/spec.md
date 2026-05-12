## ADDED Requirements

### Requirement: 2D employee render data includes presentation cue fields
The 2D scene snapshot SHALL include employee presentation cue data for each rendered employee when an active cue exists. The cue data SHALL include visible text, category, priority, and source identity sufficient for the draw layer to render the correct bubble without subscribing to runtime events.

#### Scenario: Snapshot carries active cue
- **WHEN** an employee has an active presentation cue
- **THEN** that employee's 2D render data SHALL include a bubble or badge payload derived from the cue

#### Scenario: Snapshot omits expired cue
- **WHEN** an employee cue expires before snapshot construction
- **THEN** that employee's 2D render data SHALL NOT include that expired cue

### Requirement: 2D draw pipeline renders employee bubbles in the employee layer
The 2D canvas draw pipeline SHALL render per-employee cue bubbles in the employee layer so that bubbles move with avatars and remain above state badges without requiring a new cross-layer dependency.

#### Scenario: Employee bubble is anchored to avatar
- **WHEN** a 2D employee avatar is rendered with an active cue
- **THEN** the bubble SHALL be positioned relative to that avatar
- **AND** panning or zooming the canvas SHALL move the bubble with the employee

#### Scenario: Degraded rendering preserves category
- **WHEN** the 2D renderer is in degraded mode due to employee count
- **THEN** the renderer MAY collapse bubble text
- **BUT** it SHALL still show a category marker for blocked, waiting, tool, report, or handoff cues
