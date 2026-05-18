# runtime-live-verification-gates

## MODIFIED Requirements

### Requirement: Residual live gates require direct evidence

The runtime verification process SHALL require direct release desktop evidence before residual gates from a runtime overhaul are marked complete. Because Offisim is Tauri-only after this change, web/browser evidence SHALL NOT satisfy release verification.

#### Scenario: Desktop gate verified

- **WHEN** a residual gate is scoped to runtime or desktop behavior
- **THEN** the verifier MUST build and launch the release `.app`
- **AND** the verifier MUST record evidence from the release desktop runtime

#### Scenario: Web evidence is not a release gate

- **WHEN** a verifier has only dev server, localhost, standalone browser, or removed web-app evidence
- **THEN** the release gate remains incomplete
- **AND** the corresponding OpenSpec task is not checked

#### Scenario: Negative path verified

- **WHEN** a residual gate requires a failure path that cannot be reached through normal UI controls
- **THEN** the verifier MUST use the smallest controlled fault-injection path possible and document that it is not a production behavior change

### Requirement: Residual gates remain separate from archived implementation

The runtime verification process SHALL keep unresolved live verification work in a follow-up change rather than marking archived implementation tasks as complete without proof. In the Tauri-only architecture, unresolved web-only gates SHALL be closed by removing the web product requirement, not by marking web runtime evidence as passed.

#### Scenario: Archived change has incomplete live gates

- **WHEN** an implementation change is archived with incomplete live verification tasks
- **THEN** the follow-up change MUST list the remaining gates, their required evidence, and any known blockers

#### Scenario: Verification uncovers a real regression

- **WHEN** a follow-up live gate reproduces a product-impacting desktop regression
- **THEN** the change MAY include the minimal fix required for that regression and MUST include the release `.app` evidence that proves the fix

