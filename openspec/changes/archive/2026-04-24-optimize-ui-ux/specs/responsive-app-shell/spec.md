## ADDED Requirements

### Requirement: App shell supports desktop tablet and narrow viewports
The main app shell SHALL define stable desktop, tablet, and narrow layout behavior without horizontal document overflow. At `390px` viewport width, the user SHALL be able to reach the active screen's primary action without content being clipped by side rails, collapse handles, overlays, or fixed footers.

#### Scenario: Desktop workspace retains full shell
- **WHEN** the viewport is `1440x900` and the active workspace is Office
- **THEN** the app renders Header, left panel, central scene/workspace area, right task panel, and StatusBar without overlapping the primary scene or task input controls

#### Scenario: Tablet workspace collapses nonessential rails
- **WHEN** the viewport is `1280x800`
- **THEN** AppLayout MAY collapse secondary rails or handles, but SHALL preserve visible peer workspace navigation, the active workspace body, and the current primary action

#### Scenario: Narrow viewport has no horizontal overflow
- **WHEN** the viewport is `390x844`
- **THEN** `document.documentElement.scrollWidth` SHALL be less than or equal to `window.innerWidth`
- **AND** the active screen's primary CTA SHALL be visible or reachable by vertical scrolling and clickable without pointer interception

### Requirement: Company entry flows stack on narrow screens
Company Portal and the template wizard SHALL switch from desktop multi-column layouts to narrow single-column layouts at narrow viewport widths. Company list, template selection, details, preview, and primary action SHALL appear in a linear order that preserves task continuity.

#### Scenario: Empty Company Portal on narrow viewport
- **WHEN** the user has no active company and opens the app at `390x844`
- **THEN** the portal presents the create-company path in a single column
- **AND** the primary create CTA is not clipped by the company list, preview region, or right-side brief panel

#### Scenario: Template wizard start action on narrow viewport
- **WHEN** the template wizard is open at `390x844`
- **THEN** the template selector, selected template details, preview, and `Start Company` action stack vertically
- **AND** tapping `Start Company` is not blocked by any overlapping side panel or scroll container

### Requirement: Fixed bottom action areas reserve readable content space
Screens with sticky or fixed bottom actions SHALL reserve enough bottom padding in the scrollable content area so the last form field, preview, validation message, or card is not obscured by the footer.

#### Scenario: Employee Creator footer does not cover form content
- **WHEN** Employee Creator is open and the user scrolls to the bottom
- **THEN** the last editable field and validation message remain fully visible above the bottom action bar

#### Scenario: Settings save area does not cover controls
- **WHEN** Settings has unsaved or invalid changes and the user scrolls to the bottom of a tab
- **THEN** the save area remains visible without covering the last control in the active tab

#### Scenario: Company Editor footer does not cover preview content
- **WHEN** Company Editor is open at desktop or narrow width
- **THEN** footer actions remain available and the editable content above them retains readable spacing

### Requirement: Responsive behavior is verified by screenshot QA
The responsive shell change SHALL be validated through local screenshots or equivalent browser automation at `1440x900`, `1280x800`, and `390x844` for Portal, template wizard, Office 3D/2D, SOP, Market, Settings, Studio, Company Editor, Dashboard, and Activity.

#### Scenario: Required viewport capture set exists
- **WHEN** implementation verification is performed
- **THEN** the verification notes SHALL include the three required viewport sizes and the covered screens
- **AND** any remaining narrow-screen limitation SHALL be documented as a product decision rather than an accidental clipping bug
