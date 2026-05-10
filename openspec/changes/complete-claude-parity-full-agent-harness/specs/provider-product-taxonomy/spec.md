## ADDED Requirements

### Requirement: Provider product taxonomy SHALL separate product, transport, and runtime profile availability

Provider product selection SHALL remain a user-facing model access choice. Runtime profile availability SHALL be a separate product layer that states whether the selected product can be used as text-only preview, gateway-bridged employee, SDK-native full-agent employee, driver, or replacement.

Settings and runtime copy SHALL NOT imply that choosing `Claude`, `Codex`, `OpenAI API`, or a compatible provider grants full-agent authority. Full-agent authority requires a runtime profile with deterministic, benchmark, and release `.app` evidence.

#### Scenario: Claude product does not imply full-agent

- **WHEN** a user selects the `Claude` product
- **THEN** Settings shows model access and transport status separately from runtime profile availability
- **AND** the UI does not present the product as full-agent unless the Claude runtime profile has full-agent evidence

#### Scenario: Compatible provider cannot inherit full-agent status

- **WHEN** an Anthropic-compatible or OpenAI-compatible provider has gateway or SDK transport smoke evidence
- **THEN** that provider remains lower-tier for full-agent runtime until the same profile gates pass for that provider/host combination
- **AND** the product catalog does not reuse another provider's full-agent release evidence

#### Scenario: Runtime copy names missing gate

- **WHEN** a product has model transport evidence but no full-agent profile evidence
- **THEN** the UI describes the missing runtime gates, such as native tool evidence, MCP lifecycle, resume/fork, sandbox, benchmark, or release `.app` proof
- **AND** it does not use vague unavailable copy that makes the blocked state look permanent or complete
