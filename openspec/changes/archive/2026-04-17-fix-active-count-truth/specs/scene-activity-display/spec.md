## ADDED Requirements

### Requirement: Single shared selector for active-employee counts

The system SHALL expose exactly one hook — `useActiveEmployeeCount()` —
that owns the authoritative `{ active, total, blocked }` values for the
currently-active company. Every UI surface that displays an employee
activity count SHALL consume this hook; no surface SHALL re-implement
its own active-count computation.

#### Scenario: Footer and 3D overlay report the same active count
- **WHEN** the global StatusBar footer and the 3D-view HTML overlay are
  both visible at the same frame
- **THEN** the number rendered in `{active}/{total} employees` in the
  footer SHALL equal the number rendered in `{activeCount} employees
  active` in the 3D overlay

#### Scenario: Consumers do not maintain private employee-state maps for counting
- **WHEN** a consumer needs the active employee count
- **THEN** it SHALL call `useActiveEmployeeCount()` and read `.active`
  directly, rather than iterating its own `Map<employeeId,
  EmployeeState>` or re-subscribing to `employee.state.*` for counting
  purposes

### Requirement: Active-state predicate excludes idle, terminal, and paused states

The system SHALL define `isEmployeeActive(state: EmployeeState)` that returns
`true` **only** when `state` is one of `assigned`, `thinking`, `searching`,
`executing`, `meeting`, `reporting`, or `waiting`. For any other value of
`EmployeeState` — including `idle`, `blocked`, `failed`, `success`, and
`paused` — it SHALL return `false`.

#### Scenario: Idle employee is not counted as active
- **WHEN** an employee's state is `idle`
- **THEN** `isEmployeeActive('idle')` SHALL return `false` and the
  employee SHALL NOT contribute to the `active` count

#### Scenario: Working states are counted as active
- **WHEN** an employee's state is any of `assigned`, `thinking`,
  `searching`, `executing`, `meeting`, `reporting`, or `waiting`
- **THEN** `isEmployeeActive(state)` SHALL return `true` and the
  employee SHALL contribute to the `active` count

#### Scenario: Terminal and paused states are not counted as active
- **WHEN** an employee's state is `success`, `failed`, `blocked`, or
  `paused`
- **THEN** `isEmployeeActive(state)` SHALL return `false`. `failed` and
  `blocked` employees are separately reported by the `blocked` count;
  `success` and `paused` are not counted at all

### Requirement: Blocked count is reported alongside active count

The shared hook SHALL publish a `blocked` count derived from the same
employee-state map via `isEmployeeBlocked(state)`, which returns `true`
if and only if `state` is `blocked` or `failed`.

#### Scenario: 3D overlay reads blocked count from the shared hook
- **WHEN** the 3D overlay displays `{blockedCount} employees blocked`
- **THEN** `blockedCount` SHALL be the value of `.blocked` returned by
  `useActiveEmployeeCount()` for the active company

#### Scenario: Blocked and failed states are the only ones counted as blocked
- **WHEN** an employee's state is `blocked` or `failed`
- **THEN** `isEmployeeBlocked(state)` SHALL return `true`
- **WHEN** an employee's state is anything else
- **THEN** `isEmployeeBlocked(state)` SHALL return `false`

### Requirement: Reset symmetry across run-start and company switch

The shared hook SHALL reset its internal employee-state map consistently,
with both the footer and the 3D overlay observing the same transition:

- On `activeCompanyId` change: clear the map; reseed `total` from
  the new company's bootstrap employee count and, when `repos` becomes
  available, from `repos.employees.findByCompany(activeCompanyId)`.
- On `isRunning → true` transition: for every known `employeeId`,
  reassign the tracked state to `'idle'`. Do not clear the map; the
  roster persists across runs.

#### Scenario: Company switch resets active and total counts atomically
- **WHEN** `activeCompanyId` changes from company A to company B
- **THEN** both `active` and `total` SHALL be recomputed based on
  company B's employee roster before any `employee.state.*` event for
  company B is observed
- **AND** the footer and the 3D overlay SHALL show the same `active`
  and `total` values at every rendered frame during this transition

#### Scenario: New run resets active to zero while preserving total roster
- **WHEN** `isRunning` transitions from `false` to `true`
- **THEN** the shared hook SHALL set `active` to `0` on its first
  publish after the transition
- **AND** `total` SHALL remain equal to the roster size (unchanged)
- **AND** the footer and the 3D overlay SHALL both observe the reset
  at the same time (within one React render cycle)

### Requirement: Active count reflects live `employee.state.*` events within one render cycle

The shared hook SHALL update its internal map and re-publish
`{ active, total, blocked }` within the same React render cycle when an
`employee.state.*` event fires on the runtime event bus, so that both
consumers see the new value before the next event is processed.

#### Scenario: State change from idle to executing increments active by one
- **WHEN** an `employee.state.executing` event fires for an employee
  whose prior state was `idle`
- **THEN** the next published `.active` value SHALL equal the previous
  `.active` value + 1

#### Scenario: State change from executing to idle decrements active by one
- **WHEN** an `employee.state.idle` event fires for an employee whose
  prior state was `executing`
- **THEN** the next published `.active` value SHALL equal the previous
  `.active` value - 1

#### Scenario: State change between two working states does not change active
- **WHEN** an `employee.state.thinking` event fires for an employee
  whose prior state was `executing`
- **THEN** the next published `.active` value SHALL equal the previous
  `.active` value

### Requirement: Roster additions and removals update total symmetrically for both consumers

The shared hook SHALL update `total` and publish the new value when
`employee.created` or `employee.deleted` events fire, so that the
footer's `{active}/{total}` and the 3D overlay (via the same hook) see
the same `total`.

#### Scenario: New employee created in active company increments total
- **WHEN** an `employee.created` event fires for the currently-active
  company
- **THEN** `.total` SHALL be incremented by 1
- **AND** the new employee SHALL be tracked with an initial state of
  `idle` (so it does not contribute to `.active` yet)

#### Scenario: Employee deleted is removed from both total and active
- **WHEN** an `employee.deleted` event fires for an employee whose
  current tracked state is `executing` (i.e., contributes to `.active`)
- **THEN** `.total` SHALL be decremented by 1
- **AND** `.active` SHALL be decremented by 1 in the same publish

### Requirement: Counter displays reconcile with scene visual state in steady state

The counter SHALL reconcile with scene visuals in steady state: whenever
the scene (2D canvas or 3D) is rendered and stable with no in-flight
event updates, the numeric `active` count displayed in the footer and
the 3D overlay MUST equal the count of employees whose `EmployeeState`
is in the active-state set as defined by `isEmployeeActive`. This is the
live-verification invariant: during apply, the change is not complete
until this reconciliation is demonstrated on a real task.

#### Scenario: Live task run produces matching counter and scene state
- **WHEN** a user runs a real multi-employee task on the web runtime
- **THEN** at every observed pause point, the displayed `active` number
  SHALL equal the count of employees whose tracked `EmployeeState` is
  in the active set
- **AND** no employee whose tracked `EmployeeState` is `idle`,
  `success`, `paused`, `blocked`, or `failed` SHALL contribute to
  `active`
