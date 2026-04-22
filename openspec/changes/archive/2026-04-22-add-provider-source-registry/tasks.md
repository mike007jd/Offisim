## 1. Registry Foundation

- [x] 1.1 Define the provider source registry schema, including source metadata, trust tiers, refresh modes, and owned fields
- [x] 1.2 Seed the first registry entries for official sources, LiteLLM, and Offisim curated overrides

## 2. Snapshot And Merge Pipeline

- [x] 2.1 Implement normalized source snapshot outputs with per-field provenance
- [x] 2.2 Add a LiteLLM ingestion adapter and minimal official-source loaders or fixtures
- [x] 2.3 Implement merge rules that protect official-only fields and surface conflicts

## 3. Review And Product Integration

- [x] 3.1 Generate diff artifacts for new providers, new models, and conflicting metadata
- [x] 3.2 Add a curated merged catalog output that downstream provider taxonomy or matrix tooling can consume
- [x] 3.3 Add tests or fixtures covering trust precedence, manual overrides, and community-source conflicts
