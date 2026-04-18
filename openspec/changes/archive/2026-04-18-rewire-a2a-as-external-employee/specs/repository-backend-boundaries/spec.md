## ADDED Requirements

### Requirement: Employees family repo carries external A2A fields across three db-local backends

The `employees` family repo files (`packages/core/src/runtime/repos/employees/drizzle.ts`, `packages/core/src/runtime/repos/employees/memory.ts`, `apps/web/src/lib/tauri-repos/employees.ts`) SHALL map six new columns — `is_external` (integer 0/1), `a2a_url` (text nullable), `a2a_token` (text nullable), `a2a_agent_id` (text nullable), `brand_key` (text nullable), `agent_card_json` (text nullable) — in both directions (`create` / `update` write, `findById` / `findByCompany` / `findByRole` read).

The `NewEmployee` type in `packages/install-core/src/types.ts` and the `EmployeeRow` / `EmployeeUpdate` types in `packages/core/src/runtime/repositories.ts` SHALL accept these fields; `NewEmployee.is_external` is typed `boolean` (optional) and the five optional text fields default to `null` when omitted. `EmployeeRow.is_external` is typed `number` (0 or 1) to match SQLite storage.

These three backends all target **db-local SQLite** (desktop via Tauri SQL plugin, memory for browser/tests, drizzle for node services). The marketplace backend (`packages/db-platform/`, PostgreSQL) does NOT have an `employees` table — it is a multi-tenant registry schema (users / creators / listings / package_versions / reviews / install_receipts / api_tokens / …). This change does NOT touch `packages/db-platform/`.

The three db-local backends SHALL return byte-identical `EmployeeRow` objects for the same logical employee record.

#### Scenario: All three db-local backends round-trip external employee
- **WHEN** the same external employee record (with `is_external: true`, `a2a_url: 'http://x'`, `brand_key: 'custom'`, other four null) is written via each db-local backend's `create` (drizzle / memory / tauri) and then read back via `findById`
- **THEN** the three returned `EmployeeRow` objects are deep-equal on all six new columns

#### Scenario: Internal employee defaults preserved
- **WHEN** a new internal employee is created via any db-local backend without specifying the six new fields
- **THEN** the returned `EmployeeRow` has `is_external === 0` and the five text fields are `null`

#### Scenario: Update patch allows external field changes
- **WHEN** `update(employeeId, { a2a_url: 'http://new', agent_card_json: '{...}' })` is called on an existing external employee via any db-local backend
- **THEN** subsequent `findById(employeeId)` returns the new `a2a_url` and `agent_card_json` while leaving other fields unchanged

#### Scenario: db-platform untouched
- **WHEN** running `git diff --stat packages/db-platform/` at the end of this change
- **THEN** the diff is empty — no schema, migration, or type changes have been applied to db-platform (it does not contain an employees table and is out of scope for this change)
