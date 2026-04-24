## 1. Product Layer And Schema

- [x] 1.1 Define `ProviderProductId`, access-mode types, `ResolvedProviderVariant`, and product-centric saved config types in shared-types and provider-config
- [x] 1.2 Replace the current preset-first registry with a product resolution layer that consumes `catalog/provider-source-registry/generated/curated-catalog.json` for API/compat products and adds repo-owned local-auth products such as `codex` / `claude`
- [x] 1.3 Implement legacy config migration from current preset/provider records into the new product-centric schema, including safe null/reconfigure paths

## 2. Settings UX And Controller

- [x] 2.1 Refactor Settings provider state/controller APIs from preset/compat-centric fields to product-centric fields and resolved provider-variant metadata
- [x] 2.2 Rebuild the provider tab around product selection, access mode, model selection, and an advanced routing section for variant/endpoint/lane overrides
- [x] 2.3 Preserve dirty tracking, save orchestration, and runtime reinit semantics under the new product-centric schema

## 3. Runtime Resolution And Trusted Host

- [x] 3.1 Add runtime resolution from saved product config to resolved provider variant, resolved transport profile, and active execution binding
- [x] 3.2 Introduce trusted-host availability/auth resolver contracts for local-auth products such as `codex` and `claude`
- [x] 3.3 Keep API-key and custom-compatible products on explicit verified transport profiles without silent fallback between product families

## 4. Registry Integration, Verification And Docs

- [x] 4.1 Expand migration and settings/runtime coverage for curated-catalog consumption, product-to-variant resolution, unavailable-host states, and legacy config translation
- [x] 4.2 Update provider matrix, protocol ledger, canonical specs, and settings copy to the new product taxonomy, explicitly documenting the ownership split between source-registry and product taxonomy

## Suggested Execution Order

1. Start with types and persistence shape, not UI:
   `packages/shared-types/src/models.ts` and `packages/ui-office/src/lib/provider-config.ts`
2. Replace the preset-first resolution layer next:
   `packages/ui-office/src/components/settings/provider-presets.ts` or a new adjacent product-catalog module that consumes `catalog/provider-source-registry/generated/curated-catalog.json`
3. Then refactor controller ownership:
   `packages/ui-office/src/components/settings/controller/useSettingsProviderState.ts`
   `packages/ui-office/src/components/settings/controller/assembleSettingsControllerApi.ts`
   `packages/ui-office/src/components/settings/controller/useSettingsSaveOrchestrator.ts`
4. Only after controller payloads stabilize, rebuild the Settings UI:
   `packages/ui-office/src/components/settings/SettingsProviderTab.tsx`
   `packages/ui-office/src/components/settings/SettingsWorkspaceSurface.tsx`
5. Then wire runtime resolution and host gating:
   `apps/web/src/lib/browser-runtime.ts`
   `apps/web/src/lib/tauri-runtime.ts`
   `packages/ui-office/src/lib/desktop-provider-secrets.ts`
6. Finish with focused tests and docs:
   add product-migration / product-resolution tests near the touched UI-office runtime helpers, and keep source-registry verification in `scripts/provider-source-registry/test/provider-source-registry.test.mjs`
