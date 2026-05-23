## ADDED Requirements

### Requirement: Company creation starts a non-work startup lifecycle
After a company create action successfully persists the company and any selected template materialization, the company creation flow SHALL request the company startup lifecycle defined by `company-startup-ceremony-backbone`. This SHALL happen for template-created companies and custom empty companies.

#### Scenario: Start Company requests startup
- **WHEN** `Start Company` creates and activates a company successfully
- **THEN** the company creation flow SHALL request startup lifecycle for that company
- **AND** it SHALL NOT start real AI work automatically

#### Scenario: Create Your Own requests startup
- **WHEN** custom company creation succeeds
- **THEN** the company creation flow SHALL request startup lifecycle with source `custom`
- **AND** it SHALL NOT require employees or SOPs to exist

### Requirement: Company creation works without provider credentials
Company creation and template materialization SHALL work in repos-only runtime without provider credentials. The absence of provider credentials SHALL block real graph execution but MUST NOT block creating, activating, switching, or editing companies.

#### Scenario: Providerless template creation
- **WHEN** no provider credentials are configured
- **AND** the user creates a template company
- **THEN** the company, employees, SOPs, layout, zones, and prefab instances SHALL persist normally
- **AND** graph execution SHALL remain unavailable until provider credentials are configured

### Requirement: Company creation does not mark work-completion onboarding flags
Company creation, startup lifecycle request, startup completion, and providerless exploration SHALL NOT mark first task or first deliverable onboarding flags. Those flags SHALL be written only by real user-initiated work and real deliverable creation.

#### Scenario: Startup completion does not mark deliverable seen
- **WHEN** a newly created company completes startup lifecycle
- **THEN** `first_task_sent` SHALL remain false until a user-initiated graph run starts
- **AND** `first_deliverable_seen` SHALL remain false until a real deliverable is created and surfaced
