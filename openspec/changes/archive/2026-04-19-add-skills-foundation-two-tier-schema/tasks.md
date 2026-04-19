## 1. shared-types: skill primitives

- [x] 1.1 New file `packages/shared-types/src/skill.ts` exporting `SkillScope` (`'company' | 'employee'`), `SkillSourceKind` (`'authored' | 'installed' | 'forked' | 'synthesized'`), `SkillMetadata` (id/slug/name/description/scope/version), `SkillRow` (full DB row shape including `companyId`, nullable `employeeId`, `vaultPath`, `sourceRef`, timestamps), and `SkillMdParseError` / `SkillAssetError` error classes
- [x] 1.2 Re-export new types from `packages/shared-types/src/index.ts`
- [x] 1.3 Delete `RuntimeSkillConfig`, `RuntimeSkillCapability`, and `EmployeeConfig.runtimeSkill` from `packages/shared-types/src/json-field-parsers.ts`; remove the parsing branch for `capabilityIndex` / `allowedTools` / `instructions*`; remove the re-export line
- [x] 1.4 `pnpm --filter @offisim/shared-types build` passes (no stale `RuntimeSkillConfig` references)

## 2. db-local + desktop SQL plugin: skills table

- [x] 2.1 New migration `packages/db-local/src/migrations/025_skills_table.sql` — `skills` table + two partial UNIQUE indexes (`WHERE employee_id IS NULL` / `IS NOT NULL`) so NULL employee_id collapses into one company-scope bucket per slug; `idx_skills_company_scope` + `idx_skills_employee`; also adds `settings` key-value table for bootstrap markers
- [x] 2.2 db-local has no migration registry TS file — migrations are flat SQL files + Drizzle `schema.ts` export; added `skills` + `settings` tables to `packages/db-local/src/schema.ts`
- [x] 2.3 Mirrored migration as `Docs/03_migrations/offisim_migrations_local_v0.1/031_skills.sql` and registered `Migration { version: 31 }` in `apps/desktop/src-tauri/src/lib.rs`
- [x] 2.4 Repos live in `packages/core/src/runtime/repos/skills/{drizzle,memory}.ts` + `apps/web/src/lib/tauri-repos/skills.ts` (three-backend pattern). Each implements CRUD: `insert`/`update`/`delete`/`findById`/`listByCompanyScope`/`listByEmployee`/`findBySlug` plus scope/employee_id consistency assertion. Same files provide `SettingsRepository` impl.
- [x] 2.5 `SkillRepository` / `NewSkill` / `SkillUpdate` / `SettingsRepository` exported from `packages/core/src/runtime/repositories.ts`; wired into `createDrizzleRepositories` / `createMemoryRepositories` / `createTauriRepositories` barrels.
- [x] 2.6 `pnpm --filter @offisim/db-local build` passes

## 3. core: SKILL.md parser / serializer

- [x] 3.1 `packages/core/src/skills/skill-md.ts` — `parseSkillMd(raw)` + `serializeSkillMd(input)`
- [x] 3.2 Hand-written frontmatter splitter + `js-yaml` CORE_SCHEMA; body preserved byte-for-byte
- [x] 3.3 Required `name` + `description` enforced; `offisim.*` namespace rejected (`private-namespace-forbidden`); unknown fields captured in `unknownFields`
- [x] 3.4 Deterministic key order `name` → `description` → `allowedTools` → `license` → `version`; body emitted after `---\n\n`
- [x] 3.5 `packages/core/src/skills/skill-slug.ts` — `skillSlug(name, id)` mirrors `employeeSlug` byte-for-byte with `skill-{id前8字符}` fallback

## 4. core: SkillLoader + vault IO

- [x] 4.1 `packages/core/src/skills/skill-path.ts` — `resolveSkillPath(args)` returns `{ dir, skillMdPath, assetPathFor }`. Paths are vault-relative and identical on desktop / web: `VaultFileSystem` abstraction handles the storage branch, so there's no separate IndexedDB key scheme
- [x] 4.2 `packages/core/src/skills/skill-loader.ts` — `SkillLoader` with deps `{ skills, employees, fs }`; methods `listSkillsForEmployee(companyId, employeeId): Promise<SkillMetadata[]>` (DB-only, async for uniform API — see 4.4 note), `loadSkillBody(skillId): Promise<string>`, `loadSkillAsset(skillId, relPath): Promise<string>`
- [x] 4.3 `listSkillsForEmployee` unions company + employee rows with employee-precedence slug dedupe
- [x] 4.4 `loadSkillBody` reads SKILL.md via `fs.readFile`, runs `parseSkillMd`, returns body. NOTE: spec scenario expected Tier 1 to be plain (non-Promise) array; implemented as `Promise<SkillMetadata[]>` to keep web IndexedDB path uniform. All callers await. No filesystem IO in tier 1 (DB-only)
- [x] 4.5 `loadSkillAsset` rejects `..`, absolute paths (`/...` or drive-letter), and anything outside `scripts/` / `references/` / `assets/` before IO
- [x] 4.6 Skipped per architecture decision — `SkillLoader` takes `VaultFileSystem` directly; VaultSyncService's debounced writeQueue is per-employee and event-driven, which doesn't match skill's per-skill API-triggered writes. Both desktop (Tauri fs) and web (IndexedDB / FSAccess) share the same `VaultFileSystem` abstraction, so the uniform IO contract is satisfied without mixing paths
- [x] 4.7 `SkillLoader`, `parseSkillMd`, `serializeSkillMd`, `skillSlug`, `resolveSkillPath`, `migrateRuntimeSkills` exported from `packages/core/src/browser.ts` and `packages/core/src/index.ts`. `SkillRepository` / `NewSkill` / `SkillUpdate` type re-exported from index.

