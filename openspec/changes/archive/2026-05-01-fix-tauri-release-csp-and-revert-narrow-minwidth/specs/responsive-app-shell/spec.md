## ADDED Requirements

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
