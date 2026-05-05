## ADDED Requirements

### Requirement: Manager rebind on `requires-local-tools` SHALL emit `task.assignment.rerouted`

The manager node SHALL emit `task.assignment.rerouted` when local-tool intent rejects an external employee.
This applies when the manager filters out a recommended external A2A
employee because the task's `taskToolIntent` requires local Offisim
tools. The event (per `shared-types/events/task.ts`) SHALL use
`source='manager'` and `reason='requires-local-tools'`. The emission
SHALL be mirrored to `logger.info`. The event SHALL be observable on
the release-session activity feed.

#### Scenario: External employee filtered out for local-tools intent

- **WHEN** the LLM picks an external A2A employee for a task
- **AND** the manager evaluates `taskToolIntent` and rejects the pick
  because the intent requires local tools
- **THEN** the runtime SHALL emit `task.assignment.rerouted` with
  `source='manager'`, `reason='requires-local-tools'`, the original
  external employee id, and the rebind target id
- **AND** the event SHALL appear on the activity feed in the
  release `.app` session

### Requirement: pm-planner sanitize-rebind SHALL emit `task.assignment.rerouted`

pm-planner sanitize-rebind SHALL emit `task.assignment.rerouted` when it swaps an employee.
This applies when `pm-planner/sanitize-rebind.ts` swaps a missing or
disabled employee. The event SHALL use `source='pm-planner'` and
`reason ∈ {'employee-not-found', 'employee-disabled',
'no-recommendation-fallback'}`. The event SHALL be observable on the
release-session activity feed.

#### Scenario: pm-planner rebinds missing employee

- **WHEN** pm-planner encounters an employee id in the plan that no
  longer exists in the active company's `employees` table
- **THEN** the runtime SHALL emit `task.assignment.rerouted` with
  `source='pm-planner'`, `reason='employee-not-found'`, the original
  employee id, and the rebind target id

#### Scenario: pm-planner rebinds disabled employee

- **WHEN** pm-planner encounters an employee id whose `is_enabled`
  flag is false
- **THEN** the runtime SHALL emit `task.assignment.rerouted` with
  `source='pm-planner'`, `reason='employee-disabled'`

### Requirement: Activity feed SHALL collapse 3+ same-(source, reason, taskRunId) rebind events

The activity feed SHALL collapse 3 or more `task.assignment.rerouted`
events sharing the same `(source, reason, taskRunId)` triple into a
single row with an `×N` badge indicating the count. Fewer than 3
SHALL render as individual rows.

#### Scenario: Three rebinds in same task run collapse

- **WHEN** the same `taskRunId` produces three `task.assignment.rerouted`
  events with the same `(source, reason)` tuple within the same run
- **THEN** the activity feed SHALL render a single row carrying an
  `×3` badge
- **AND** subsequent rebinds in the same run with the same tuple
  SHALL increment the badge, not produce new rows

#### Scenario: Two rebinds do not collapse

- **WHEN** two `task.assignment.rerouted` events fire with the same
  `(source, reason, taskRunId)` triple
- **THEN** they SHALL render as two individual rows

### Requirement: Reroute verification claims SHALL require runtime-event evidence

Employee completion SHALL require a real `task.assignment.rerouted`
runtime event in the same thread when the task description asks to
verify, prove, or report reroute/rebind behavior. A file
or shell tool call may prove local tool access, but it SHALL NOT prove
that rerouting happened. This prevents an employee from writing a
synthetic "reroute proof" file and marking the routing gate complete
without the manager or pm-planner actually emitting the routing event.

#### Scenario: Synthetic proof file does not satisfy reroute verification

- **WHEN** an employee task description asks to verify missing-employee
  or local-tool reroute behavior
- **AND** the employee writes a proof file or reads local files
- **BUT** no `task.assignment.rerouted` event exists for the thread
- **THEN** completion SHALL be blocked for human review
- **AND** the block reason SHALL name the missing runtime event

#### Scenario: Real reroute event satisfies the routing-evidence gate

- **WHEN** manager or pm-planner emits `task.assignment.rerouted` for
  the thread
- **AND** the task has the ordinary file/shell evidence required by
  its tool intent
- **THEN** the reroute verification claim MAY complete
