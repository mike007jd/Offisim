# Offisim platform registry migrations v0.1

Apply in lexical order.

1. `001_auth_and_creators.sql`
2. `002_registry_core.sql`
3. `003_publish_and_lineage.sql`
4. `004_reviews_library_and_moderation.sql`
5. `005_better_auth.sql`
6. `006_user_library_unique.sql`

These migrations target Postgres and reflect the marketplace/control-plane model. The authoritative list is the file set in this directory — when this README drifts, the `.sql` files win.
