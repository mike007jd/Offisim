## ADDED Requirements

### Requirement: Completion verifier SHALL consume route and evidence classes

Completion verification SHALL evaluate both task intent and runtime evidence class. A task that requires local productivity work SHALL complete only from accepted evidence belonging to an allowed class for that task and runtime profile: Offisim gateway evidence, SDK-native evidence with release proof for that task family, gateway-bridged evidence executed by Offisim, or explicitly scoped text-only evidence for pure text tasks.

Final text, generic provider success, native SDK success without profile release proof, and mismatched task-run identity SHALL NOT satisfy local productivity tasks.

#### Scenario: SDK-native edit without release proof is blocked

- **WHEN** a SDK-native runtime reports that it edited a file
- **AND** the selected profile lacks release proof for SDK-native file/edit evidence
- **THEN** completion verification blocks the task
- **AND** the activity stream records the missing evidence gate

#### Scenario: Gateway bridge requires matching task identity

- **WHEN** a native agent proposes a gateway-bridged file, shell, MCP, git, artifact, memory, todo, or skill action
- **AND** Offisim executes the boundary under the current task-run identity
- **THEN** completion verification may accept the gateway evidence for that task family
- **AND** a mismatched task-run, profile id, or checkpoint id is rejected

#### Scenario: Pure text remains lightweight

- **WHEN** task intent classifies a request as pure text
- **THEN** completion verification may accept text-only evidence from an allowed text profile
- **AND** the task is not forced through local-tool gates that do not apply
