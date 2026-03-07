# AICS local runtime migrations v0.1

Apply in lexical order.

1. `001_core_tables.sql`
2. `002_install_tables.sql`
3. `003_runtime_orchestration.sql`
4. `004_audit_and_events.sql`

These migrations target SQLite and reflect the Desktop / self-host local runtime model.
