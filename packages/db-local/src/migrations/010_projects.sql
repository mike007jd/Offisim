-- Migration 010: Project entity + graph_threads table fix
-- Fix: direct_chat entry_mode missing from 003 CHECK constraint.
-- SQLite cannot ALTER CHECK constraints, so recreate the table.
PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS graph_threads_new (
  thread_id    TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  entry_mode   TEXT NOT NULL CHECK (entry_mode IN (
    'boss_chat', 'meeting', 'install_flow', 'background_sync', 'direct_chat'
  )),
  root_task_id TEXT,
  status       TEXT NOT NULL CHECK (status IN (
    'queued', 'running', 'blocked', 'paused', 'completed', 'failed', 'cancelled'
  )),
  project_id   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
INSERT INTO graph_threads_new (thread_id, company_id, entry_mode, root_task_id, status, created_at, updated_at)
  SELECT thread_id, company_id, entry_mode, root_task_id, status, created_at, updated_at
  FROM graph_threads;
DROP TABLE graph_threads;
ALTER TABLE graph_threads_new RENAME TO graph_threads;
CREATE INDEX IF NOT EXISTS idx_graph_threads_company ON graph_threads(company_id, created_at);

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  project_id  TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  thread_id   TEXT UNIQUE REFERENCES graph_threads(thread_id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'planning'
    CHECK(status IN ('planning', 'active', 'paused', 'completed', 'archived')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_company
  ON projects(company_id, status, updated_at DESC);

-- Clean up legacy single-thread-per-company checkpoint data from SqliteSaver tables
DELETE FROM checkpoints WHERE thread_id LIKE 'thread-%';
DELETE FROM writes WHERE thread_id LIKE 'thread-%';
