# personnel-appearance-live-preview Specification

## Purpose

Defines the contract for the Personnel `Appearance` tab as a live customizer + preview surface, the rule that `formData.appearance` is the authoritative customization source for renderers, and the cross-surface propagation requirements after save. Internal employees see a left-rail `AvatarCustomizer` plus a stacked 2D DiceBear / 3D `LowPolyCharacter` preview that updates synchronously on every swatch change without round-tripping through save. External employees see the read-only brand-managed banner and brand-variant preview. C1 scope is skin + clothing color in 3D; `hairStyle` / `bodyType` / `gender` / `clothingAccent` persist in `persona_json.appearance` but are visualized only in 2D until a follow-up art pass extends 3D differentiation.
## Requirements
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

When the user saves an internal employee with a changed `appearance`, every UI surface that renders that employee's 2D or 3D avatar SHALL re-render with the new appearance on the next event tick after `useEmployeeEditor.save()` completes. The propagation SHALL cover all seven `EmployeeAppearance` fields: `skinColor`, `hairColor`, `hairStyle`, `clothingColor`, `clothingAccent`, `bodyType`, `gender`. This requirement REPLACES the prior "Save round-trip propagates appearance to all employee surfaces" requirement to cover the full schema.

Surfaces in scope SHALL include: Personnel list rail row, Personnel detail header, Office 2D canvas (`use-scene-snapshot` avatar cache), Office 3D scene `EmployeeMarker`, chat avatars, and AppearanceTab live preview.

#### Scenario: Office 3D scene reflects new bodyType after save
- **WHEN** the user changes `bodyType` from `normal` to `stocky`, clicks Save, and switches to the Office workspace
- **THEN** the `EmployeeMarker` for that employee SHALL render with `BODY_TYPE_FACTORS['stocky']` width factors on the next render tick

#### Scenario: Office 3D scene reflects new hairStyle after save
- **WHEN** the user changes `hairStyle` from `short` to `braids`, clicks Save
- **THEN** the `EmployeeMarker` SHALL render the braids hair composition (cap + 2 side cylinders) on the next render tick

#### Scenario: Office 3D scene reflects new clothingAccent after save
- **WHEN** the user changes `clothingAccent` to a value different from `clothingColor`, clicks Save
- **THEN** the `EmployeeMarker` SHALL render the vest accent overlay with the new color on the next render tick

#### Scenario: 2D avatar cache key invalidates on hairColor change
- **WHEN** the user changes `hairColor` and saves
- **THEN** the `office-2d-avatar-cache` entry for that employee SHALL be replaced with a new SVG
- **AND** the cache key SHALL include `hairColor` in its appearance fingerprint

### Requirement: 3D scope in C1 is skin and clothing color only

In this change, the `LowPolyCharacter` `default` variant SHALL consume ALL seven appearance fields from `EmployeeAppearance`: `skinColor`, `hairColor`, `hairStyle`, `clothingColor`, `clothingAccent`, `bodyType`, `gender`. Every customizer change SHALL update the 3D preview geometry, materials, or both within one render frame.

This requirement REPLACES the prior "3D scope in C1 is skin and clothing color only" requirement. The deferred-to-art-pass scope no longer exists — `hairStyle`, `bodyType`, `gender`, and `clothingAccent` SHALL drive 3D geometry per the `character-3d-rendering` capability.

The customizer copy line "Saved with the employee — visible trim arrives in an upcoming art pass" SHALL be removed from `AvatarCustomizer.tsx`. If a clarifier line is desired, it SHALL describe the rendering location of the accent (e.g. "Renders as a vest accent panel.") rather than promising a future art pass.

#### Scenario: Body type change alters 3D geometry live
- **WHEN** the user changes `bodyType` from `normal` to `slim`
- **THEN** the 3D preview's torso `boxGeometry` x-arg shrinks by the `BODY_TYPE_FACTORS['slim'].torso = 0.85` factor within one frame
- **AND** the arm `boxGeometry` x-arg shrinks by the `BODY_TYPE_FACTORS['slim'].arm = 0.85` factor
- **AND** `bodyType: 'slim'` persists in `persona_json.appearance` after save

#### Scenario: Hair style change alters 3D geometry live
- **WHEN** the user changes `hairStyle` from `short` to `bob`
- **THEN** the 3D preview's hair mesh transitions from the cap box `(0.32 × 0.16 × 0.32)` to the bob box `(0.36 × 0.22 × 0.34)` within one frame
- **AND** the 2D DiceBear preview also updates per its existing `top` token mapping

#### Scenario: Gender change alters 3D shoulder/hip ratio live
- **WHEN** the user changes `gender` from `neutral` to `feminine`
- **THEN** the 3D preview's upper-torso x-arg scales by `GENDER_FACTORS['feminine'].shoulder = 0.85`
- **AND** the lower-torso x-arg scales by `GENDER_FACTORS['feminine'].hip = 1.10`
- **AND** the upper-torso y-arg scales by `GENDER_FACTORS['feminine'].aspect = 0.95`
- **AND** `gender: 'feminine'` persists in `persona_json.appearance` after save

#### Scenario: clothingAccent renders vest live
- **WHEN** the user clicks a `Clothing accent` swatch with a color different from current `clothingColor`
- **THEN** the 3D preview adds (or updates the color of) the vest accent box at `(0, 0.78, 0.105)` within one frame
- **AND** `persona_json.appearance.clothingAccent` updates to the new value
- **AND** the 2D DiceBear preview SHALL be unchanged (DiceBear has no equivalent vest layer)

#### Scenario: Matching clothingAccent hides vest
- **WHEN** the user clicks a `Clothing accent` swatch matching the current `clothingColor`
- **THEN** the 3D preview's vest accent mesh is removed within one frame (or never mounts)
- **AND** the torso renders solid in `clothingColor`

#### Scenario: Customizer copy reflects new visible behavior
- **WHEN** auditing `AvatarCustomizer.tsx` for the `Clothing accent` `SwatchRow`
- **THEN** the row is NOT followed by "Saved with the employee — visible trim arrives in an upcoming art pass"
- **AND** if a clarifier line exists it describes the visible vest panel location

#### Scenario: All seven fields propagate to Office scene after save
- **WHEN** the user changes any subset of `(skinColor, hairColor, hairStyle, clothingColor, clothingAccent, bodyType, gender)` and clicks Save
- **THEN** the Office workspace `EmployeeMarker` for that employee re-renders with the new appearance values on the next event tick
- **AND** all seven schema fields drive the rendered `<BlockCharacter>` params

