## MODIFIED Requirements

### Requirement: App shell supports desktop tablet and narrow viewports

The main app shell SHALL define stable desktop, tablet, and narrow
layout behavior without horizontal document overflow. The active tier
SHALL be determined by `useLayoutTier()` (`narrow ≤768`, `tablet
769–1280`, `desktop >1280`) — Tailwind utility breakpoints SHALL NOT
be the trigger for layout topology decisions. At `390px` viewport
width, the user SHALL be able to reach the active screen's primary
action without content being clipped by side rails, collapse handles,
overlays, or fixed footers. At desktop and tablet widths in Office,
the right rail (chat surface) SHALL render expanded by default
unless the user has explicitly collapsed it (preference persisted in
`localStorage`).

After the V3 shell change, the Office workspace SHALL NOT render a
global bottom status-bar footer. Run-state, run cost, token usage, and
git branch are presented diegetically (the `.scene-cost` stage readout,
the stage run-axis Live entry, and the left-rail GitWorkbench),
not in an app-level fixed footer. Non-Office screens that legitimately
keep a sticky footer are unaffected.

#### Scenario: Desktop workspace retains full shell
- **WHEN** the viewport is `1440x900` and the active workspace is Office
- **THEN** the app renders the titlebar, topbar (scope-bar + centered
  peer nav + iconbar), left rail (File/SOPs/Git widget), central
  scene/stage area, and right chat rail without overlapping the primary
  scene or chat input controls
- **AND** the right rail SHALL render expanded by default
- **AND** there SHALL be NO global bottom status-bar footer — run-state,
  cost, tokens, and branch are diegetic (stage readout / run-axis Live /
  left-rail GitWorkbench)

#### Scenario: Tablet workspace keeps right rail expanded
- **WHEN** the viewport is `1280x800` and the active workspace is Office
  with no persisted right rail preference
- **THEN** AppLayout SHALL render the right rail expanded (not collapsed)
- **AND** SHALL preserve visible peer workspace navigation, the active
  workspace body, and the current primary action
- **AND** MAY collapse other secondary rails or handles per the per-
  workspace tier decision table

#### Scenario: Narrow viewport has no horizontal overflow
- **WHEN** the viewport is `390x844` for any workspace
- **THEN** `document.documentElement.scrollWidth` SHALL be less than or
  equal to `window.innerWidth`
- **AND** the active screen's primary CTA SHALL be visible or reachable
  by vertical scrolling and clickable without pointer interception

### Requirement: Fixed bottom action areas reserve readable content space

Screens with sticky or fixed bottom actions SHALL reserve enough bottom padding in the scrollable content area so the last form field, preview, validation message, or card is not obscured by the footer. The **Office workspace SHALL NOT have a global bottom status-bar footer**: run cost, token usage, run-state, and git branch are presented diegetically (the `.scene-cost` stage readout, the run-axis Live entry, and the left-rail GitWorkbench), not in an app-level fixed footer. This requirement therefore governs only screens that legitimately keep a sticky footer (Employee Creator, Settings save area, Company Editor), not Office.

#### Scenario: Employee Creator footer does not cover form content
- **WHEN** Employee Creator is open and the user scrolls to the bottom
- **THEN** the last editable field and validation message remain fully visible above the bottom action bar

#### Scenario: Settings save area does not cover controls
- **WHEN** Settings has unsaved or invalid changes and the user scrolls to the bottom of a tab
- **THEN** the save area remains visible without covering the last control in the active tab

#### Scenario: Company Editor footer does not cover preview content
- **WHEN** Company Editor is open at desktop or narrow width
- **THEN** footer actions remain available and the editable content above them retains readable spacing

#### Scenario: Office has no global status-bar footer
- **WHEN** the Office workspace is open at any tier
- **THEN** there is no app-level bottom status bar reserving footer space
- **AND** cost / tokens / run-state / branch are presented diegetically inside the stage and left rail
