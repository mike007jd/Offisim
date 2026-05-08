## ADDED Requirements

### Requirement: Publish drafts SHALL enforce listing ownership

Creating, updating, submitting, and moderating a publish draft that references an existing listing SHALL verify that the listing belongs to the current creator. Moderation updates to `listings` SHALL include both `listing_id` and `creator_id = draft.creator_id` in the update predicate.

`listing_id` request fields SHALL be validated as UUIDs. A draft referencing a listing owned by another creator SHALL return 403 and SHALL NOT create or update package versions.

#### Scenario: Creator cannot draft against another creator listing
- **WHEN** creator A creates a draft with creator B's `listing_id`
- **THEN** the publish route returns 403
- **AND** no draft row is inserted

#### Scenario: Moderation cannot update listing without creator match
- **WHEN** a draft somehow contains a `listing_id` not owned by `draft.creator_id`
- **THEN** moderation rejects the draft or updates zero rows and marks the job rejected
- **AND** creator B's listing title, summary, and package versions remain unchanged

### Requirement: Publish validation SHALL reuse canonical asset schema

Platform publish validation SHALL use `@offisim/asset-schema` canonical manifest validation. Platform-local Zod schemas MAY validate request envelope shape, but SHALL NOT define a looser marketplace manifest contract.

The platform SHALL reject manifests that canonical install-core/schema validation would reject, including extra top-level fields, invalid `integrity.package_sha256`, invalid asset paths, missing permission risk metadata, or invalid filesystem/network scope values.

#### Scenario: Canonical extra-field rejection
- **WHEN** a manifest contains an unknown top-level field
- **THEN** platform publish validation rejects it
- **AND** install-core would make the same decision

#### Scenario: Integrity hash format enforced
- **WHEN** `integrity.package_sha256` is not a 64-character hex string
- **THEN** publish validation rejects the manifest before submission

### Requirement: Artifact integrity SHALL be a platform-trusted chain

Published artifacts SHALL have a trusted sha256 and size chain. The platform SHALL validate publisher-provided `artifact.sha256` as 64 hex and `artifact.size_bytes` as a positive integer under the configured maximum. The platform SHALL compute sha256 and byte size from the artifact bytes when the artifact is uploaded or fetched for moderation.

The manifest `integrity.package_sha256`, publisher-provided sha, and platform-computed sha SHALL match before a package version is marked active. `package_versions.artifact_sha256` and `artifact_size_bytes` SHALL be populated for every active installable package version.

External artifact URLs SHALL default to `https:` only and SHALL reject `file:`, `javascript:`, localhost, loopback, private network ranges, and cloud metadata IPs unless the artifact is an official seeded platform artifact.

If the platform fetches publisher-provided `external_url` bytes for moderation or hash computation, it SHALL treat the fetch as an SSRF-sensitive operation. The fetcher SHALL disable automatic redirects or re-validate every redirect target before following; validate scheme, host, port, path, and resolved A/AAAA IPs; reject DNS results resolving to loopback, link-local, private, multicast, unspecified, cloud metadata, or non-global IPs; re-check the resolved IP immediately before connect where the HTTP client supports it; enforce connect/read timeout; enforce max content length and streaming byte cap before full download; compute sha256 while streaming; and reject unsupported content types or archive bombs where applicable.

If the chosen HTTP client cannot prevent redirect bypass or cannot bind the validated resolved IP to the outbound connection, production external artifact fetching SHALL be disabled and registry object upload SHALL be required. Official seeded artifacts SHALL come from platform-owned storage or repository-pinned fixtures, not publisher-provided `external_url` values.

#### Scenario: Mismatched artifact hash blocks approval
- **WHEN** a draft manifest claims hash X but the artifact bytes compute to hash Y
- **THEN** moderation rejects the draft
- **AND** no active package version is created

#### Scenario: Download endpoint returns trusted integrity
- **WHEN** `/v1/install/download/:versionId` returns an active package version
- **THEN** `artifact_sha256` and `artifact_size_bytes` are non-null and match the platform-computed artifact metadata

#### Scenario: External artifact redirect to metadata IP is rejected
- **WHEN** an artifact URL redirects to `http://169.254.169.254/latest/meta-data`
- **THEN** moderation rejects the artifact before fetching redirected bytes
- **AND** no package version is created

#### Scenario: External artifact DNS resolves to private IP
- **WHEN** an artifact host resolves to `10.0.0.5`, `172.16.0.10`, `192.168.1.10`, `127.0.0.1`, `::1`, or another non-global address
- **THEN** the platform rejects the artifact URL before connect
- **AND** the rejection reason is recorded in validation or moderation output

#### Scenario: External artifact size cap stops streaming
- **WHEN** an external artifact response exceeds the configured maximum artifact byte size
- **THEN** the fetcher aborts the stream before reading the full response
- **AND** moderation rejects the draft without storing partial package metadata

#### Scenario: Unsafe HTTP client disables external_url in production
- **WHEN** the artifact fetch implementation cannot bind the validated resolved IP to the outbound connection or cannot revalidate redirects safely
- **THEN** production `external_url` fetching is disabled
- **AND** the publisher must use registry object upload for artifact moderation

#### Scenario: Official seeded artifact exception is platform-owned
- **WHEN** an official seeded package version uses the artifact exception path
- **THEN** the artifact bytes come from platform-owned storage or repository-pinned fixtures
- **AND** a publisher-provided `external_url` cannot use the seeded-artifact exception

### Requirement: Marketplace database SHALL enforce uniqueness for user-visible duplicates

The platform database SHALL enforce uniqueness for review, tag, and package version identities that are expected to be unique at product level.

Required constraints:
- one review per `(listing_id, user_id)`
- one tag row per `(listing_id, tag)`
- one package version per `(listing_id, package_id, version)`

#### Scenario: Duplicate review upsert is backed by DB constraint
- **WHEN** the same user reviews the same listing twice
- **THEN** the second write updates or replaces the existing review semantics
- **AND** the database cannot store two visible reviews for the same `(listing_id, user_id)`

#### Scenario: Duplicate package version is rejected
- **WHEN** moderation attempts to create the same package id/version for the same listing twice
- **THEN** the database rejects the duplicate or the route returns a typed conflict
