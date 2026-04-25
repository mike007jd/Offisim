## ADDED Requirements

### Requirement: Appearance tab is a live customizer + preview surface

The `Appearance` tab in the Personnel page SHALL render a two-region surface for internal employees: a left region containing the `AvatarCustomizer` form, and a right region containing both a 2D DiceBear preview and a 3D `LowPolyCharacter` preview. Both previews SHALL subscribe to `editor.formData.appearance` and re-render synchronously on every appearance change without requiring a save.

#### Scenario: Internal employee opens Appearance tab
- **WHEN** the user selects an internal employee (`is_external === 0`) and activates the `Appearance` tab
- **THEN** the tab content SHALL render the `AvatarCustomizer` controls in the left region
- **AND** SHALL render a 2D DiceBear avatar of that employee in the right-top region
- **AND** SHALL render a 3D R3F canvas with the `LowPolyCharacter` `default` variant in the right-bottom region
- **AND** SHALL NOT render the `PlaceholderTab` shell

#### Scenario: Changing skin color updates both previews live
- **WHEN** the user clicks a different `Skin tone` swatch in the customizer
- **THEN** the 2D DiceBear preview SHALL re-render within the same frame with the new skin color
- **AND** the 3D preview's body / head / arms meshes SHALL update their `meshStandardMaterial.color` to the new skin color
- **AND** no save event SHALL fire

#### Scenario: Changing clothing color updates both previews live
- **WHEN** the user clicks a different `Clothing color` swatch
- **THEN** the 2D DiceBear `clothesColor` SHALL update in the next render
- **AND** the 3D body mesh's `meshStandardMaterial.color` SHALL update to the new color
- **AND** no save event SHALL fire

#### Scenario: Changing hair style updates only 2D preview in this change
- **WHEN** the user picks a different `Hair style` from the dropdown
- **THEN** the 2D DiceBear preview SHALL re-render with the mapped `top` token
- **AND** the 3D preview SHALL NOT change geometry (3D hair differentiation is a follow-up)

#### Scenario: External employee Appearance tab shows brand-managed banner
- **WHEN** the user selects an external employee (`is_external === 1`) and activates the `Appearance` tab
- **THEN** the customizer controls SHALL NOT render
- **AND** the read-only banner with `data-testid="external-avatar-disabled"` SHALL render in the left region
- **AND** the right region SHALL render the brand SVG (via `BrandAvatar2D`) as the preview
- **AND** the 3D preview SHALL render the brand-variant body matching `brand_key`

### Requirement: Appearance lives only in the Appearance tab

The `AvatarCustomizer` component SHALL NOT render inside the `Profile` tab. The Appearance tab SHALL be the single surface that hosts appearance editing.

#### Scenario: Profile tab no longer mounts AvatarCustomizer
- **WHEN** auditing `packages/ui-office/src/components/employees/personnel-tabs/ProfileTab.tsx`
- **THEN** the file SHALL NOT import `AvatarCustomizer`
- **AND** the Identity section SHALL NOT render the `AvatarCustomizer` JSX block

#### Scenario: External-employee read-only banner moves with the customizer
- **WHEN** auditing `ProfileTab.tsx`
- **THEN** the file SHALL NOT render the `data-testid="external-avatar-disabled"` banner
- **AND** that banner SHALL render inside `AppearanceTab.tsx` instead

### Requirement: Save round-trip propagates appearance to all employee surfaces

When the user saves an internal employee with a changed `appearance`, every UI surface that renders that employee's avatar SHALL re-render with the new appearance on the next event tick after `useEmployeeEditor.save()` completes. Surfaces in scope: Personnel list rail row, Personnel detail header, Office 2D canvas (`use-scene-snapshot` avatar cache), Office 3D scene `EmployeeMarker`, chat avatars, and any other consumer of `EmployeeAvatar` or `EmployeeMarker`.

#### Scenario: List rail row reflects new clothing color after save
- **WHEN** the user changes `clothingColor`, clicks Save, and the save resolves
- **THEN** the corresponding row in the Personnel list rail SHALL re-render its `EmployeeAvatar` with the new clothing color on the next `eventBus` `employee` event tick
- **AND** the avatar in the row SHALL byte-match the right-top preview

#### Scenario: Office 3D scene reflects new skin color after save
- **WHEN** the user changes `skinColor`, clicks Save, and switches to the Office workspace
- **THEN** the `EmployeeMarker` for that employee SHALL render with the new skin color on the next render tick
- **AND** SHALL NOT require a workspace reload

#### Scenario: Office 2D canvas cache invalidates only the changed employee
- **WHEN** the user saves an appearance change for one employee
- **THEN** the `office-2d-avatar-cache` entry for that employee SHALL be replaced with a new SVG
- **AND** other employees' cache entries SHALL NOT be invalidated

### Requirement: 3D scope in C1 is skin and clothing color only

In this change, the `LowPolyCharacter` `default` variant SHALL consume only `skinColor` and `clothingColor` from the resolved appearance. `hairStyle`, `bodyType`, `gender`, and `clothingAccent` SHALL persist in `persona_json.appearance` but SHALL NOT alter the 3D figure's geometry, proportions, or color in this change. A follow-up art pass SHALL deliver 3D differentiation for those fields.

#### Scenario: Body type change does not alter 3D geometry in C1
- **WHEN** the user changes `bodyType` from `normal` to `slim`
- **THEN** the 3D preview SHALL render the same default block-figure geometry
- **AND** `bodyType: 'slim'` SHALL persist in `persona_json.appearance` after save

#### Scenario: Hair style change does not alter 3D geometry in C1
- **WHEN** the user changes `hairStyle` from `short` to `bob`
- **THEN** the 3D preview SHALL render the same default block-figure geometry (no hair mesh added)
- **AND** the change SHALL still update the 2D DiceBear preview

#### Scenario: clothingAccent persists but is unused in renderers
- **WHEN** the user changes `clothingAccent` and saves
- **THEN** `persona_json.appearance.clothingAccent` SHALL contain the new value
- **AND** neither the 2D DiceBear preview nor the 3D figure SHALL render any visual difference
- **AND** the customizer's `Clothing accent` swatch SHALL display copy indicating the trim is applied in a future art pass
