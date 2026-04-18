-- 024: External (A2A-backed) employee fields
-- See openspec/changes/rewire-a2a-as-external-employee for rationale.
-- A2A peers are rendered as branded external employees, not as a separate
-- "external department" abstraction. These six columns let the employees
-- table carry the A2A transport target + brand metadata.

ALTER TABLE employees ADD COLUMN is_external INTEGER NOT NULL DEFAULT 0;
ALTER TABLE employees ADD COLUMN a2a_url TEXT;
ALTER TABLE employees ADD COLUMN a2a_token TEXT;
ALTER TABLE employees ADD COLUMN a2a_agent_id TEXT;
ALTER TABLE employees ADD COLUMN brand_key TEXT;
ALTER TABLE employees ADD COLUMN agent_card_json TEXT;

CREATE INDEX IF NOT EXISTS idx_employees_is_external ON employees(is_external);
