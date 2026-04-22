## 1. Product Catalog And Schema

- [ ] 1.1 Define `ProviderProductId`, access-mode types, and product-centric saved config types in shared-types and provider-config
- [ ] 1.2 Replace the current preset registry with a product catalog that separates product identity from transport profile and execution-lane metadata
- [ ] 1.3 Implement legacy config migration from current preset/provider records into the new product-centric schema, including safe null/reconfigure paths

## 2. Settings UX And Controller

- [ ] 2.1 Refactor Settings provider state/controller APIs from preset/compat-centric fields to product-centric fields
- [ ] 2.2 Rebuild the provider tab around product selection, access mode, model selection, and an advanced routing section for endpoint/lane overrides
- [ ] 2.3 Preserve dirty tracking, save orchestration, and runtime reinit semantics under the new product-centric schema

## 3. Runtime Resolution And Trusted Host

- [ ] 3.1 Add runtime resolution from saved product config to resolved transport profile and active execution binding
- [ ] 3.2 Introduce trusted-host availability/auth resolver contracts for local-auth products such as `codex` and `claude`
- [ ] 3.3 Keep API-key and custom-compatible products on explicit verified transport profiles without silent fallback between product families

## 4. Verification And Docs

- [ ] 4.1 Expand harness and migration coverage for product IDs, unavailable-host states, and legacy config translation
- [ ] 4.2 Update provider matrix, protocol ledger, canonical specs, and settings copy to the new product taxonomy
