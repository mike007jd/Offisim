# AICS local runtime migrations v0.1

Apply in lexical order.

1. `001_core_tables.sql`
2. `002_install_tables.sql`
3. `003_runtime_orchestration.sql`
4. `004_audit_and_events.sql`
5. `005_memory_system.sql`
6. `006_employee_versions.sql`
7. `007_model_cost_rates.sql`
8. `008_workstation_racks.sql`
9. `009_prefab_instances.sql`
10. `010_projects.sql`
11. `011_project_assignments.sql`
12. `012_agent_events.sql`
13. `013_recovery_knowledge.sql`
14. `014_memory_and_thread_synopsis.sql`

These migrations target SQLite and reflect the Desktop / self-host local runtime model.
