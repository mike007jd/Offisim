# CANCELLED — 2026-04-18

This change is cancelled before `/opsx:apply` because a ground-truth audit on 2026-04-18 showed that the proposal / design / tasks / spec were written against a hypothetical architecture that does not exist in the repository.

## Audit findings vs draft claims

| Draft claim | Repo reality (2026-04-18, commit `a31f0ce2`) |
|---|---|
| "25+ consumers do raw `JSON.parse(bindings_json \| config_json)`" | `grep -r 'JSON\.parse.*(bindings_json\|config_json)'` returns **0 matches** outside `archive/`. |
| "Centralized parser needs to be created" | `parsePrefabBindings()` already lives in `packages/shared-types/src/json-field-parsers.ts` and is covered by canonical spec `typed-json-field-parsers`. |
| "11-archetype `PrefabArchetype` discriminated union" | `grep -r 'PrefabArchetype'` returns **0 matches**. No archetype union exists. Real model is `SemanticCategory` (6 values) + `PrefabDefinition (atomic \| composite)` + `PrefabBindingSlotType` (6 values). |
| "`PrefabBinding` should be a discriminated union of slot / anchor / role-pin" | Actual `PrefabBinding` is a flat `{ slotName, resourceRef, label? }` struct. No per-kind discriminator. |
| "`prefab_defs` table also gets `schema_version` columns" | `grep -r 'sqliteTable.*prefab'` returns only `prefab_instances`. **`prefab_defs` table does not exist.** |
| "`config_json` is a heavily-used per-archetype field" | Written once (`prefab-service.ts:106` serializes an anonymous `configOverrides` blob). **Zero read sites.** Effectively a write-only dead column. |
| "Needs AJV schema for internal data" | Existing pick-typed parser pattern in `json-field-parsers.ts` handles the same problem class without adding AJV payload to internal data. |
| "Pre-launch legacy data compatibility required" | Project is pre-launch; user memory preference explicitly says *"Pre-launch 脏数据清掉不写 migration"*. Adding speculative `schema_version` columns violates this and the CLAUDE.md rule "Don't design for hypothetical future requirements." |

## Additional reality checks

- No prefab file is a size hotspot. NBNC counts: `prefab-service.ts` 216, `prefab.ts` 66, `prefab-spatial.ts` 236, `seat-registry.ts` 455.
- Consumer of `parsePrefabBindings`: 4 files only (`prefab-service`, `shared-types/index`, `json-field-parsers` itself, `company-template-service`). Not 25+.

## Decision

Prefab code has no actual C-level 屎山 hotspot. Round 2 refactors effectively close at B-level with this cancellation.

If a future change wants to touch the prefab area, it should start from a fresh audit — candidate real targets:
- Drop the dead `config_json` column on `prefab_instances` (single-file change, but touches a DB migration — still needs its own grounded proposal).
- Type `configOverrides: Record<string, unknown>` in `createInstance()` if callers actually pass anything meaningful (audit would show).

## Archive location

Moved to `openspec/changes/archive/2026-04-18-refactor-prefab-config-schema-cancelled/` with this `CANCELLED.md` attached. Original artifacts kept verbatim for reference.
