# Offisim — Install State Machine v0.1

This document defines the runtime-local install/import state machine for 1.0.

## Goals

- One install model for **registry install**, **direct URL import**, and **local file import**
- Declaration-only install flow
- No arbitrary `install hooks`, `postinstall scripts`, or remote code execution
- Explicit user confirmation for permissions, bindings, and privileged assets
- Durable, resumable install transactions backed by SQLite

## Entry points

- `POST /v1/install/resolve`
- `POST /v1/install/file-import`
- `POST /v1/install/url-import`

All entry points must create an `install_transactions` row immediately.

## Canonical states

### 1. `created`
The transaction exists but source material has not been interpreted yet.

Persist:
- `install_transactions.state = created`

### 2. `manifest_loaded`
The runtime located or extracted the manifest and parsed it successfully.

Checks:
- package archive structure is readable
- manifest JSON is syntactically valid
- `spec_version` is supported

Failure exits:
- `failed` with `error_code = manifest_invalid`

### 3. `integrity_checked`
The runtime verified package checksums and artifact identity.

Checks:
- package sha256 matches expectation
- per-file hashes are valid if present
- source URL / registry artifact matches resolved metadata

Failure exits:
- `failed` with `error_code = integrity_mismatch`

### 4. `compatibility_checked`
The runtime evaluated whether the package can run in the current environment.

Checks:
- runtime version satisfies `compatibility.runtime_range`
- environment is allowed (`desktop`, `docker`, `web_limited`)
- schema version is supported
- package risk class is allowed in the current environment

Failure exits:
- `failed` with `error_code = compatibility_unsupported`

### 5. `dependency_planned`
Dependencies and required capabilities were resolved into an install plan.

Checks:
- dependency package ids and versions
- required capabilities available in local runtime
- MCP requirements can at least be declared, even if not bound yet

Outputs:
- dependency plan
- list of missing or conflicting requirements
- binding requirements

Failure exits:
- `failed` with `error_code = dependency_conflict`

### 6. `awaiting_confirmation`
The runtime needs explicit user consent before materialization.

Typical reasons:
- privileged asset
- non-empty network scope
- filesystem scope beyond `none`
- asset is a fork/derivative with overwrite risk
- install would replace an existing package version

User actions:
- approve
- cancel

Failure exits:
- `cancelled`

### 7. `awaiting_bindings`
The package is compatible, but runtime bindings are incomplete.

Typical bindings:
- `model_profile`
- `mcp_slot`
- `secret_slot`
- `workspace_map`

Persist:
- one `asset_bindings` row per binding requirement
- `status = pending` until user resolves

Transitions:
- when all required bindings are satisfied -> `ready_to_install`

### 8. `ready_to_install`
All gating checks are complete. The package may be materialized.

No side effects yet besides persisted planning records.

### 9. `materializing`
The runtime is writing installed package records and local asset instances.

Actions:
- create or update `installed_packages`
- create `installed_assets`
- create local domain instances such as `employees`
- record any default bindings
- emit `runtime_events`

Failure exits:
- `rolled_back`
- `failed` with `error_code = materialization_failed`

### 10. `installed`
Materialization succeeded and the package is available to the company.

Persist:
- `installed_packages.install_state = installed`
- `install_transactions.finished_at` set

### 11. Terminal failure states

#### `failed`
The install could not proceed and no partial install remains active.

#### `rolled_back`
Materialization started but was reverted due to a downstream error.

#### `cancelled`
The user explicitly aborted the flow before materialization completed.

## Transition rules

```text
created
  -> manifest_loaded
  -> integrity_checked
  -> compatibility_checked
  -> dependency_planned
  -> awaiting_confirmation?  (if policy requires)
  -> awaiting_bindings?      (if bindings missing)
  -> ready_to_install
  -> materializing
  -> installed
```

Error and alternate paths:

```text
manifest_loaded        -> failed
integrity_checked      -> failed
compatibility_checked  -> failed
dependency_planned     -> failed
awaiting_confirmation  -> cancelled
materializing          -> rolled_back | failed
```

## Source-specific notes

### Registry install
Starts with listing/package metadata from the marketplace API, then resolves to an artifact URL and manifest.

### URL import
Starts from a user-provided URL. The runtime must still validate origin, download safely, and verify the package.

### File import
Starts from a local `.aicspkg` file path. Integrity and compatibility checks are identical to other paths.

## Persistence contract

### `install_transactions`
Stores:
- source type and source ref
- target package id and version
- current state
- descriptor JSON
- error details
- timestamps

### `installed_packages`
Created only once the runtime enters `materializing`.

### `installed_assets`
Created per materialized asset within the package.

### `asset_bindings`
Created when required bindings are discovered. These may exist before installation finalizes.

### `runtime_events`
Append-only audit trail for user-visible and debugging events.

## Idempotency rules

- Repeating `resolve` for the same package and company may reuse an unfinished transaction if source and target match.
- `confirm-bindings` must be idempotent by `(install_txn_id, binding_type, binding_key)`.
- `materializing` must run inside a single DB transaction whenever possible.

## Policy rules for 1.0

- No package may execute arbitrary shell commands during install.
- No package may embed real secrets.
- Marketplace assets may declare requirements, but user approval and local binding are always required.
- `web_limited` may resolve packages, but packages requiring local filesystem or localhost MCP cannot install there.
