# Offisim local runtime migrations v0.1

This directory is the local SQLite migration pack used by the desktop app bootstrap.
The desktop runner currently embeds migrations `001` through `019` from this folder in
`apps/desktop/src-tauri/src/lib.rs`.

Apply the executable desktop chain in lexical order:

1. `001_core_tables.sql`
2. `002_install_tables.sql`
3. `003_runtime_orchestration.sql`
4. `004_audit_and_events.sql`
5. `005_llm_calls.sql`
6. `006_langgraph_checkpoints.sql`
7. `007_mcp_audit_log.sql`
8. `008_memory_system.sql`
9. `009_employee_versions.sql`
10. `010_model_cost_rates.sql`
11. `011_sop_templates.sql`
12. `012_office_layouts.sql`
13. `013_library_documents.sql`
14. `014_workstation_racks.sql`
15. `015_prefab_instances.sql`
16. `016_projects.sql`
17. `017_project_assignments.sql`
18. `018_agent_events.sql`
19. `019_recovery_knowledge.sql`

These migrations target SQLite and reflect the Desktop / self-host local runtime model.
Do not delete files from this folder casually; the desktop app currently includes most of them directly.
Thread synopsis persistence is maintained in the package-local migration chain at
`packages/db-local/src/migrations/014_memory_and_thread_synopsis.sql`.
