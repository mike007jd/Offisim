# Local SQLite Migrations

Upgrade chain for existing user databases (`offisim.db`). Fresh installs never
run these files — they bootstrap straight from `../schema.sql` (the end-state
shape) and are stamped with the latest version via `PRAGMA user_version`.

The runner lives in `apps/desktop/src-tauri/src/local_db.rs`
(`ensure_schema`): it reads `PRAGMA user_version`, applies pending entries
sequentially (each in its own transaction together with the version stamp),
and refuses to open a database whose version is newer than the build.
Databases created before versioning existed (the 1.0.0-rc baseline) are
adopted as version 1.

## Adding a migration

1. Update `../schema.sql` **and** `../schema.ts` to the new end-state shape.
2. Create `NNNN_<short-name>.sql` here, where `NNNN` is the new version
   (zero-padded, starts at `0002`). The file must upgrade version `NNNN - 1`
   to `NNNN`. Plain SQL, multiple statements allowed; no `BEGIN`/`COMMIT`
   (the runner wraps each migration in a transaction).
3. In `apps/desktop/src-tauri/src/local_db.rs`, bump `LOCAL_SCHEMA_VERSION`
   and append `(NNNN, include_str!(...))` to `MIGRATIONS`.
4. Gate: `cargo test` in `apps/desktop/src-tauri` (the `local_db` tests assert
   chain continuity), plus a manual upgrade check against a copy of a real
   pre-upgrade `offisim.db`.

Versions must be consecutive — the runner rejects gaps and incomplete chains
at startup rather than running a partial upgrade.
