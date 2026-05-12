# Office Kanban Workbench

## ADDED Requirements

### Requirement: Kanban Is Always Discoverable

Office SHALL render a Kanban top chip even when the active project has zero Kanban cards. The collapsed chip SHALL visually match `/Users/haoshengli/Downloads/kanban收起.png`: a centered, lightweight chip under the top navigation that only exposes the board icon, `Kanban`, and the disclosure arrow.

#### Scenario: Empty Project

- **WHEN** the active project has no cards
- **THEN** the top chip remains visible
- **AND** opening the chip shows empty columns with add-card entry points

### Requirement: Kanban Is A Task Execution View

Office SHALL present Kanban as a five-column task execution board with `Todo`, `Doing`, `Blocked`, `Review`, and `Done` columns. The expanded panel SHALL visually match `/Users/haoshengli/Downloads/kanban展开.png`: a shallow glass panel dropping from the navigation area, spanning the center scene between the Team and Workspace rails, with a centered collapse notch and product-grade card density.

#### Scenario: User Manages Cards

- **WHEN** the user opens the board
- **THEN** they can create a card in each column, edit title/note/assignee/blocked reason, and move cards through valid transitions

### Requirement: Kanban Open State Is Shared

Office SHALL use one `officeState.kanbanOpen` state for `/kanban`, `/board`, `/k`, the top chip, and the Tasks tab board entry.

#### Scenario: Shortcut Opens Board

- **WHEN** the user triggers `/k`
- **THEN** the same board opens as if the top chip was clicked
