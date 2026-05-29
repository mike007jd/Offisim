-- 0002: Foreign-key indexes + ON DELETE policies.
--
-- Postgres does NOT auto-index foreign-key columns. Before this migration the
-- platform schema had zero indexes on FK / hot lookup columns, so every join,
-- "by creator/listing/user" query, and every parent DELETE (which scans child
-- tables for referencing rows) was a sequential scan. It also had no ON DELETE
-- behaviour, so deleting a listing or package version was blocked by NO ACTION.
--
-- This migration is additive + idempotent:
--   * CREATE INDEX IF NOT EXISTS for the FK / hot columns NOT already covered by
--     the left-most column of an existing unique index.
--   * Swap the relevant FK constraints to ON DELETE CASCADE / SET NULL. The
--     swap is done name-agnostically (look up the existing FK by table+column in
--     pg_constraint and drop whatever it is named) so it does not depend on the
--     exact auto-generated constraint name in any given environment.

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS listings_creator_id_idx ON listings (creator_id);
CREATE INDEX IF NOT EXISTS listing_previews_listing_id_idx ON listing_previews (listing_id);
CREATE INDEX IF NOT EXISTS publish_drafts_creator_id_idx ON publish_drafts (creator_id);
CREATE INDEX IF NOT EXISTS publish_drafts_listing_id_idx ON publish_drafts (listing_id);
CREATE INDEX IF NOT EXISTS package_lineage_package_version_id_idx ON package_lineage (package_version_id);
CREATE INDEX IF NOT EXISTS package_lineage_origin_listing_id_idx ON package_lineage (origin_listing_id);
CREATE INDEX IF NOT EXISTS moderation_jobs_assigned_to_idx ON moderation_jobs (assigned_to);
CREATE INDEX IF NOT EXISTS moderation_jobs_target_idx ON moderation_jobs (target_type, target_id);
CREATE INDEX IF NOT EXISTS reviews_user_id_idx ON reviews (user_id);
CREATE INDEX IF NOT EXISTS user_library_listing_id_idx ON user_library (listing_id);
CREATE INDEX IF NOT EXISTS user_library_package_version_id_idx ON user_library (package_version_id);
CREATE INDEX IF NOT EXISTS install_receipts_user_id_idx ON install_receipts (user_id);
CREATE INDEX IF NOT EXISTS install_receipts_listing_id_idx ON install_receipts (listing_id);
CREATE INDEX IF NOT EXISTS install_receipts_package_version_id_idx ON install_receipts (package_version_id);
CREATE INDEX IF NOT EXISTS moderation_flags_reporter_user_id_idx ON moderation_flags (reporter_user_id);
CREATE INDEX IF NOT EXISTS moderation_flags_target_idx ON moderation_flags (target_type, target_id);

-- ── ON DELETE policies ───────────────────────────────────────────────────────
-- Helper: drop whatever FK constraint currently enforces (table.column) and
-- re-add it with the desired ON DELETE action. Name-agnostic so it tolerates
-- environments provisioned by drizzle-kit push vs. explicit migrations.
DO $$
DECLARE
  spec record;
  con_name text;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      -- table,            column,               referenced_table, referenced_col, on_delete
      ('package_versions', 'listing_id',          'listings',         'listing_id',          'CASCADE'),
      ('listing_tags',     'listing_id',          'listings',         'listing_id',          'CASCADE'),
      ('listing_previews', 'listing_id',          'listings',         'listing_id',          'CASCADE'),
      ('package_lineage',  'package_version_id',  'package_versions', 'package_version_id',  'CASCADE'),
      ('package_lineage',  'origin_listing_id',   'listings',         'listing_id',          'SET NULL'),
      ('publish_drafts',   'listing_id',          'listings',         'listing_id',          'SET NULL'),
      ('moderation_jobs',  'assigned_to',         'users',            'user_id',             'SET NULL')
    ) AS t(child_table, child_col, ref_table, ref_col, on_delete)
  LOOP
    -- Find the existing FK constraint on (child_table.child_col), if any.
    SELECT con.conname INTO con_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE con.contype = 'f'
      AND nsp.nspname = 'public'
      AND rel.relname = spec.child_table
      AND con.conkey = ARRAY[
        (SELECT attnum FROM pg_attribute
          WHERE attrelid = rel.oid AND attname = spec.child_col)
      ]::smallint[]
    LIMIT 1;

    IF con_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', spec.child_table, con_name);
    END IF;

    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(%I) ON DELETE %s',
      spec.child_table,
      spec.child_table || '_' || spec.child_col || '_fk',
      spec.child_col,
      spec.ref_table,
      spec.ref_col,
      spec.on_delete
    );
  END LOOP;
END $$;
