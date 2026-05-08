## ADDED Requirements

### Requirement: API token scopes SHALL be enforced by route

Platform API token authentication SHALL load token scopes into request context and route handlers SHALL require explicit scopes for protected operations. A valid `offisim_` token without the required scope SHALL NOT be equivalent to a full login session.

At minimum, publish mutations SHALL require `publish:write`, install receipts SHALL require `install:receipt`, marketplace read endpoints MAY use `market:read`, and review mutations SHALL require `reviews:write` or authenticated user session equivalent.

#### Scenario: Token without publish scope cannot submit draft
- **WHEN** a valid API token lacks `publish:write`
- **THEN** `POST /v1/publish/submit` returns 403
- **AND** no moderation job is created

#### Scenario: Scoped token can perform allowed route
- **WHEN** a valid API token has `install:receipt`
- **THEN** the install receipt endpoint accepts it if all business ownership checks pass
- **AND** unrelated publish routes still reject it without `publish:write`

### Requirement: Local runtime bridge routes SHALL not be public by default

Routes for resume, sessions, and kanban local runtime state SHALL either run in a separate local-only app or require a local-only guard in the shared Hono app. The guard SHALL reject public network access unless the request carries a valid per-install local runtime token or a normal authenticated user session explicitly allowed for that route. Loopback origin alone SHALL NOT be considered authentication; it MAY be used only as an additional restriction after token/session validation.

Public marketplace endpoints and local runtime bridge endpoints SHALL have separate threat models in code and runbook documentation.

#### Scenario: Public request cannot read local session
- **WHEN** an unauthenticated remote request calls `/api/sessions/:id`
- **THEN** the route returns 401 or 403
- **AND** no local session payload is returned

#### Scenario: Loopback local runtime request is accepted
- **WHEN** the desktop app calls a local runtime bridge endpoint with the configured local token from loopback origin
- **THEN** the request is accepted
- **AND** the response shape remains compatible with existing desktop callers

#### Scenario: Loopback origin without token is rejected
- **WHEN** a request comes from loopback origin but lacks local runtime token and authenticated user session
- **THEN** the route returns 401 or 403
- **AND** no local runtime state is returned

### Requirement: Platform production SHALL have formal migrations and runbook

Platform Postgres schema changes SHALL be delivered through a formal migration directory and runbook. Production deploy SHALL run migration drift checks before serving traffic. Fresh bootstrap-only schema files SHALL NOT be the only source of truth for platform production data.

#### Scenario: Platform schema change includes migration
- **WHEN** `packages/db-platform/src/schema.ts` changes table columns, indexes, or constraints
- **THEN** the change includes a matching SQL migration or documented generated migration artifact
- **AND** the release runbook lists how to apply and roll back the migration

#### Scenario: Drift check blocks release
- **WHEN** generated migration state does not match the schema file
- **THEN** the release gate fails before deployment
