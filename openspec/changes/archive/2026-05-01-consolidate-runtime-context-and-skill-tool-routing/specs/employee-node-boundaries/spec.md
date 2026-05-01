## ADDED Requirements

### Requirement: Boss system prompt SHALL include the active company's employee roster

The boss agent's system prompt assembly SHALL include the active company's employee roster (employee_id, name, role_slug, brand_key for external employees) whenever the active company has at least one employee in `repos.employees.findByCompany(activeCompanyId)`. The boss SHALL NOT respond `"no employee database access"` (or equivalent) when the data layer reports a non-empty roster.

The roster injection SHALL be re-derived on:
- Active company switch
- Employee created / dismissed / hard-deleted within the active company
- Boss runtime initialization (cold start)

#### Scenario: Boss recognizes employees that exist in the active company
- **WHEN** the active company has 3 employees (e.g., Alex Chen / Maya Lin / Marcus Johnson) AND the user in team chat asks `"who's on my team?"`
- **THEN** the boss reply lists at least the names that the left-rail employee list shows
- **AND** the boss does NOT reply with `"no employee database access"` or any synonym indicating empty roster

#### Scenario: Boss recognizes a specific employee referenced by name
- **WHEN** the active company has employee `Alex Chen` AND the user asks the boss `"is Alex Chen available?"`
- **THEN** the boss reply acknowledges Alex Chen as a known employee (not "no such employee")

#### Scenario: Empty roster does not trigger the regression event
- **WHEN** the active company has 0 employees AND the boss assembles its system prompt
- **THEN** the roster section is empty / absent
- **AND** no `boss.employee-context.empty` event fires (empty company is not a regression)

### Requirement: Boss employee-context regressions SHALL emit an observable runtime event

When the data layer reports a non-empty employee roster for the active company but the boss's assembled system prompt receives 0 employees, the runtime SHALL emit a `runtime_event` with `event_type='boss.employee-context.empty'` and payload `{ companyId, employeeCount, expectedAtLeast: 1 }`. This event distinguishes a true regression (DB has employees, prompt has zero) from a benign empty company.

The event SHALL fire at most once per `companyId` per session to avoid log spam.

#### Scenario: True regression fires the event
- **WHEN** `repos.employees.findByCompany(activeCompanyId)` returns 3 rows AND the boss prompt assembly receives 0 employees
- **THEN** a `boss.employee-context.empty` event is emitted with payload `{ companyId, employeeCount: 0, expectedAtLeast: 1 }`

#### Scenario: Benign empty company does NOT fire the event
- **WHEN** `repos.employees.findByCompany(activeCompanyId)` returns 0 rows AND the boss prompt assembly receives 0 employees
- **THEN** no `boss.employee-context.empty` event is emitted (empty roster matches DB state, not a regression)
