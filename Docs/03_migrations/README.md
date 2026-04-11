# Migration Packs

This folder contains migration packs and migration snapshots used by different parts of the repo.

## What is actually executed

- `offisim_migrations_local_v0.1/` is the SQL pack currently embedded by the desktop app.
- `offisim_migrations_platform_v0.1/` is the documented Postgres pack aligned with the platform migration chain.
- `packages/db-local/src/migrations/` is a package-local SQLite migration subset used by the current local DB package and tests.
- `packages/db-platform/src/migrations/` is the executable Postgres migration chain for the platform service.

## Current boundary

- Desktop currently wires local migrations `001` through `021` from `offisim_migrations_local_v0.1/` in `apps/desktop/src-tauri/src/lib.rs`.
- Structured thread synopsis persistence now lives in the package-local chain at `packages/db-local/src/migrations/014_memory_and_thread_synopsis.sql`.
- Platform currently uses migrations `001` through `006`, including `005_better_auth.sql` and `006_user_library_unique.sql`.

This README is an overview only — the authoritative migration list is the `tauri_plugin_sql::Migration` array in `apps/desktop/src-tauri/src/lib.rs` (local) and the file list under `packages/db-platform/src/migrations/` (platform). When these packs drift, the mounted app code and package migration directories win.
