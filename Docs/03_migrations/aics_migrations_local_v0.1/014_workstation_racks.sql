-- Migration 014: Workstation-Rack bindings (PRD 2.3)
-- Links workstations to racks to implement desk-scoped MCP tool permissions.
-- When an employee leaves a workstation, they lose access to that desk's tools.

CREATE TABLE IF NOT EXISTS workstation_racks (
  workstation_id TEXT NOT NULL REFERENCES workstations(workstation_id) ON DELETE CASCADE,
  rack_id TEXT NOT NULL REFERENCES racks(rack_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workstation_id, rack_id)
);
