## ADDED Requirements

### Requirement: Scene orchestrator recognizes real PM planner node
The ceremony phase derivation SHALL treat the graph node name `pm_planner` as planning. Any existing aliases such as `pm`, `planner`, `project_manager`, and `product_manager` MAY remain supported, but the real graph node name MUST be covered.

#### Scenario: pm_planner enters planning phase
- **WHEN** `graph.node.entered` fires with `nodeName = 'pm_planner'`
- **THEN** ceremony phase SHALL become `planning`
- **AND** the planning phase SHALL be observable through the same ceremony state contract used for other planning aliases

### Requirement: Startup ceremony is separate from work ceremony
The scene orchestrator SHALL support company startup lifecycle input as a separate non-work ceremony domain. Startup ceremony state SHALL NOT set `hasActivePlan`, SHALL NOT dispatch employees to workstations as task assignments, and SHALL NOT call Boss summary completion logic.

#### Scenario: Startup does not activate plan state
- **WHEN** `company.startup.started` is observed
- **THEN** the scene orchestrator MAY expose startup ceremony state
- **AND** `hasActivePlan` or equivalent work-plan coordination state SHALL remain false

### Requirement: Startup ceremony cancellation clears only startup state
Cancelling, skipping, or completing startup ceremony SHALL clear startup ceremony state without aborting an unrelated real graph run. Aborting a real graph run SHALL clear work ceremony state without rewriting persisted startup completion unless the startup ceremony is currently active.

#### Scenario: Skip startup while no run is active
- **WHEN** startup ceremony is skipped
- **THEN** startup ceremony state SHALL clear
- **AND** no `execution.aborted` event SHALL be emitted

### Requirement: Performance state is a sibling to ceremony phase
The scene orchestrator SHALL expose employee performance state as a sibling to ceremony state. Ceremony phase describes team/company lifecycle; performance state describes per-employee acting semantics. Expiring or clearing a performance state SHALL NOT by itself change ceremony phase.

#### Scenario: Drag performance state does not mutate ceremony
- **WHEN** an employee drag lifecycle sets performance state to `carried`
- **THEN** ceremony phase SHALL remain whatever it was before the drag lifecycle
- **AND** no graph phase transition SHALL be inferred from dragging
