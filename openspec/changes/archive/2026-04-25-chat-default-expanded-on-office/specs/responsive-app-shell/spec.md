## MODIFIED Requirements

### Requirement: App shell supports desktop tablet and narrow viewports
The main app shell SHALL define stable desktop, tablet, and narrow layout behavior without horizontal document overflow. At `390px` viewport width, the user SHALL be able to reach the active screen's primary action without content being clipped by side rails, collapse handles, overlays, or fixed footers. At desktop and tablet widths in Office, the right rail (chat / tasks surface) SHALL render expanded by default unless the user has explicitly collapsed it (preference persisted in `localStorage`).

#### Scenario: Desktop workspace retains full shell
- **WHEN** the viewport is `1440x900` and the active workspace is Office
- **THEN** the app renders Header, left panel, central scene/workspace area, right task panel, and StatusBar without overlapping the primary scene or task input controls
- **AND** the right rail SHALL render expanded by default

#### Scenario: Tablet workspace keeps right rail expanded
- **WHEN** the viewport is `1280x800` and the active workspace is Office with no persisted right rail preference
- **THEN** AppLayout SHALL render the right rail expanded (not collapsed)
- **AND** SHALL preserve visible peer workspace navigation, the active workspace body, and the current primary action
- **AND** MAY collapse other secondary rails or handles (e.g. left personnel rail behavior is unchanged by this requirement)

#### Scenario: Narrow viewport has no horizontal overflow
- **WHEN** the viewport is `390x844`
- **THEN** `document.documentElement.scrollWidth` SHALL be less than or equal to `window.innerWidth`
- **AND** the active screen's primary CTA SHALL be visible or reachable by vertical scrolling and clickable without pointer interception