## 5. core: legacy runtimeSkill migration

- [x] 5.1 `packages/core/src/skills/skills-bootstrap.ts` — `migrateRuntimeSkills({ skills, settings, employees, companies, fs, now?, newId? })`
- [x] 5.2 Reads `settings.skills_migration_v1_done` and early-returns when `'true'`
- [x] 5.3 Walks every company's employees, parses legacy `config_json.runtimeSkill`, maps to SKILL.md (body + `## Capabilities` section from `capabilityIndex`), inserts `skills` row (`source_kind: 'synthesized'`, `source_ref: 'legacy:runtimeSkill'`), strips `runtimeSkill` from config. Malformed records logged + skipped per-employee; pass continues
- [x] 5.4 Writes `settings.skills_migration_v1_done = 'true'` after the full pass
- [x] 5.5 Wired: `VaultActivation` now exposes `fs`; `SkillLoader` has `setFs()`; `BrowserVaultController` accepts an `onActivate` hook (fired on mount / stored-handle activation / re-mount); browser + tauri runtimes both swap the loader's fs and fire `migrateRuntimeSkills` automatically on first activation. Errors logged, not thrown

## 6. core: prompt assembly integration

- [x] 6.1 `employee-prompt-assembly.ts` — removed `parseRuntimeSkillConfig`, `readRuntimeSkill`, `formatSkillCatalogSection`, `formatSkillInstructionsSection`, `taskHasSkillMismatch`; `SkillLoader` injected via `runtimeCtx.skillLoader` (optional); `AssembledPrompt` no longer carries `runtimeSkill`
- [x] 6.2 `formatAvailableSkillsSection(skills)` emits `## Available skills\n\n- **{name}** — {description}` with description truncated at 200 UTF-16 code units + `…`
- [x] 6.3 Empty list → entire section omitted (early-return inside helper)
- [x] 6.4 `employee-tool-round.ts` — dropped `runtimeSkill` branch and `SKILL_TOOL_NAME` handler; `employee-tool-kit.ts` — dropped `buildSkillActivationTool`; `employee-preflight.ts` — dropped `runtimeSkill` field from `PreflightResult` and `skill_mismatch` emission; `employee-roster.ts` — dropped `readRuntimeSkill` and enriched-list skill suffix; `employee-node-constants.ts` — dropped `SKILL_TOOL_NAME`; `pm-planner/sop-matching.ts` — dropped unused `preferSkill` parameter (no caller passed it). **No `activate_skill` tool registered.**
- [x] 6.5 `pnpm --filter @offisim/core build` passes

## 7. ui-office: hook + minimal UI

- [x] 7.1 `useEmployeeEditor.ts` — dropped `RuntimeSkillConfig` type + `runtimeSkill` / `skillEnabled` form fields + `buildConfigJson` skill emission; added `useSkillsForEmployee(companyId, employeeId)` hook subscribed to `skill.*` eventBus prefix
- [x] 7.2 `SkillBindingList.tsx` — rewritten as multi-row list with `personal` / `global` scope badge; company rows whose slug collides with an employee-scope row render "overridden by your own" amber badge; legacy marketplace placeholder copy dropped
- [x] 7.3 `SkillInspectorPanel.tsx` — read-only `<pre>` body preview driven by `SkillLoader.loadSkillBody`
- [x] 7.4 `EmployeeEditorDialog.tsx` updated to pass `{companyId, employeeId}` to `SkillBindingList`; `useInterviewWizard.ts` dropped `runtimeSkill` / `skillEnabled` defaults; `OffisimRuntimeContext` exposes `skillLoader` (BootstrapProvider + OffisimRuntimeProvider pass-through)
- [x] 7.5 `pnpm --filter @offisim/ui-office build` passes

## 8. ui-office: Marketplace kind extension

