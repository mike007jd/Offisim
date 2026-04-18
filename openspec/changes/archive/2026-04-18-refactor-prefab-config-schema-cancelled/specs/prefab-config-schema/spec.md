## ADDED Requirements

### Requirement: Prefab config types are centralized and discriminated

`PrefabConfig` SHALL be defined as a discriminated union keyed by `archetype: PrefabArchetype` in `packages/shared-types/src/prefab-config.ts`. One member variant SHALL exist per prefab archetype (`workstation` / `lounge` / `rack` / `shelf` / `desk` / ...). Common fields SHALL live in a `PrefabConfigBase<T>` interface; variant-specific fields SHALL live in per-archetype interfaces. `PrefabBinding` SHALL be a similar discriminated union defined in the same module.

#### Scenario: Single owner of PrefabConfig union
- **WHEN** grepping the repository for `export type PrefabConfig =` or `export interface \w+Config extends PrefabConfigBase`
- **THEN** all matches are inside `packages/shared-types/src/prefab-config.ts`

#### Scenario: Archetype coverage
- **WHEN** comparing the `PrefabArchetype` union values to `PrefabConfig` member archetypes
- **THEN** every `PrefabArchetype` value has a corresponding `PrefabConfig` variant (no missing archetype)

### Requirement: Prefab config parser returns Result, not throws

`packages/asset-schema/src/prefab-config-parser.ts` SHALL export `parsePrefabConfig(json: string, archetype: PrefabArchetype): ParseResult<PrefabConfig>` and `parsePrefabBindings(json: string): ParseResult<PrefabBinding[]>`. Both parsers SHALL:

- Return `{ ok: true, value }` on valid JSON + schema-conformant data
- Return `{ ok: false, error }` on invalid JSON, schema violation, or unknown archetype
- Attempt best-effort parsing for schema-violating-but-JSON-valid legacy data, filling defaults and returning `{ ok: true, value }` + emitting a `prefab.config.schema.violation` telemetry event (where the caller has the runtime context to emit)
- Never throw

#### Scenario: Parser returns Result not throw
- **WHEN** calling `parsePrefabConfig('invalid-json', 'workstation')`
- **THEN** a `{ ok: false, error: { code: 'invalid-json', ... } }` object is returned; no exception is thrown

#### Scenario: Schema violation with best-effort fallback
- **WHEN** calling `parsePrefabConfig('{"archetype":"workstation"}', 'workstation')` (missing required `monitorCount`)
- **THEN** parser returns `{ ok: true, value }` with `monitorCount` set to the archetype default, or `{ ok: false, error: { code: 'schema-violation' } }` if best-effort default is not defined — consistently per archetype

### Requirement: All prefab config consumers use the centralized parser

After the migration completes, no consumer in the repository SHALL directly call `JSON.parse(...)` on `bindings_json` or `config_json` column values. All reads SHALL go through `parsePrefabConfig` / `parsePrefabBindings`. All writes SHALL go through `stringifyPrefabConfig` / `stringifyPrefabBindings`.

#### Scenario: No raw JSON.parse on bindings_json / config_json
- **WHEN** grepping the repository for `JSON\\.parse\(.*\\b(bindings_json|config_json|bindingsJson|configJson)\\b` (excluding `archive/` and `dist/`)
- **THEN** zero matches exist

#### Scenario: No raw JSON.stringify for prefab config
- **WHEN** grepping the repository for `JSON\\.stringify\(.*Config\)` where `Config` is a prefab config object
- **THEN** zero direct matches exist — writes go through `stringifyPrefabConfig`

### Requirement: DB tables carry schema version columns

`prefab_instances` and `prefab_defs` tables (both package-local SQLite and desktop SQLite via migrations) SHALL carry `bindings_schema_version INTEGER NOT NULL DEFAULT 1` and `config_schema_version INTEGER NOT NULL DEFAULT 1` columns. The legacy `bindings_json` / `config_json` columns SHALL NOT be dropped; they remain the source of truth for the actual data.

#### Scenario: Migration landed
- **WHEN** running a fresh-install package-local SQLite + Tauri desktop SQLite
- **THEN** both tables contain the 4 new `schema_version` columns with default 1

### Requirement: Observable prefab runtime behavior is unchanged after refactor

For identical `bindings_json` / `config_json` values, all prefab-consuming runtime paths (3D silhouette rendering, 2D canvas silhouette rendering, seat registry placement, role-pin resolution, install validation, studio editor display) SHALL produce byte-identical visual output and behavior before and after the refactor. The only behavioral change permitted is the addition of fallback + telemetry for schema-violating legacy data (where pre-refactor would throw and crash, post-refactor logs a warning and continues with defaults).

#### Scenario: 3D render parity
- **WHEN** loading an existing company with 10+ prefab instances in 3D view
- **THEN** every silhouette position, footprint, seat position, and role-pin matches pre-refactor pixel-for-pixel

#### Scenario: 2D canvas render parity
- **WHEN** switching to 2D canvas view on the same company
- **THEN** every prefab silhouette position and size matches pre-refactor

#### Scenario: Studio editor preview parity
- **WHEN** opening Studio Zone Mode editor on an existing layout
- **THEN** prefab presets render with the same visuals as pre-refactor

#### Scenario: Legacy schema-violating data no longer crashes
- **WHEN** a prefab instance has `config_json` missing a required field (legacy data)
- **THEN** 3D/2D render continues using archetype defaults + `prefab.config.schema.violation` telemetry event is emitted; no runtime crash (pre-refactor this path crashed the scene)
