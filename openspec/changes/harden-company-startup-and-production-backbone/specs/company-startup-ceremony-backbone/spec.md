## ADDED Requirements

### Requirement: Company startup lifecycle is explicit and non-work
The system SHALL emit a company-scoped startup lifecycle when a company is created or first activated after creation. Startup lifecycle events SHALL be separate from graph execution events and MUST NOT imply task execution, employee assignment, model streaming, tool execution, or deliverable production.

The lifecycle SHALL include stable event types for requested, started, completed, skipped, and failed states. Each event SHALL include `companyId`, a startup ceremony id, source (`template` or `custom`), provider readiness, timestamp, and whether the lifecycle is replaying a previously completed startup.

#### Scenario: Template company requests startup lifecycle
- **WHEN** a template company is materialized successfully
- **THEN** the system SHALL emit `company.startup.requested` for the new company
- **AND** it SHALL NOT emit `task.assignment.dispatched`, `plan.created`, `employee.state.changed`, `llm.stream.chunk`, or `deliverable.created` solely because the startup lifecycle began

#### Scenario: Custom company requests startup lifecycle
- **WHEN** a custom empty company is created successfully
- **THEN** the system SHALL emit `company.startup.requested` with source `custom`
- **AND** no employee work state SHALL be created unless the user later starts real work

### Requirement: Startup ceremony state is persisted per company
The system SHALL persist per-company startup ceremony state so startup completion, skip, failure, and replay state survive app restart and company switching. This state SHALL be independent from account-wide tour completion and MUST NOT be represented only as ephemeral React state.

#### Scenario: Completed startup does not auto-repeat
- **WHEN** company A has startup state `completed`
- **AND** the user switches away and back to company A
- **THEN** the system SHALL NOT automatically request another startup lifecycle for company A

#### Scenario: Replay is explicit
- **WHEN** a startup ceremony is replayed after completion
- **THEN** the emitted lifecycle payload SHALL include `isReplay: true`
- **AND** replay SHALL NOT reset first-task, deliverable, or provider readiness flags

### Requirement: Providerless startup remains truthful
When no provider credential is configured, the system SHALL allow startup lifecycle, company exploration, employee/SOP/layout/project editing, and guide/explainer state. It MUST NOT run a demo graph, stream canned assistant output, fabricate task progress, fabricate employee work states, or create demo deliverables.

#### Scenario: No provider does not run graph
- **WHEN** a company startup lifecycle begins with no provider configured
- **THEN** graph orchestration SHALL remain unavailable for real work
- **AND** the startup lifecycle SHALL NOT call the Boss, Manager, PM, dispatcher, or employee graph nodes

#### Scenario: No provider does not mark first task
- **WHEN** startup lifecycle completes without provider credentials
- **THEN** company onboarding state SHALL NOT mark `first_task_sent`
- **AND** SHALL NOT mark `first_deliverable_seen`

### Requirement: Real work starts only from explicit user intent
After startup lifecycle completes, the system SHALL require explicit user intent to start real AI work. Company creation, provider connection, startup completion, employee selection, or scene interaction SHALL NOT automatically start a graph run.

#### Scenario: Provider connected after startup
- **WHEN** a user connects a provider after startup lifecycle has completed
- **THEN** the system SHALL become ready for real work
- **AND** SHALL NOT auto-send a task or auto-start an employee run

#### Scenario: Employee selection is not work
- **WHEN** the user selects or inspects an employee after startup lifecycle
- **THEN** the system MAY prepare direct-chat context
- **AND** SHALL NOT start a graph run until the user sends a message or invokes a typed run action
