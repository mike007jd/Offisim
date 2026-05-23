## ADDED Requirements

### Requirement: Installable asset kinds have materializers
For every manifest asset kind marked installable by product policy, the install pipeline SHALL have a kind-specific materializer. Employee and skill materializers remain supported. SOP, company template, office layout, prefab, and bundle assets SHALL NOT be recorded as installed unless their runtime entities are actually materialized or updated.

#### Scenario: Unsupported materializer fails closed
- **WHEN** an install plan contains a kind without a registered materializer
- **THEN** installation SHALL fail with a typed unsupported-kind error
- **AND** it SHALL NOT create an installed package row that implies the asset is usable

### Requirement: SOP assets materialize as SOP templates
Installing a SOP asset SHALL create or update a SOP template for the active company with source package identity, source asset identity, version, definition JSON, and sync timestamp. The SOP definition SHALL be validated before persistence.

#### Scenario: SOP install creates template
- **WHEN** a valid SOP asset is installed
- **THEN** a `sop_templates` row SHALL be created for the active company
- **AND** the row SHALL preserve source package and asset identity for future upgrade/diff flows

### Requirement: Company template assets register reusable templates
Installing a company template asset SHALL register it as a reusable template definition without automatically creating or switching the active company. Materializing a company from that template SHALL continue to use the company template service and its transaction boundary.

#### Scenario: Template install does not create company
- **WHEN** a company template asset is installed
- **THEN** the active company SHALL remain unchanged
- **AND** no employees, SOPs, zones, layouts, or prefabs SHALL be created until the user explicitly materializes a company from that template

### Requirement: Office layout and prefab assets preserve references safely
Installing an office layout asset SHALL validate zones, prefab references, workstation bindings, and layout schema before persistence. Installing a prefab asset SHALL validate prefab definition, binding slots, category, and renderer-safe metadata before it becomes available for layout materialization.

#### Scenario: Layout with missing prefab fails validation
- **WHEN** an office layout asset references a prefab id that is not built in and not present in the same package/bundle
- **THEN** install SHALL fail with a typed validation error
- **AND** no partial layout row SHALL be persisted

#### Scenario: Prefab install registers definition
- **WHEN** a valid prefab asset is installed
- **THEN** the prefab definition SHALL become available to layout/studio materialization code through a typed repository or registry path

### Requirement: Bundle install is transactional
Installing a bundle SHALL materialize its child assets in dependency order and SHALL rollback already-created local entities if any child fails. The terminal install event SHALL fire only after all child assets are materialized successfully.

#### Scenario: Bundle child failure rolls back
- **WHEN** a bundle contains a valid SOP asset followed by an invalid layout asset
- **THEN** the SOP row created earlier in the bundle install SHALL be rolled back
- **AND** no installed terminal event SHALL be emitted for the bundle

### Requirement: Export supports reusable production assets
Export/package builders SHALL support SOP, company template, office layout, prefab, and bundle assets with stable manifest ids, kind, version, dependencies, and integrity metadata. Exporting these kinds SHALL NOT depend on marketplace UI.

#### Scenario: SOP export is portable
- **WHEN** a user or agent exports a SOP template as an asset package
- **THEN** the package manifest SHALL include kind `sop`, stable id, version, definition payload, and integrity metadata
