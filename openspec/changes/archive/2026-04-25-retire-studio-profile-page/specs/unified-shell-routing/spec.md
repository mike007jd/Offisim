## MODIFIED Requirements

### Requirement: Header adapts to active workspace
The Header component SHALL conditionally render UI elements based on `activeWorkspace`.

#### Scenario: Office mode header
- **WHEN** `activeWorkspace` is `'office'`
- **THEN** Header displays 2D/3D toggle, company switcher chip, project selector slot, notification slot, and full workspace navigation
- **AND** Header SHALL NOT render a "company editor" pencil button or any other affordance that opens a separate company-edit modal — company name and description editing live in the Studio top chrome (per `studio-company-identity-editing`)

#### Scenario: Non-office mode header
- **WHEN** `activeWorkspace` is not `'office'`
- **THEN** Header displays a back-to-office button, current workspace title, workspace navigation buttons, and settings button. 2D/3D toggle, company chip, and project selector are hidden.

#### Scenario: No pencil-icon company editor button
- **WHEN** grepping `packages/ui-office/src/components/layout/Header.tsx` for `onOpenCompanyEditor` (prop) or for a `Pencil` import wired to a company-settings click handler
- **THEN** zero matches exist
