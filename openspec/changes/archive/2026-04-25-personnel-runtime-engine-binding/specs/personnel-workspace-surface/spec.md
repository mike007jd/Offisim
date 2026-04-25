## MODIFIED Requirements

### Requirement: Appearance, Runtime, Skills tabs are placeholder shells

The `Skills` tab SHALL render as a labelled placeholder shell that announces its planned capability. It SHALL NOT include forms, controls, or edits; its content is delivered by a follow-up change. The tab trigger SHALL be visible and selectable so the IA shell is verifiable.

The `Appearance` tab is no longer a placeholder shell — see capability `personnel-appearance-live-preview`.

The `Runtime` tab is no longer a placeholder shell — see capability `personnel-runtime-engine-binding`.

#### Scenario: Skills tab renders placeholder copy
- **WHEN** the user activates the Skills tab
- **THEN** the tab content SHALL render a heading "Skills" with a status note that the in-Personnel skills experience is pending
- **AND** the existing `SkillBindingList` MAY be rendered as read-only context but SHALL NOT support edits

#### Scenario: Appearance tab is no longer a placeholder
- **WHEN** the user activates the Appearance tab
- **THEN** the tab content SHALL render the live customizer + preview surface defined in capability `personnel-appearance-live-preview`
- **AND** SHALL NOT render the `PlaceholderTab` shell

#### Scenario: Runtime tab is no longer a placeholder
- **WHEN** the user activates the Runtime tab
- **THEN** the tab content SHALL render the binding control surface defined in capability `personnel-runtime-engine-binding`
- **AND** SHALL NOT render the `PlaceholderTab` shell
