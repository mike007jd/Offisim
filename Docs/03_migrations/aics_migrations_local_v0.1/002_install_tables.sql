-- Local install/import state
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS install_transactions (
  install_txn_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('registry', 'url', 'file')),
  source_ref TEXT,
  target_package_id TEXT,
  target_version TEXT,
  state TEXT NOT NULL CHECK (
    state IN (
      'created',
      'manifest_loaded',
      'integrity_checked',
      'compatibility_checked',
      'dependency_planned',
      'awaiting_confirmation',
      'awaiting_bindings',
      'ready_to_install',
      'materializing',
      'installed',
      'failed',
      'rolled_back',
      'cancelled'
    )
  ),
  error_code TEXT,
  error_detail TEXT,
  descriptor_json TEXT,
  actor_type TEXT NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user', 'system')),
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS installed_packages (
  installed_package_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  package_id TEXT NOT NULL,
  package_kind TEXT NOT NULL CHECK (package_kind IN ('employee', 'skill', 'sop', 'company_template', 'office_layout', 'bundle')),
  version TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('registry', 'url', 'file')),
  source_ref TEXT,
  manifest_hash TEXT NOT NULL,
  package_hash TEXT NOT NULL,
  install_state TEXT NOT NULL CHECK (install_state IN ('installed', 'disabled', 'broken', 'pending_upgrade')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  installed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, package_id, version)
);

CREATE TABLE IF NOT EXISTS installed_assets (
  installed_asset_id TEXT PRIMARY KEY,
  installed_package_id TEXT NOT NULL REFERENCES installed_packages(installed_package_id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  asset_kind TEXT NOT NULL CHECK (asset_kind IN ('employee', 'skill', 'sop', 'company_template', 'office_layout', 'bundle_item')),
  local_instance_id TEXT,
  entrypoint TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  override_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(installed_package_id, asset_id)
);

CREATE TABLE IF NOT EXISTS asset_bindings (
  binding_id TEXT PRIMARY KEY,
  installed_asset_id TEXT REFERENCES installed_assets(installed_asset_id) ON DELETE CASCADE,
  install_txn_id TEXT REFERENCES install_transactions(install_txn_id) ON DELETE CASCADE,
  binding_type TEXT NOT NULL CHECK (binding_type IN ('model_profile', 'secret_slot', 'workspace_map', 'mcp_slot')),
  binding_key TEXT NOT NULL,
  binding_value_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'satisfied', 'skipped', 'error')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (installed_asset_id IS NOT NULL OR install_txn_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_install_transactions_company ON install_transactions(company_id, started_at);
CREATE INDEX IF NOT EXISTS idx_installed_packages_company ON installed_packages(company_id);
CREATE INDEX IF NOT EXISTS idx_installed_assets_pkg ON installed_assets(installed_package_id);
CREATE INDEX IF NOT EXISTS idx_asset_bindings_txn ON asset_bindings(install_txn_id);
