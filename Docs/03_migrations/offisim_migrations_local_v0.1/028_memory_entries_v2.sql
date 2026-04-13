PRAGMA foreign_keys = OFF;

CREATE TABLE memory_entries_new (
  memory_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('employee', 'team', 'company')),
  owner_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('experience', 'decision', 'knowledge', 'preference')),
  content TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0.5 CHECK(importance >= 0.0 AND importance <= 1.0),
  confidence REAL NOT NULL DEFAULT 0.7 CHECK(confidence >= 0.0 AND confidence <= 1.0),
  dedupe_key TEXT NOT NULL,
  reinforcement_count INTEGER NOT NULL DEFAULT 1,
  last_reinforced_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata_json TEXT,
  source_thread_id TEXT,
  source_task_run_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
  access_count INTEGER NOT NULL DEFAULT 0
);

INSERT INTO memory_entries_new (
  memory_id,
  company_id,
  scope,
  owner_id,
  category,
  content,
  importance,
  confidence,
  dedupe_key,
  reinforcement_count,
  last_reinforced_at,
  metadata_json,
  source_thread_id,
  source_task_run_id,
  created_at,
  accessed_at,
  access_count
)
SELECT
  memory_id,
  company_id,
  scope,
  owner_id,
  category,
  content,
  importance,
  MIN(0.98, MAX(0.2, importance + 0.15)) AS confidence,
  LOWER(
    TRIM(
      REPLACE(
        REPLACE(
          REPLACE(
            REPLACE(
              REPLACE(
                REPLACE(
                  REPLACE(
                    REPLACE(
                      REPLACE(
                        REPLACE(
                          REPLACE(
                            REPLACE(
                              REPLACE(
                                REPLACE(
                                  REPLACE(
                                    REPLACE(
                                      REPLACE(content, CHAR(9), ' '),
                                      CHAR(10),
                                      ' '
                                    ),
                                    CHAR(13),
                                    ' '
                                  ),
                                  '.',
                                  ' '
                                ),
                                ',',
                                ' '
                              ),
                              ':',
                              ' '
                            ),
                            ';',
                            ' '
                          ),
                          '/',
                          ' '
                        ),
                        '，',
                        ' '
                      ),
                      '。',
                      ' '
                    ),
                    '：',
                    ' '
                  ),
                  '；',
                  ' '
                ),
                '、',
                ' '
              ),
              '  ',
              ' '
            ),
            '  ',
            ' '
          ),
          '  ',
          ' '
        ),
        '  ',
        ' '
      )
    )
  ) AS dedupe_key,
  1 AS reinforcement_count,
  COALESCE(accessed_at, created_at, datetime('now')) AS last_reinforced_at,
  NULL AS metadata_json,
  source_thread_id,
  source_task_run_id,
  created_at,
  accessed_at,
  access_count
FROM memory_entries;

DROP TABLE memory_entries;
ALTER TABLE memory_entries_new RENAME TO memory_entries;

CREATE INDEX IF NOT EXISTS idx_memory_scope_owner ON memory_entries(scope, owner_id);
CREATE INDEX IF NOT EXISTS idx_memory_company ON memory_entries(company_id);
CREATE INDEX IF NOT EXISTS idx_memory_importance ON memory_entries(importance DESC);
CREATE INDEX IF NOT EXISTS idx_memory_dedupe
  ON memory_entries(company_id, scope, owner_id, category, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_memory_reinforced
  ON memory_entries(last_reinforced_at DESC);

PRAGMA foreign_keys = ON;
