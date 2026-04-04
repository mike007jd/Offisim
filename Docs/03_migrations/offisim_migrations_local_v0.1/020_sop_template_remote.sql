-- Add remote source tracking to SOP templates
ALTER TABLE sop_templates ADD COLUMN source_url TEXT;
ALTER TABLE sop_templates ADD COLUMN version TEXT;
ALTER TABLE sop_templates ADD COLUMN last_synced_at TEXT;
