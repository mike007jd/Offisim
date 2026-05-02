## MODIFIED Requirements

### Requirement: Boss system prompt SHALL include the active company's employee roster

The boss agent's system prompt assembly SHALL include the active company's employee roster (employee_id, name, role_slug, brand_key for external employees) whenever the active company has at least one employee in `repos.employees.findByCompany(activeCompanyId)`. The boss SHALL NOT respond `"no employee database access"` (or equivalent) when the data layer reports a non-empty roster.

The runtime context `companyId` used by Boss prompt assembly SHALL be synchronized on active company changes. `repos.employees.findByCompany(runtimeCtx.companyId)` SHALL therefore use the same active-company boundary as the UI employee list. Boss prompt assembly MUST NOT reuse a stale company ID after the user switches company.

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

#### Scenario: Active company switch refreshes Boss runtime context
- **WHEN** the user switches from company A to company B
- **AND** company B's UI employee list contains `Alex Chen`
- **THEN** the next Boss team-chat prompt uses company B as `runtimeCtx.companyId`
- **AND** the prompt roster contains the same employees shown by the UI list for company B

#### Scenario: Multi-company roster does not leak
- **WHEN** company A has employee `Maya Lin` and company B has employee `Alex Chen`
- **AND** the user switches from company A to company B before asking Boss `"who's on my team?"`
- **THEN** the Boss prompt roster contains `Alex Chen`
- **AND** it does not contain `Maya Lin`

### Requirement: Boss employee-context regressions SHALL emit an observable runtime event

When the data layer reports a non-empty employee roster for the active company but the boss's assembled system prompt receives 0 employees, the runtime SHALL emit a `runtime_event` with `event_type='boss.employee-context.empty'` and payload `{ companyId, employeeCount, expectedAtLeast: 1 }`. This event distinguishes a true regression (DB has employees, prompt has zero) from a benign empty company.

The event SHALL fire at most once per `companyId` per `EventBus` session to avoid log spam. Suppression state MUST be isolated per event bus and MUST NOT use one global set shared across independent sessions.

#### Scenario: True regression fires the event
- **WHEN** `repos.employees.findByCompany(activeCompanyId)` returns 3 rows AND the boss prompt assembly receives 0 employees
- **THEN** a `boss.employee-context.empty` event is emitted with payload `{ companyId, employeeCount: 0, expectedAtLeast: 1 }`

#### Scenario: Benign empty company does NOT fire the event
- **WHEN** `repos.employees.findByCompany(activeCompanyId)` returns 0 rows AND the boss prompt assembly receives 0 employees
- **THEN** no `boss.employee-context.empty` event is emitted (empty roster matches DB state, not a regression)

#### Scenario: Suppression is isolated per event bus
- **WHEN** one runtime event bus has already emitted `boss.employee-context.empty` for company A
- **AND** a second independent event bus hits the same regression for company A
- **THEN** the second event bus still emits its own first diagnostic event
- **AND** the first event bus continues suppressing duplicate diagnostics for its own session

## ADDED Requirements

### Requirement: Boss skill-mutation routing SHALL stay internal and narrowly defensive

When Boss chooses an employee to handle skill mutation work, the routing helper SHALL exclude employees with `is_external === 1`; external A2A employees MUST NOT receive skill install, edit, fork, create, or sync mutation tasks. If the LLM wrong-routes a skill mutation as `direct_reply`, the defensive override SHALL reroute only that skill-mutation direct-reply case. It SHALL NOT override unrelated direct replies.

#### Scenario: External employee is not selected for skill mutation
- **WHEN** the active company roster contains one internal employee and one external A2A employee
- **AND** Boss needs to route a `create_skill_from_scratch` or `edit_skill_body` task
- **THEN** the selected employee is internal
- **AND** the external employee is not assigned the skill mutation

#### Scenario: Direct-reply override applies only to skill mutation
- **WHEN** the LLM returns `direct_reply` for a request that requires a skill mutation
- **THEN** Boss reroutes to the internal skill-mutation employee
- **AND** emits the normal runtime activity for the reroute

#### Scenario: Normal direct reply is not overridden
- **WHEN** the LLM returns `direct_reply` for a normal informational team-chat answer
- **THEN** Boss keeps the direct reply
- **AND** no skill-mutation defensive override is applied
