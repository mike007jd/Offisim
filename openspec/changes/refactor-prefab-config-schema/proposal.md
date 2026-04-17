## Why

`prefab-instances` 和 `prefab-defs` 两张表的 `bindings_json` / `config_json` 两列是 stringified JSON，跨 25+ 文件 + DB schema 散读散写。每个 consumer 自己 `JSON.parse(str)` + 自己 narrow 类型，没有统一 schema，没有 AJV 校验，runtime 错误容易漏到 3D 渲染层。typed-json-field-parsers canonical spec 已经捕获了"字段反序列化应集中"的总原则，本 change 是把它落地到 prefab config 这个具体字段。

和 A/B 级热点不同——这不是"拆大文件"，是"字段设计"重构：需要新 interface union + AJV schema + 解析器 + 渐进迁移 consumer + DB migration（保 backward-compat）。风险面大，计划 A/B 级全收完后再做（sequential，不并行）。

## What Changes

- **新 capability `prefab-config-schema`** 定义：
  - `PrefabConfig` 联合类型（per-prefab-type discriminated union：`PrefabConfig<'workstation'>` / `PrefabConfig<'lounge'>` / `PrefabConfig<'rack'>` 等 11 种 prefab archetype）
  - `PrefabBinding` 联合类型（按 binding type 分：slot / anchor / role-pin）
  - AJV schema `prefab-config.schema.json` 在 `packages/asset-schema/` 或 `packages/shared-types/schemas/`
- **新 parser module** `packages/shared-types/src/prefab-config.ts`（或 `packages/core/src/utils/`）：
  - `parsePrefabConfig(json: string, archetype: PrefabArchetype): Result<PrefabConfig, ParseError>`
  - `parsePrefabBindings(json: string): Result<PrefabBinding[], ParseError>`
  - `stringifyPrefabConfig(cfg: PrefabConfig): string`
  - `stringifyPrefabBindings(bindings: PrefabBinding[]): string`
- **阶段 1: 定义类型 + schema + parser**，不动任何 consumer 调用点。只是新增 types/parsers/schemas，旧代码照旧用 `JSON.parse`。
- **阶段 2: 迁移高风险 consumer**（render registry / prefab-spatial / seat-registry 这些 3D/2D 渲染路径），改用 parser 返回 typed config；parse 失败 fallback 到安全默认值 + console warn。
- **阶段 3: 迁移低风险 consumer**（Studio editor / install 路径 / repo read-back）。
- **阶段 4: DB migration** 新增 `bindings_schema_version` / `config_schema_version` 列（INTEGER default 1），为未来 schema 升级留 migration hook；旧列不 drop，保 backward-compat。
- **阶段 5: 全仓 grep 确认 `JSON.parse(.*bindings_json|config_json)` 零原始匹配**（只走 parser）。
- **可观测行为**：runtime 所有 prefab 渲染 / 交互 byte-identical；parse 失败场景改进（之前静默 crash，现在 fallback + warn）。

## Capabilities

### New Capabilities

- `prefab-config-schema`

### Modified Capabilities

（无。`typed-json-field-parsers` 已有总原则，不 modify）

## Impact

- **新增**：`packages/shared-types/src/prefab-config.ts`（types + parsers）+ `schemas/prefab-config.schema.json`
- **DB migration**：`bindings_schema_version` / `config_schema_version` 列加到 `prefab_instances` + `prefab_defs`；package-local + desktop 双份
- **文件修改**：25+ consumer 分阶段迁移（render registry / prefab-spatial / seat-registry / studio editor / install / repos）
- **验证**：每阶段独立 live runtime 验证；阶段 1-2 后对比重构前 prefab 渲染截图；阶段 4 完成后跨 browser + desktop 双端测；阶段 5 grep gate 达标
- **无依赖升级（AJV 已存在于 `asset-schema` 包）**
- **Scope 前置条件**：A 级 ② ③ 和 B 级 ④-⑦ 全部 archived 后才开工。单独成多阶段大 change，不和其他并行
