# responsive-app-shell

## Purpose

The main app shell defines stable layout behavior at desktop (1440x900), tablet (1280x800), and narrow (390x844) viewports without horizontal document overflow. The active screen's primary action is reachable at narrow widths without being clipped by rails, collapse handles, overlays, or fixed footers. Company Portal and the template wizard stack into single column on narrow screens. Screens with sticky/fixed bottom actions reserve enough bottom padding so the last form field, validation message, or preview is never hidden behind the footer. The responsive change is validated through screenshot QA at the three reference viewports across all primary screens.
## Requirements
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

### Requirement: Personnel workspace adapts at narrow tablet desktop tiers
The Personnel workspace SHALL render readable layouts at `1440x900`, `1280x800`, and `390x844`. At desktop the list rail, detail+preview, and tabs inspector SHALL render as three concurrent panes. At tablet the user SHALL be able to drill from list → detail+tabs without losing back navigation. At narrow the panes SHALL stack and avoid horizontal document overflow.

#### Scenario: Desktop renders three panes
- **WHEN** viewport is `1440x900` and `activeWorkspace === 'personnel'`
- **THEN** the list, detail+preview, and right tabs inspector SHALL render side by side
- **AND** each pane SHALL be vertically scrollable independently

#### Scenario: Tablet preserves drill navigation
- **WHEN** viewport is `1280x800` and `activeWorkspace === 'personnel'`
- **THEN** the page SHALL remain usable to select an employee and view its tabs without horizontal page scrolling
- **AND** Back navigation SHALL unwind tab → selection per `personnel-workspace-surface`

#### Scenario: Narrow stacks panes and avoids overflow
- **WHEN** viewport is `390x844` and `activeWorkspace === 'personnel'`
- **THEN** `document.documentElement.scrollWidth` SHALL be ≤ `window.innerWidth`
- **AND** the active pane (list, detail, or tabs) SHALL fill the viewport with the others reachable via Back

### Requirement: Personnel page reserves bottom action space
The Profile tab inside Personnel SHALL render any sticky save / delete actions without obscuring the last visible field. Placeholder tabs SHALL not introduce sticky footers.

#### Scenario: Profile tab save bar leaves the last form field visible
- **WHEN** the user scrolls to the bottom of the Profile tab content with unsaved changes
- **THEN** the last form field, validation message, or section heading SHALL remain fully visible above any sticky action bar

### Requirement: Narrow tier verification scope is the web SPA in browser

The narrow tier (`390x844`) verification surface SHALL be the web SPA opened in a browser viewport (`pnpm --filter @offisim/web dev` plus browser DevTools resize, or a production browser opening the deployed web SPA). The Tauri release `.app` window SHALL NOT be required to support narrow tier viewports.

This Requirement does not weaken any of the existing narrow-tier scenarios (e.g., `Narrow viewport has no horizontal overflow`, `Empty Company Portal on narrow viewport`, `Template wizard start action on narrow viewport`, `Narrow stacks panes and avoids overflow`). Those scenarios continue to apply unchanged — but their verification target is the web SPA, not the desktop release shell.

#### Scenario: Narrow scenario verification target is web SPA
- **WHEN** any narrow-tier (`390x844`) scenario in this capability is verified during a release-readiness pass
- **THEN** the verifier SHALL drive the web SPA in a browser viewport (or equivalent browser automation)
- **AND** the verifier SHALL NOT use the Tauri release `.app` as the narrow-tier surface

#### Scenario: Tauri release `.app` is exempt from narrow tier
- **WHEN** the desktop release `.app` is launched
- **THEN** the OS window SHALL NOT be required to render correctly below the desktop product floor
- **AND** verifiers SHALL NOT log a regression against narrow-tier scenarios solely because the desktop window cannot reach `390px` width

### Requirement: Tauri release window enforces desktop product floor

The Tauri release `.app` main window SHALL define a `minWidth` of at least `1024` and a `minHeight` consistent with the existing `responsive-app-shell` desktop and tablet tiers. The window's default `width` × `height` SHALL remain at least the existing tablet tier (`1280x800`) so first-launch lands inside a verified responsive tier.

The desktop product floor SHALL NOT be relaxed solely to enable narrow-tier verification inside the desktop shell — narrow-tier verification has its own surface (web SPA, see prior Requirement).

#### Scenario: Release `.app` window enforces minWidth ≥ 1024
- **WHEN** the user attempts to drag the desktop release `.app` window to a width below `1024px`
- **THEN** the OS window manager SHALL clamp the window at `1024px` per the configured `minWidth`

#### Scenario: First-launch window lands at tablet tier or larger
- **WHEN** the user launches the release `.app` for the first time on a fresh install
- **THEN** the main window opens at `1280x800` or larger (within OS desktop bounds)
- **AND** the rendered shell matches the existing tablet-tier scenario `Tablet workspace keeps right rail expanded`

#### Scenario: Window minimum is enforced at the Tauri config layer
- **WHEN** a developer or verifier inspects `apps/desktop/src-tauri/tauri.conf.json` `app.windows[0]`
- **THEN** `minWidth` SHALL be a number ≥ `1024`
- **AND** `minHeight` SHALL be a number consistent with the documented tablet tier baseline (`700` or higher)

