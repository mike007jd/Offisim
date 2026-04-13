CREATE TABLE IF NOT EXISTS zones (
  zone_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  archetype TEXT,
  label TEXT NOT NULL,
  accent_color TEXT NOT NULL DEFAULT '#64748b',
  floor_color REAL NOT NULL DEFAULT 0x2a3a5c,
  cx REAL NOT NULL DEFAULT 0,
  cz REAL NOT NULL DEFAULT 0,
  w REAL NOT NULL DEFAULT 10,
  d REAL NOT NULL DEFAULT 8,
  target_roles_json TEXT,
  allowed_categories_json TEXT,
  activity_types_json TEXT,
  desk_slots INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_zones_company
  ON zones(company_id);
