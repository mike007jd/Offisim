## ADDED Requirements

### Requirement: Residual live gates require direct evidence
The runtime verification process SHALL require direct web or desktop evidence before residual gates from a runtime overhaul are marked complete.

#### Scenario: Web gate verified
- **WHEN** a residual gate is scoped to the web runtime
- **THEN** the verifier MUST run the path in a real browser against the local web app and record the observable UI or log evidence.

#### Scenario: Desktop gate verified
- **WHEN** a residual gate is scoped to desktop behavior
- **THEN** the verifier MUST build and launch the release `.app` and record evidence from the release desktop runtime.

#### Scenario: Negative path verified
- **WHEN** a residual gate requires a failure path that cannot be reached through normal UI controls
- **THEN** the verifier MUST use the smallest controlled fault-injection path possible and document that it is not a production behavior change.

### Requirement: Residual gates remain separate from archived implementation
The runtime verification process SHALL keep unresolved live verification work in a follow-up change rather than marking archived implementation tasks as complete without proof.

#### Scenario: Archived change has incomplete live gates
- **WHEN** an implementation change is archived with incomplete live verification tasks
- **THEN** the follow-up change MUST list the remaining gates, their required evidence, and any known blockers.

#### Scenario: Verification uncovers a real regression
- **WHEN** a follow-up live gate reproduces a product-impacting regression
- **THEN** the change MAY include the minimal fix required for that regression and MUST include the live evidence that proves the fix.
