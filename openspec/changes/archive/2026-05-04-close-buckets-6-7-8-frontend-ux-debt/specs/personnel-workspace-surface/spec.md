## ADDED Requirements

### Requirement: Personnel detail layout uses the full editor pane in release

The Personnel detail surface SHALL use the available editor pane width in Tauri release `.app` instead of centering all editable content in a narrow profile column. The employee detail header SHALL remain a horizontal information row at desktop width, and all inspector tabs SHALL preserve the same pane-width layout budget.

#### Scenario: Detail header is horizontal at desktop width

- **WHEN** Personnel is opened in release `.app` at desktop width and an employee is selected
- **THEN** the avatar renders on the left, the name/role text renders in the middle, and status/source chips render on the right
- **AND** the header does NOT collapse into a centered vertical stack

#### Scenario: Profile tab is multi-column at desktop width

- **WHEN** the Profile tab is active at desktop width
- **THEN** Identity / Persona / Config / Skills content uses the editor pane width with multi-column layout where space allows
- **AND** the tab body is NOT clamped to a centered `max-w-2xl` style column

#### Scenario: Secondary tabs span the same pane

- **WHEN** the user switches through Appearance, Runtime, Skills, Memory, and History
- **THEN** each tab uses the same right-side editor pane width as Profile
- **AND** forms/lists do not revert to a narrow centered column
