## MODIFIED Requirements

### Requirement: Profile tab carries forward existing edit content

The `Profile` tab SHALL render the form fields that were previously hosted by `EmployeeEditorDialog` *except for appearance editing*: identity (name / role / status / workstation assignment), persona (expertise, style, communication frequency, risk preference, decision style, custom instructions), config (provider / model / temperature / max tokens / skill bindings / tool permissions), and the system-prompt preview disclosure. The tab SHALL save through the existing `useEmployeeEditor` `save()` and `updateField()` API. Appearance editing has moved to the `Appearance` tab.

#### Scenario: Saving from Profile tab persists employee changes
- **WHEN** the user changes the role in the Profile tab and clicks Save
- **THEN** `useEmployeeEditor.save()` SHALL run
- **AND** the employee row SHALL update in the repository
- **AND** the list rail SHALL reflect the new role on next render

#### Scenario: Delete confirm renders inline in Profile tab
- **WHEN** the user clicks Delete on the Profile tab
- **THEN** an inline confirm affordance SHALL appear inside the Profile tab content
- **AND** no separate dialog modal SHALL open

#### Scenario: Profile tab does not host AvatarCustomizer
- **WHEN** the Profile tab renders for either an internal or external employee
- **THEN** no `AvatarCustomizer` component SHALL render inside the Profile tab
- **AND** no `data-testid="external-avatar-disabled"` banner SHALL render inside the Profile tab
- **AND** the user SHALL find appearance controls in the `Appearance` tab instead

### Requirement: Appearance, Runtime, Skills tabs are placeholder shells

The `Runtime` and `Skills` tabs SHALL render in this change as labelled placeholder shells that announce their planned capability. They SHALL NOT include forms, controls, or edits; their content is delivered by follow-up changes (`personnel-runtime-engine-binding`, future skills binding work). The tab triggers SHALL be visible and selectable so the IA shell is verifiable. The `Appearance` tab is no longer a placeholder shell — see capability `personnel-appearance-live-preview`.

#### Scenario: Runtime tab renders placeholder copy
- **WHEN** the user activates the Runtime tab
- **THEN** the tab content SHALL render a heading "Runtime" with a status note that engine binding ships in a follow-up change

#### Scenario: Skills tab renders placeholder copy
- **WHEN** the user activates the Skills tab
- **THEN** the tab content SHALL render a heading "Skills" with a status note that the in-Personnel skills experience is pending
- **AND** the existing `SkillBindingList` MAY be rendered as read-only context but SHALL NOT support edits

#### Scenario: Appearance tab is no longer a placeholder
- **WHEN** the user activates the Appearance tab
- **THEN** the tab content SHALL render the live customizer + preview surface defined in capability `personnel-appearance-live-preview`
- **AND** SHALL NOT render the `PlaceholderTab` shell
