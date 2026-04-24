# backend-harness-verification Specification

## Purpose
Defines the backend-only verification harness that proves provider-by-lane support with smoke, load, and edge evidence before new lane exposure ships.

## Requirements

### Requirement: Offisim SHALL support backend-only harness verification

Offisim SHALL provide a backend-style harness that can execute smoke, load, and edge-case validation without going through the game frontend or office scene runtime.

The harness SHALL be able to instantiate an in-memory or trusted-runtime Offisim orchestration stack, run real provider calls, and report structured pass/fail outcomes.

#### Scenario: Smoke run without frontend

- **WHEN** an engineer runs the harness against a configured provider and execution lane
- **THEN** the harness executes a real Offisim request without requiring the game frontend
- **AND** the result includes latency, content/error, and execution identifiers

#### Scenario: Shared-thread load run

- **WHEN** an engineer runs a shared-thread load scenario
- **THEN** multiple requests hit the same thread/runtime binding
- **AND** queue-depth, timeout, or serialization failures are reported distinctly from provider failures

### Requirement: Harness verification SHALL cover provider × lane matrices

Harness commands SHALL accept both provider configuration and execution lane selection. Verification output SHALL identify which provider, model, endpoint, and lane were tested.

Offisim SHALL treat provider/lane support as verified only after the corresponding harness suite passes.

#### Scenario: Same provider tested across two lanes

- **WHEN** a preset supports both `gateway` and `claude-agent-sdk`
- **THEN** harness can run smoke/load suites for each lane independently
- **AND** the summary identifies the lane for every result row

#### Scenario: Unsupported lane is blocked before execution

- **WHEN** a harness invocation requests a lane the selected preset does not support
- **THEN** the harness fails fast with a configuration error
- **AND** no provider call is attempted

### Requirement: Harness output SHALL classify boundary and provider failures separately

Harness reporting SHALL distinguish Offisim runtime failures from upstream provider failures. At minimum, reports SHALL separate:

- configuration errors
- runtime queue/timeout/cancellation failures
- provider authentication failures
- provider quota/rate-limit failures
- provider tool/protocol incompatibility failures

#### Scenario: Provider 429 is not misclassified as runtime failure

- **WHEN** a real provider responds with a rate-limit or quota error during a harness run
- **THEN** the summary records it as a provider-side failure
- **AND** it is not reported as an Offisim orchestration regression

#### Scenario: Queue-depth rejection is not misclassified as provider failure

- **WHEN** a shared-thread load run exceeds Offisim queue depth protection
- **THEN** the summary records an Offisim runtime boundary rejection
- **AND** it is not counted as a provider failure
