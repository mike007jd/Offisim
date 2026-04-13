# Offisim local runtime migrations v0.1

This directory is the local SQLite migration pack used by the desktop app bootstrap.
The desktop runner currently embeds migrations `001` through `028` from this folder in
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
20. `020_sop_template_remote.sql`
21. `021_installed_packages_provenance.sql`
22. `022_file_history.sql`
23. `023_thread_compact_baseline.sql`
24. `024_durable_interactions.sql`
25. `025_fix_mcp_audit_fk.sql`
26. `026_company_template_metadata.sql`
27. `027_zones.sql`
28. `028_memory_entries_v2.sql`

These migrations target SQLite and reflect the Desktop / self-host local runtime model.
Do not delete files from this folder casually; the desktop app currently includes most of them directly.
Thread synopsis persistence is maintained in the package-local migration chain at
`packages/db-local/src/migrations/014_memory_and_thread_synopsis.sql`.
