-- Migration 015: Prefab instances (Prefab System)
-- Office elements as stateful, bindable AI-concept entities.
-- Seed: migrates existing workstations into workspace prefab instances.

CREATE TABLE IF NOT EXISTS prefab_instances (
  instance_id   TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  prefab_id     TEXT NOT NULL,
  zone_id       TEXT NOT NULL,
  position_x    REAL NOT NULL DEFAULT 0,
  position_y    REAL NOT NULL DEFAULT 0,
  rotation      INTEGER NOT NULL DEFAULT 0,
  bindings_json TEXT,
  config_json   TEXT,
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prefab_instances_company
  ON prefab_instances(company_id);
CREATE INDEX IF NOT EXISTS idx_prefab_instances_zone
  ON prefab_instances(company_id, zone_id);

-- Seed: migrate existing workstations to workspace prefab instances
INSERT OR IGNORE INTO prefab_instances (instance_id, company_id, prefab_id, zone_id, position_x, position_y, rotation, bindings_json, config_json, enabled, created_at, updated_at)
SELECT
  workstation_id,
  company_id,
  'workstation-standard',
  'zone-' || room_type,
  COALESCE(json_extract(position_json, '$.x'), 0),
  COALESCE(json_extract(position_json, '$.y'), 0),
  0,
  NULL,
  NULL,
  1,
  created_at,
  updated_at
FROM workstations;
