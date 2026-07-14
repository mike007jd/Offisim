# Local SQLite Baseline

Offisim is prelaunch. There is no historical local database contract to
preserve, and this directory intentionally contains no migration SQL files.

Fresh databases bootstrap from `../schema.sql`; the single version source of
truth is `LOCAL_SCHEMA_VERSION` in `apps/desktop/src-tauri/src/local_db.rs`.

Existing local/dev databases with any other `user_version`, or with tables but
no version stamp, are disposable artifacts. Delete the local database and let
the app rebuild the current baseline.

Before public launch, schema changes update `../schema.sql` and `../schema.ts`
directly. Do not add compatibility migrations, fallback paths, or upgrade
helpers unless the project deliberately establishes a real post-launch data
contract.
