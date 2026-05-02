## MODIFIED Requirements

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
