## ADDED Requirements

### Requirement: Settings controller SHALL preserve product/transport/runtime separation

Settings state, save orchestration, dirty tracking, and runtime controls SHALL keep provider product, access mode, model transport, employee runtime default, full-agent profile availability, driver mode, and replacement mode as distinct concepts. Saving a provider product or `executionLane` SHALL NOT silently enable full-agent employee, driver, or replacement authority.

Unavailable reasons SHALL be shown at the layer they belong to: product unavailable, transport unavailable, runtime profile unavailable, trusted-host missing, credential missing, benchmark missing, or release `.app` evidence missing.

#### Scenario: Provider save does not promote full-agent

- **WHEN** a user saves a provider config with `executionLane = "claude-agent-sdk"` or `openai-agents-sdk`
- **THEN** Settings persists only model transport selection
- **AND** employee full-agent profile availability remains unchanged unless the Runtime profile control explicitly selects a verified profile

#### Scenario: Runtime tab shows profile gates

- **WHEN** Settings Runtime displays employee runtime defaults or full-agent options
- **THEN** each option shows tier, availability, missing gates, and evidence references
- **AND** unavailable full-agent, driver, or replacement routes are disabled

#### Scenario: Dirty tracking includes runtime profile changes

- **WHEN** an admin changes employee runtime default, driver/replacement policy, or full-agent profile selection
- **THEN** Settings dirty tracking and save orchestration treat it as runtime policy state
- **AND** it is not hidden inside provider/product snapshot fields
