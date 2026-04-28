# Offisim local runtime migrations v0.1

This directory is the package-local SQLite migration chain used by `packages/db-local`
and related tests. It is a maintained subset, not a mirror of the desktop app's
embedded SQL pack under `Docs/03_migrations/offisim_migrations_local_v0.1/`.

Apply in lexical order:

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
15. `015_mcp_audit_log.sql`
16. `016_company_template_metadata.sql`
17. `017_file_history.sql`
18. `018_thread_compact_baseline.sql`
19. `019_durable_interactions.sql`
20. _(020 intentionally skipped)_
21. `021_installed_packages_provenance.sql`
22. `022_fix_mcp_audit_fk.sql`
23. `023_deliverables.sql`
24. `024_employees_external_a2a.sql`
25. `025_skills_table.sql`
26. `026_projects_workspace_root.sql`
27. `027_skills_self_authored_source_kind.sql`
28. `028_deterministic_harness_foundation.sql`
29. `029_tool_permission_approval_company_lookup.sql`
30. `030_kanban_cards.sql`
31. `031_session_interaction_mode.sql`

These migrations target SQLite and reflect the current package-local runtime model.
