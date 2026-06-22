# Local SQLite Migrations

Offisim has not had a public release, so the local database (`offisim.db`) ships
as a **single flattened public baseline** (version 1). There is no prelaunch
upgrade history to preserve — the whole end-state shape lives in `../schema.sql`
and fresh installs bootstrap straight from it, stamped via `PRAGMA user_version`.

This directory is intentionally empty of migration files. Public migration
history starts only **after** the first public release baseline.

The runner lives in `apps/desktop/src-tauri/src/local_db.rs` (`ensure_schema`):
it reads `PRAGMA user_version`, applies any pending entries sequentially (each in
its own transaction together with the version stamp), and refuses to open a
database whose version is newer than the build.

## Adding the first post-launch migration

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
