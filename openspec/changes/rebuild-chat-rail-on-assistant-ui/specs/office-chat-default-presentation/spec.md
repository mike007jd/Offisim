## MODIFIED Requirements

### Requirement: Right rail defaults to expanded for office on first visit

On first visit to the Office workspace (no persisted user preference) the right rail (`eventLog` slot containing `RightSidebar`, now a single conversation axis with **no tab bar**) SHALL render expanded for any non-narrow viewport (`width > 768px`). The prior outer `Chat ↔ Tasks` tab strip (and the `Inspector` / `Git` peer tabs) SHALL be removed; the rail SHALL render one vertical column — `.chat-head` (back chevron + title + tools) → the assistant-ui message thread (`.messages`) → an inline collapsible run-record (Activity + Plan sedimented into the timeline) → a thread-scoped `.conv-outputs` deliverables block → the `.composer`. Inspector content lives in the Personnel workspace; the Git widget moves to the left rail (Phase 2 `rebuild-office-shell-v3`); task content is expressed as the inline run-record + outputs block. The chat input within the right rail SHALL be reachable and clickable without requiring the user to first expand a collapsed bar.

#### Scenario: Desktop first visit shows expanded conversation column

- **WHEN** the user opens Office at viewport `1440x900` with no `offisim-rightrail-open` value in `localStorage`
- **THEN** the right rail SHALL render at full width with the single conversation column (no `Chat/Inspector/Tasks/Git` tab strip)
- **AND** the chat input field SHALL be visible and accept keyboard input without an extra click

#### Scenario: Tablet first visit shows expanded conversation column

- **WHEN** the user opens Office at viewport `1280x800` with no `offisim-rightrail-open` value in `localStorage`
- **THEN** the right rail SHALL render expanded (not the `44px` collapsed bar) as the single conversation column
- **AND** the chat input SHALL be visible and immediately usable

#### Scenario: Narrow viewport keeps right rail collapsed

- **WHEN** the user opens Office at viewport `390x844`
- **THEN** the right rail SHALL remain collapsed (or be replaced by the mobile `ChatDrawer` per existing responsive rules)
- **AND** the default-expanded behavior SHALL NOT apply

## REMOVED Requirements

### Requirement: RightSidebar outer Tabs SHALL declare min-height floor

**Reason**: The outer `Chat ↔ Tasks` tabs (and `Inspector` / `Git` peer tabs) are removed; the rail is now a single conversation axis with no tab bar, so a tab-swap min-height floor no longer applies. Layout-shift stability for the single axis is re-specified by the ADDED `Single-axis rail SHALL be layout-shift stable without tab forceMount` requirement.

**Migration**: Layout stability is now provided by the conversation column reserving a minimum content height and the assistant-ui thread viewport absorbing growth via internal `overflow-y: auto`, instead of a `min-h-[640px]` floor on a `<Tabs>` element.

### Requirement: RightSidebar TabsContent SHALL use `forceMount + TABS_RETAIN_STATE_CLASS` constants

**Reason**: With the tab bar removed there are no `<TabsContent>` panels to retain, so the `forceMount + TABS_RETAIN_STATE_CLASS` discipline (and the `'data-[state=inactive]:hidden'` literal prohibition) no longer have a target in `RightSidebar.tsx`. The single-axis no-tab-retain expectation is re-specified by the ADDED `Single-axis rail SHALL be layout-shift stable without tab forceMount` requirement.

**Migration**: `RightSidebar.tsx` SHALL contain zero `<TabsContent>` and zero tab-retain literals; the single conversation column never swaps tabbed panels.

### Requirement: StreamingBubble SHALL bound height and use overscroll-contain

**Reason**: The hand-rolled `StreamingBubble` is replaced by assistant-ui message/reasoning parts in this phase, so the height bound is no longer expressed on `StreamingBubble.tsx`. The height/overscroll bound is re-specified on the assistant-ui parts by the ADDED `assistant-ui message and reasoning parts SHALL bound height and use overscroll-contain` requirement.

**Migration**: The streamed-answer and reasoning height bounds (previously the `max-h-stream-content` / `max-h-reasoning-content` semantic-token classes on `StreamingBubble`) move onto the assistant-ui answer part and reasoning part respectively.

## ADDED Requirements

### Requirement: Single-axis rail SHALL be layout-shift stable without tab forceMount

Because the rail no longer swaps tabbed panels, layout-shift stability SHALL be achieved by the conversation column reserving a minimum content height and by the assistant-ui thread viewport absorbing growth via internal `overflow-y: auto` (NOT by `forceMount + TABS_RETAIN_STATE_CLASS` on tab panels, which no longer exist). Switching threads or toggling the inline run-record SHALL NOT shift the surrounding workspace center (3D scene, side panel). `RightSidebar.tsx` SHALL contain zero `<TabsContent>` for the removed Chat/Inspector/Tasks/Git tabs and zero `'data-[state=inactive]:hidden'` literals tied to them.

#### Scenario: Thread switch and run-record toggle are layout-stable

- **WHEN** the user switches threads or expands/collapses the inline run-record
- **THEN** the rail's outer rendered height does not jump and the 3D scene / side panel do not shift
- **AND** content growth is absorbed by the thread viewport's internal scroll, not the outer rail

#### Scenario: No tab strip or tab-retain literals remain

- **WHEN** auditing `RightSidebar.tsx` with Office open
- **THEN** there is no `Chat/Inspector/Tasks/Git` tab strip and no `<TabsContent>` for those tabs
- **AND** there are zero `'data-[state=inactive]:hidden'` literals tied to the removed tabs
- **AND** the rail renders head → messages → run-record → outputs → composer as one column

### Requirement: assistant-ui message and reasoning parts SHALL bound height and use overscroll-contain

The streamed-content height bound formerly on `StreamingBubble` SHALL be expressed on the assistant-ui message thread, carrying the existing semantic-token classes: a streamed answer part SHALL apply `max-h-stream-content` with `overflow-y-auto` + `overscroll-contain`, and the reasoning part SHALL apply the tighter `max-h-reasoning-content` with `overflow-y-auto` + `overscroll-contain`. This stops scroll-chain rubber-banding into the rail's outer scroll container.

#### Scenario: Long streamed answer scrolls inside the message part

- **WHEN** the model streams a response exceeding the `max-h-stream-content` ceiling of vertical text
- **THEN** the answer part renders bounded by `max-h-stream-content` with inner `overflow-y: auto`
- **AND** scrolling inside it does not advance the rail's outer scroll container past its own bottom

#### Scenario: Reasoning part uses the tighter bound

- **WHEN** the model emits reasoning in addition to an answer
- **THEN** the reasoning part renders bounded by `max-h-reasoning-content` with `overflow-y: auto` and `overscroll-contain`
- **AND** the reasoning part does not consume more vertical space than the answer that follows