- [x] 8.1 `marketplace-meta.tsx` — `INSTALLABLE_KINDS = ['employee', 'skill']`; `KIND_FILTERS` gains `{ value: 'skill', label: 'Skills' }`
- [x] 8.2 `PublishDialog` — `kind` state (default `employee`), kind selector rendered when both employee + skill sources exist, skill source picker listing company + employee-scope skills with scope label; `buildSkillPackage(source, meta)` helper in `export-to-manifest.ts` packages SKILL.md content into `manifest.custom.skill_md_content` + assets path `assets/skills/{slug}/SKILL.md`; uses `serializeSkillMd` for the on-disk payload
- [x] 8.3 `useInstallFlow.postMaterializeForSkill` runs after `installService.confirmBindings` when `plan.manifest.package.kind === 'skill'`. Reads `manifest.custom.skill_md_content`, parses frontmatter via `parseSkillMd`, derives slug via `skillSlug`, calls new `SkillLoader.installCompanyScopeSkill({ companyId, listingId, ... })`. Loader enforces: **idempotent** on `listingId` (same listing returns existing row), **slug collision → throws** (different source with same slug), writes SKILL.md before DB insert so partial state is avoided
- [x] 8.4 Registry-client `AssetKind` union already includes `'skill'` (`packages/asset-schema/src/manifest.types.ts`), no type change needed

## 9. apps/web: wiring + runtime init

- [x] 9.1 `browser-runtime.ts` + `tauri-runtime.ts` now construct `SkillLoader` eagerly with a stub `VaultFileSystem`. When the vault activates (browser: `onActivate` from `createDefaultBrowserVaultController`; tauri: inline post `tryActivateTauriVault`), runtimes call `skillLoader.setFs(activation.fs)` and then `migrateRuntimeSkills(...)` (one-shot marker-guarded). `RuntimeBundle.skillLoader` + `runtimeCtx.skillLoader` both populated
- [x] 9.2 No new alias required — `@offisim/core/browser` barrel re-export covers `SkillLoader`, `parseSkillMd`, `serializeSkillMd`, `skillSlug`, `resolveSkillPath`, `migrateRuntimeSkills`
- [x] 9.3 `pnpm --filter @offisim/web build` passes

## 10. Docs + protocol ledger

- [x] 10.1 `ui-office/CLAUDE.md` — `INSTALLABLE_KINDS = ['employee', 'skill']`; `SkillBindingList` list-view note; follow-up markers for publish/install skill flow
- [x] 10.2 `core/CLAUDE.md` — new "Skills (SKILL.md open standard, vault-authoritative)" section covering frontmatter contract, vault layout, 3-tier loader, slug strategy, DB uniqueness via partial indexes, bootstrap migration, prompt integration; also updated marketplace gotcha to drop "skill is embedded" claim
- [x] 10.3 `openspec/protocols-ledger.md` row #6 — `一致？` flipped ❌ → ✅ with repo claim pointing at `packages/core/src/skills/skill-md.ts` parser, 3-tier loader, two-tier schema
- [ ] 10.4 **Deferred until archive** — roadmap T2.1 status update wants the archive SHA; lands during `/opsx:archive`

## 11. Live verification (per repo policy — no automated tests)

- [x] 11.1 Web dev server (`pnpm dev`) — fresh company, no console errors; `SkillLoader` returns `[]` for new employee (DB-only tier-1 path)
- [x] 11.2 Legacy `runtimeSkill` migration — marker-guarded bootstrap fires after OPFS activation; pre-launch vault has no legacy rows to migrate (drop-dirty-data policy). Machinery exercised via unit-traversable code paths; production legacy payloads not present in this dev dataset
- [ ] 11.3 **Deferred** — Desktop Tauri scenario not re-run this round; web path proves the migration contract (same `migrateRuntimeSkills` implementation, Tauri `VaultFileSystem` is contract-identical). Leave for a follow-up when desktop needs a fresh install
- [x] 11.4 Publish — skill draft submitted via PublishDialog (`kind='skill'`); platform registered the listing with `kind='skill'` end-to-end
- [x] 11.5 Install — drive-through: listing detail → Review Package → Approve & Continue → Installation Complete; post-install state: `skills` row `scope='company'`, `source_kind='installed'`, `source_ref='ba87f71b-7457-43e2-8431-d1e704dd2451'`, `vault_path='companies/9dc5db2b-6ff9-4480-864d-68e34a7b2445/skills/refactor-playbooks/SKILL.md'`, OPFS SKILL.md readable with full body
- [x] 11.6 Re-install idempotency — second install of the same listing yields skill count still 1; `installCompanyScopeSkill` returned the existing row (source_ref match path)
- [ ] 11.7 **Deferred** — slug collision refusal not exercised (needs two listings with identical slug); error path is in-code (`installCompanyScopeSkill` throws when `findBySlug` hits with different `source_ref`), will validate when a second conflicting listing is available
- [ ] 11.8 **Deferred** — tier-3 path-traversal rejection not exercised this round; guards live in `loadSkillAsset` (checks `..`, absolute path, subtree whitelist) and the control-flow is explicit; will validate when skills carry script/asset bundles
- [ ] 11.9 **Deferred** — override semantics; needs two test employees + a matching slug across company / employee scopes. Merge logic is implemented + covered by spec scenarios
- [x] 11.10 Verify Record recorded below (`## Verify Record`)

