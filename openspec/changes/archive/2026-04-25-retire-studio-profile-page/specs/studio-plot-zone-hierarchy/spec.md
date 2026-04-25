## ADDED Requirements

### Requirement: Studio top chrome SHALL host the company identity editor

The Studio top chrome (the toolbar band rendered by `StudioToolbar` and/or a thin band rendered between `StudioToolbar` and `PlotZoneBreadcrumb`) SHALL host the inline company name and description editor defined by the `studio-company-identity-editing` capability. The identity editor SHALL be rendered above `PlotZoneBreadcrumb` (so the breadcrumb still segments Plot · Zone · Asset directly above the canvas) and SHALL NOT shift the breadcrumb's vertical position relative to the canvas in a way that breaks `BREADCRUMB_HEIGHT` assumptions used for canvas top-offset (`StudioPage.tsx` `top: LAYOUT.toolbarHeight + BREADCRUMB_HEIGHT` constant) — if the identity band needs additional vertical space, the canvas top-offset constant SHALL be updated to account for it.

The identity editor SHALL NOT appear in `mode === 'create'` description form (description is locked until first save) but the name input SHALL be present so create-mode users can pre-set the name; the existing `CompanyNameModal` flow remains the canonical confirmation step on first save.

The identity editor SHALL NOT consume the Escape key — the existing Escape cascade (placement → asset → zone → plot) SHALL continue to be the only Escape handler in Studio.

#### Scenario: Identity editor renders inside Studio top chrome
- **WHEN** Studio renders in `mode === 'edit'` with a real `companyId`
- **THEN** an inline name input and a description textarea are present in Studio's top chrome (above `PlotZoneBreadcrumb` and below `StudioToolbar`'s tools row, or inside `StudioToolbar`)

#### Scenario: Breadcrumb position remains directly above canvas
- **WHEN** the identity editor is rendered
- **THEN** `PlotZoneBreadcrumb` is positioned immediately above the canvas (no other interactive surface between them)
- **AND** the canvas top offset constant accounts for the identity band's height (no visual overlap of canvas and breadcrumb)

#### Scenario: Escape behavior is unchanged
- **WHEN** the user presses Escape while focused inside the identity editor or with the identity editor visible
- **THEN** the Studio Escape cascade behaves exactly per the existing `studio-plot-zone-hierarchy` Escape requirements (placement → asset → zone → plot); the identity editor does NOT intercept Escape
