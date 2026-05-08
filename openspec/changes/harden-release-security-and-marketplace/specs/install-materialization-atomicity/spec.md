## ADDED Requirements

### Requirement: Desktop install materialization SHALL be atomic

Desktop Tauri install materialization SHALL commit installed package rows, installed asset rows, employee rows, and asset binding rows atomically. The desktop reference runtime SHALL NOT use async sequential fallback writes as the final materialization path for persistent SQLite state.

The implementation SHALL provide either a Rust-side `install_materialize_transaction` command that writes all materialization rows on one SQLite connection transaction, or a Tauri sqlite-proxy async transaction contract that guarantees rollback on failure.

#### Scenario: Asset write failure rolls back package row
- **WHEN** materialization creates `installed_packages` and then fails while creating an `installed_assets` row
- **THEN** the transaction rolls back
- **AND** no `installed_packages`, `installed_assets`, `employees`, or `asset_bindings` rows from that install remain

#### Scenario: Successful install commits all rows together
- **WHEN** an employee package install reaches materialization success
- **THEN** the installed package, installed assets, employee row, and bindings become visible together
- **AND** no intermediate partial state is observable after the command returns success

#### Scenario: Browser/memory fallback is not used for desktop release
- **WHEN** `createTauriRuntime` creates `InstallService` in a release desktop app
- **THEN** it supplies an atomic materialization path
- **AND** `transact: undefined` sequential fallback is not the persistent desktop path

### Requirement: Failed install SHALL surface recovery state

If install materialization fails after remote fetch, integrity, compatibility, or dependency planning succeeds, the install transaction SHALL record a terminal failed state with a typed reason and enough metadata for support recovery. It SHALL NOT report installed or leave UI in an indefinite materializing state.

#### Scenario: Materialization failure is typed
- **WHEN** the atomic materialization command fails
- **THEN** the install transaction is marked failed with reason `materialize_failed`
- **AND** the UI shows an install failure state rather than `Installed`

### Requirement: Install materialization SHALL be idempotent per install transaction

Repeated materialization requests with the same install transaction id SHALL NOT duplicate installed package, installed asset, employee, skill, or binding rows. The materialization layer SHALL use an idempotency key and DB uniqueness or locking strategy that makes retry safe after UI double-clicks, process retry, or IPC retry.

Concurrent install requests for the same package version and target company/project SHALL serialize or return a typed conflict. They SHALL NOT create duplicate local employees, duplicate installed package rows, or conflicting bindings.

#### Scenario: Double-click install does not duplicate rows
- **WHEN** the user double-clicks Install and two materialization requests with the same install transaction id arrive
- **THEN** the second request returns the already-created materialization result or a typed idempotent-success response
- **AND** local persistence contains one installed package and one corresponding employee/materialized asset set

#### Scenario: Concurrent same-version install is serialized or conflicts
- **WHEN** two install requests for the same listing/package version and same target company run concurrently
- **THEN** the implementation serializes them or returns a typed conflict for one request
- **AND** no duplicate installed employee or package rows are created

#### Scenario: Retry after materialize failed is explicit
- **WHEN** a prior install transaction is marked `materialize_failed`
- **THEN** retry either reuses the same idempotency key with cleanup/rollback guarantees or creates a new explicit retry transaction
- **AND** the UI does not silently merge failed and successful attempts into ambiguous state