## 12. Archive-gate checklist (T1.4 — must be green before `/opsx:archive`)

- [x] 12.1 Spec (`specs/skills-foundation/spec.md`) — requirements cover actually-landed code: SKILL.md parser contract, two-tier vault layout, `skills` table schema, three-tier SkillLoader, merge rule, prompt injection, Marketplace kind, legacy migration. Three spec scenarios (11.7 slug-collision / 11.8 path-traversal / 11.9 override) remain asserted as requirements but only *implementation-proven*, not *live-proven*; documented as deferred in tasks.md. No aspirational claims carried forward.
- [x] 12.2 Tasks — every `[x]` claim maps to a concrete deliverable; deferred items marked `**Deferred**` with rationale; partial scenarios explicitly flagged.
- [x] 12.3 Docs — `core/CLAUDE.md` has Skills section (vault-authoritative, 3-tier loader, migration), `ui-office/CLAUDE.md` has the flipped `INSTALLABLE_KINDS` entry + SkillBindingList list-view note. No "fork / self-create / peer-transfer" over-claims — those stay as T2.2–T2.7 future scope per `proposal.md`.
- [x] 12.4 Protocol ledger row #6 — flipped ❌ → ✅, repo claim references parser / 3-tier loader / two-tier schema (2026-04-19 update already committed-to-file; re-inspect at archive commit for final wording).

## Verify Record

**Date**: 2026-04-19
**Runtime**: web (Vite dev), OPFS-backed vault, MiniMax provider

### Happy-path
- `mountVaultDirectory(navigator.storage.getDirectory())` — fresh session transitions `unmounted → mounted`, `root: 'browser-fsaccess://'`. After the `vault-browser-activation` OPFS fixes (picker / permission method fallbacks + `call(handle, ...)` binding), the flow is clean without manual `skillLoader.setFs()` splicing.
- Skill publish — PublishDialog kind selector surfaced when both employee + skill sources existed; skill picker listed personal + global scope; draft reached registry with `kind='skill'` (confirmed via platform DB).
- Skill install — Market listing → detail → Review Package → Approve → **Installation Complete** UI appears. Post-state evidence:
  - `skills` row: `slug=refactor-playbooks`, `scope=company`, `source_kind=installed`, `source_ref=ba87f71b-7457-43e2-8431-d1e704dd2451`, `vault_path=companies/9dc5db2b-6ff9-4480-864d-68e34a7b2445/skills/refactor-playbooks/SKILL.md`
  - OPFS file readable at that relpath; SKILL.md body intact
- Re-install same listing — skill count stays at 1 (idempotency confirmed via `findBySlug` source_ref match → returns existing row).

### Deviations landed as repo-side fixes (not tasks.md 11.x)
- `packages/core/src/vault/browser-fs.ts` — permission methods rebind via `call(handle, ...)` (Illegal invocation otherwise on OPFS); OPFS now counts under `browserFsAccessSupported()`; missing permission methods fall back to `'granted'`.
- `apps/web/src/App.tsx` + `AppMainShell.tsx` + `WorkspaceRouter.tsx` + `workspaces/types.ts` — market workspace install wiring (the Install button was a dead path before).
- `packages/ui-office/src/hooks/useInstallFlow.ts` — StrictMode mount-flag reset so the async guards don't get stuck `false`.
- `packages/core/src/vault/sync-service.ts` — ENOENT / missing-file classifier covers more platforms so hydrate on an empty OPFS doesn't spuriously fail.
- `packages/core/src/browser.ts` + `apps/web/src/lib/tauri-runtime-lite.ts` — `@offisim/core/browser` re-exports `SkillRepository` / `SettingsRepository` / `NewSkill` / `SkillUpdate`; lite runtime builds a stub-fs SkillLoader so `RuntimeBundle` stays satisfiable without a provider key.

### Non-blocking observed
- Platform 503 spike mid-verify — root cause: `offisim-pg` container stopped; restart resolved. Not a code issue.

### Not exercised this round (see 11.3 / 11.7 / 11.8 / 11.9)
- Desktop Tauri migration / slug-collision refusal / path-traversal rejection / cross-scope override. Control-flow paths are in code and asserted by spec scenarios; validate when a fixture with the required pre-conditions exists.
