## ADDED Requirements

### Requirement: Platform boot SHALL ensure Offisim official creator exists

When the platform process starts and the database connection is ready, the system MUST run a one-time idempotent seeder that ensures a `creators` row with `handle = 'offisim'` exists. The seeder MUST detect existence by exact `handle` match and MUST NOT modify the row if it already exists.

#### Scenario: First boot on a fresh database
- **WHEN** platform starts against an empty `creators` table
- **THEN** the seeder inserts exactly one creator row with `handle = 'offisim'`, `display_name = 'Offisim'`, and the system continues startup

#### Scenario: Subsequent boot with seed already applied
- **WHEN** platform starts and a `creators` row with `handle = 'offisim'` already exists
- **THEN** the seeder skips all DB inserts/updates but MUST still rebuild the in-memory artifact cache from current payload sources, so seeded `Install` actions keep working across restarts

#### Scenario: Seeder failure does not block startup
- **WHEN** the seeder throws while inserting the creator (e.g., transient DB error)
- **THEN** the error is logged at WARN level and platform startup continues; Market endpoints respond normally on the data they have

### Requirement: Platform boot SHALL seed one official listing per AssetKind

After ensuring the Offisim creator exists (and only when the creator was just created in the same boot, not on subsequent boots), the seeder MUST insert exactly one `listings` row plus one `package_versions` row plus at least one `listing_previews` row for each of the six AssetKinds: `employee`, `skill`, `sop`, `company_template`, `office_layout`, `prefab`. All seeded listings MUST use the `offisim/` slug prefix and reference the Offisim creator.

#### Scenario: First-boot seed inserts 6 listings
- **WHEN** the seeder runs on a fresh database and creates the Offisim creator
- **THEN** the seeder inserts six listings (one per AssetKind), six matching `package_versions` rows with status `'active'`, and at least six `listing_previews` rows total
- **AND** every seeded listing has slug starting with `offisim/`

#### Scenario: Re-seed is skipped when creator already exists
- **WHEN** the seeder runs and the Offisim creator already exists
- **THEN** no listing, version, or preview rows are inserted in this boot, even if some seeded listings have been manually deleted from the database

#### Scenario: Each AssetKind appears exactly once in seed batch
- **WHEN** the seed batch completes successfully
- **THEN** querying `SELECT kind, COUNT(*) FROM listings WHERE creator_id = <offisim> GROUP BY kind` returns exactly 6 rows, each with count 1

### Requirement: Installable seed listings MUST carry real installable manifests

The two listings whose kind is in `INSTALLABLE_KINDS` (`employee` and `skill`) MUST carry `package_versions.manifest_json` payloads that the existing install pipeline can install end-to-end without placeholder errors. Manifests MUST validate against the corresponding `@offisim/asset-schema` validator.

#### Scenario: Employee seed installs through real pipeline
- **WHEN** a user clicks Install on the seeded `offisim/sample-marketing-strategist` listing in Market
- **THEN** the install completes via the existing employee install pipeline, an employee row is created in the active company, and no placeholder / TODO error is surfaced

#### Scenario: Skill seed installs through real pipeline
- **WHEN** a user clicks Install on the seeded `offisim/research-summary` listing in Market
- **THEN** the install completes via the existing SKILL.md install pipeline, a `skills` row is created at company scope, and the SKILL.md body is materialised into the vault

#### Scenario: Seeded manifest fails schema validation
- **WHEN** the seeder loads a payload whose manifest does not validate against the schema
- **THEN** the seeder logs a WARN containing the failed slug and the validation errors, skips that single listing, and continues with the remaining payloads

### Requirement: Preview-only seed kinds MUST NOT expose a working install action

The four AssetKinds outside `INSTALLABLE_KINDS` (`sop`, `company_template`, `office_layout`, `prefab`) MAY appear in Market browse and detail views but MUST NOT show an install action that would invoke an unimplemented pipeline.

#### Scenario: SOP seed listing detail view hides install button
- **WHEN** a user opens the detail view of `offisim/research-pipeline` (kind `sop`)
- **THEN** no install button is rendered for the listing
- **AND** the listing card and detail surface render successfully (title, summary, hero, version, kind chip)

