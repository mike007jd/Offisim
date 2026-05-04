## ADDED Requirements

### Requirement: Settings Provider and Runtime use workspace width in release

Settings Provider and Runtime tabs SHALL use the available Settings workspace width in Tauri release `.app`, subject to their own grid constraints, and SHALL NOT be globally capped by a centered `max-w-5xl` wrapper that leaves a large empty right gutter on desktop.

#### Scenario: Provider tab fills the workspace

- **WHEN** Settings → Provider is opened in release `.app` at desktop width
- **THEN** the provider configuration surface expands across the available content region
- **AND** there is no large unused right margin caused by a global max-width wrapper

#### Scenario: Runtime grids span available width

- **WHEN** Settings → Runtime is opened in release `.app` at desktop width
- **THEN** Execution, Theme, Density, Default runtime, Memory, and summarization controls use responsive multi-column grids across the content region
- **AND** the layout does not read as a narrow centered form

#### Scenario: Section density remains professional

- **WHEN** the user scans Provider or Runtime in release `.app`
- **THEN** vertical section gaps remain compact enough for repeated operational use
- **AND** Settings sections do not nest cards inside cards
