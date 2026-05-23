## ADDED Requirements

### Requirement: Natural production prompts create durable artifact intent
The deliverable intent layer SHALL recognize natural production requests for durable business outputs, not only explicit file/export wording. Requests to write, draft, create, produce, prepare, generate, or build production objects such as reports, plans, briefs, proposals, PRDs, job descriptions, decks, checklists, analyses, tables, CSVs, HTML pages, and documents SHALL be eligible for deliverable creation unless the request is clearly read-only or local-file inspection.

#### Scenario: Report prompt creates artifact intent
- **WHEN** the user asks `Write a short market analysis report on the AI coding tools space`
- **THEN** deliverable intent SHALL classify the request as a new durable artifact request
- **AND** it SHALL NOT require the word `file`, `export`, or `download`

#### Scenario: Read-only analysis does not force artifact
- **WHEN** the user asks `Analyze this file and explain what it contains`
- **THEN** read-only local file operation detection SHALL take precedence
- **AND** no new deliverable SHALL be required solely because the word `analyze` appears

### Requirement: Deliverables attach by run/task identity first
The system SHALL attach deliverables to committed messages and output surfaces by explicit run/task identity when available. Timestamp or employee/thread matching MAY remain as a fallback, but it MUST NOT be the primary match path when `taskRunId`, `runId`, or equivalent run-scope identity exists.

#### Scenario: Deliverable event includes task run
- **WHEN** an employee creates a deliverable with `taskRunId`
- **THEN** the chat/output attachment logic SHALL match the deliverable to the message or run for that `taskRunId`
- **AND** SHALL NOT attach it to another employee message merely because it is nearby in time

### Requirement: Starter production prompts request artifacts truthfully
Fixed starter or template production prompts that describe reports, plans, job descriptions, briefs, or similar durable outputs SHALL include enough task intent for the runtime to produce a deliverable through the normal artifact path. They MUST NOT rely on UI-only hidden behavior or fake outputs.

#### Scenario: Launch plan starter becomes deliverable
- **WHEN** a starter prompt asks to draft a launch plan
- **THEN** the runtime SHALL treat it as durable artifact intent
- **AND** any resulting deliverable SHALL be created by the real employee execution path