#### Scenario: All four preview-only kinds render without install action
- **WHEN** a user browses each of the four seeded preview-only listings
- **THEN** none of them show an install action; all of them render their card and detail surface without errors

### Requirement: Market UI SHALL surface a kind filter for every seeded AssetKind

`KIND_FILTERS` in `marketplace-meta.tsx` MUST list `'all'` plus exactly the six AssetKinds that are seeded (`employee`, `skill`, `sop`, `company_template`, `office_layout`, `prefab`). Each kind filter MUST return at least one result against a freshly seeded database.

#### Scenario: Filter dropdown shows seven options
- **WHEN** a user opens the Market Explore tab on a freshly seeded database
- **THEN** the kind filter UI exposes exactly seven options: All, Employees, Skills, SOPs, Templates, Layouts, Prefabs (or equivalent labels in the codebase)

#### Scenario: Selecting any single kind returns at least one result
- **WHEN** the user selects any one of the six kind filters on a freshly seeded database
- **THEN** the search results include at least one listing matching that kind

#### Scenario: Selecting "All" returns at least six listings
- **WHEN** the user selects the All filter on a freshly seeded database with no other listings published
- **THEN** the search results include at least the six Offisim official listings

### Requirement: Seed payloads SHALL derive from existing repository sources where available

Seed payloads for `employee`, `company_template`, and `prefab` SHALL reuse existing canonical repository sources (`packages/core/src/templates/*.ts` and `packages/renderer/src/prefab/builtin-catalog.ts`) rather than duplicating their content. Hand-authored payloads (`skill`, `sop`, `office_layout`) MUST live alongside the seeder under `apps/platform/src/seed/payloads/`.

#### Scenario: Repository-sourced payloads stay in sync with their sources
- **WHEN** the source company template `agency-lite.ts` is renamed or its first employee role label is changed
- **THEN** the next platform boot reflects the change in the seeded `offisim/agency-lite` listing manifest without any seed-side edit (because the seeder imports rather than copies)

#### Scenario: Hand-authored payloads live under the platform seed directory
- **WHEN** the project structure is inspected
- **THEN** `apps/platform/src/seed/payloads/` contains the hand-authored payload modules for `skill`, `sop`, and `office_layout`, and no hand-authored payload duplicates content already present in `@offisim/core` or `@offisim/renderer`

### Requirement: Seed namespace SHALL be reserved for Offisim official content

The `offisim/` slug prefix MUST only be used by official Offisim seed content. The seeder MUST emit only `offisim/`-prefixed slugs. (Enforcement of publish-time prefix collision is out of scope for this change and is documented as a follow-up.)

#### Scenario: Every seeded listing uses the offisim prefix
- **WHEN** the seed batch finishes
- **THEN** every inserted `listings.slug` starts with `offisim/`

#### Scenario: Future publish-time prefix enforcement is documented
- **WHEN** a developer reads the change documentation
- **THEN** the design records that publish-side validation of the `offisim/` prefix is intentionally deferred and tracked as a follow-up

### Requirement: Seeded official artifacts MUST be served by the platform itself

The platform MUST expose a route that serves the in-memory `.offisimpkg` bytes for any seeded `package_versions` row, so that Market install flows succeed without any external artifact hosting. The seeded `package_versions.artifact_url` MUST point at this route, scoped to the seeded version_id. User-published listings MUST NOT be affected — their `artifact_url` continues to point at whatever the publisher provided.

#### Scenario: Install flow fetches a seeded artifact across restarts
- **WHEN** a user clicks Install on any seeded installable listing after the platform has been restarted at least once
- **THEN** the Market UI fetches the artifact via `${PLATFORM_PUBLIC_URL}/v1/install/artifacts/:versionId` and receives the zip bytes with `Content-Type: application/octet-stream`, and the install pipeline completes

#### Scenario: Unknown version id returns 404
- **WHEN** the artifact route is called with a `versionId` that was never seeded (e.g. a user-published listing's version)
- **THEN** the route returns HTTP 404 with `error.code = 'NOT_FOUND'`, and the client falls back to the listing's external `artifact_url`
