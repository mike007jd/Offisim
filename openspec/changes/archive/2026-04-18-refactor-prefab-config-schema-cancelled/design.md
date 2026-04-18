## Context

Prefab 是 Offisim 场景的核心组成（workstation / lounge / rack / shelf / desk 等 11 种 archetype），每个 prefab instance 有两组 JSON 字段：

- `bindings_json` — string 存 `PrefabBinding[]`，描述 prefab 在 zone 内的空间锚点 / slot 映射 / role-pin（哪些员工被 pin 到哪个 seat）
- `config_json` — string 存 per-prefab-type configuration（e.g. workstation 的 monitor count / lounge 的 seat count / rack 的 slot policy）

现状问题：

1. **类型隐形**：consumer 全部 `const cfg = JSON.parse(row.config_json) as WorkstationConfig`——错字段 TypeScript 不报错，runtime 才知道
2. **字段漂移**：字段增加时没有中心化 schema，render 层可能渲染老 prefab 时读不到新字段
3. **parse 错误静默**：JSON 非法时 `JSON.parse` 抛错，整个 3D 渲染炸掉；没有 fallback 机制

和 A/B 级热点不同，这是**字段设计**问题，不是"文件太大"问题。处理方式也不同：需要先建中心化 schema + parser，再渐进迁移 consumer，最后加 DB migration 为未来升级准备。

## Goals / Non-Goals

**Goals:**

- 定义 `PrefabConfig<T extends PrefabArchetype>` discriminated union 和 `PrefabBinding` 联合
- AJV schema 校验 runtime 数据，parse 失败返回 Result type 而不是抛错
- 所有 consumer 走统一 parser，不再直接 `JSON.parse`
- DB 加 schema version 列为未来 migration 留 hook
- runtime 行为 byte-identical（含 fallback 路径——非法 JSON 以前 crash，现在 warn + default）

**Non-Goals:**

- 不改 prefab 的视觉渲染（silhouette / seat geometry 不动）
- 不改 prefab catalog 定义（`renderer/prefab/builtin-catalog.ts` 保持）
- 不引入 schema versioning 实际迁移逻辑（只留 column + hook，等未来需要）
- 不 drop 旧 `bindings_json` / `config_json` 列
- 不引入测试（但 parser 单元级 reasoning 要 clean）

## Decisions

### D1. Types + parser 住 `shared-types`

**选择**：`PrefabConfig<T>` / `PrefabBinding` 放 `packages/shared-types/src/prefab-config.ts`；parser 函数同文件。AJV schema JSON 放 `packages/asset-schema/schemas/prefab-config.schema.json`（`asset-schema` 包已有 AJV 依赖）。

**理由**：

- types 在 shared-types 让 consumer 跨包用同一类型
- parser 需要 AJV，但 shared-types 零依赖原则——parser 的 schema import 走相对路径 + AJV 从 `asset-schema` 导入。或者 parser 放 `asset-schema` 包里（types 仍在 shared-types）？
- 采用后者：types 在 `shared-types`，parser 在 `asset-schema`（`packages/asset-schema/src/prefab-config-parser.ts`）。shared-types 零依赖不破。

### D2. Discriminated union by archetype

**选择**：

```ts
// shared-types/prefab-config.ts
export type PrefabArchetype = 'workstation' | 'lounge' | 'rack' | 'shelf' | 'desk' | ...;

export interface PrefabConfigBase<T extends PrefabArchetype> {
  archetype: T;
  // common fields
}

export interface WorkstationConfig extends PrefabConfigBase<'workstation'> {
  monitorCount: 1 | 2 | 3;
  keyboardStyle?: 'compact' | 'full';
}

export interface LoungeConfig extends PrefabConfigBase<'lounge'> {
  seatCount: number;
  // ...
}

export type PrefabConfig = WorkstationConfig | LoungeConfig | RackConfig | ...;
```

**理由**：discriminated union 是 TypeScript narrowing 的主流方式，消费者 switch archetype 后直接用 typed fields。

### D3. Result type 而不是 throw

**选择**：

```ts
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: ParseError };
export interface ParseError { code: 'invalid-json' | 'schema-violation' | 'unknown-archetype'; message: string; path?: string; }

export function parsePrefabConfig(json: string, archetype: PrefabArchetype): ParseResult<PrefabConfig>;
```

**理由**：consumer 处理 parse 失败时可以决定 fallback vs skip vs log，而不是被 throw 绑架。3D 渲染层的 fallback 行为比"直接 crash"更稳。

### D4. 分阶段迁移

**选择**：5 阶段（见 proposal）。每阶段独立 commit + 独立 verify，不批量推。

**理由**：

- prefab consumer 散落 25+ 文件，一次性全改风险巨大
- 渲染路径（stage 2）先迁——最高风险面收口
- 低风险（stage 3）再跟
- DB migration（stage 4）放后，保 backward-compat
- gate grep（stage 5）最后 enforce

### D5. DB migration：加 schema version 列，不改数据

**选择**：

```sql
ALTER TABLE prefab_instances ADD COLUMN bindings_schema_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE prefab_instances ADD COLUMN config_schema_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE prefab_defs ADD COLUMN bindings_schema_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE prefab_defs ADD COLUMN config_schema_version INTEGER NOT NULL DEFAULT 1;
```

package-local 新 migration + desktop `lib.rs` version bump。parser 读 version 决定是否走未来的 upgrade hook（当前全 1，无 upgrade）。

**理由**：数据不动（backward-compat），但为未来 schema 升级留 marker。升级时 parser 可根据 version 走不同解析分支。

### D6. 向后兼容 legacy 数据

**选择**：parser 遇到 schema 校验失败但 JSON 合法的 legacy 数据时，尝试 "best-effort" 解析（填默认字段）+ 发 `prefab.config.schema.violation` telemetry event；不 block render。

**理由**：旧数据现存在用户 vault / platform DB 里，强制校验会让老账号炸。"尽力而为"符合项目"开源 BYO-key"的产品定位。

## Risks / Trade-offs

- **风险：consumer 迁移漏网**→ stage 5 的 gate grep（`JSON.parse(.*bindings_json|config_json)` 全仓零匹配）是硬卡点；每个阶段单独 PR 让 review 可追溯。
- **风险：AJV bundle size**→ AJV 已在 `asset-schema` 包，web/desktop bundle 不新增依赖。
- **风险：schema 设计不准确**→ 第一版 schema 按当前 consumer 实际读的字段 reverse-engineer；未来发现漏字段就 bump version + migration hook 升级。
- **风险：live verify 成本**→ 每阶段独立 live 验证 prefab 渲染（3D + 2D），对比重构前截图。分阶段 minimize blast radius。
- **风险：DB migration 跨端一致性**→ package-local + desktop 双份新增列，按 repo 里已有 migration 模式（refactor-repo-triple-copies / deliverable-persistence 先例）。
- **Trade-off：大工程**→ 多阶段拆完意味着这条 change 本身会经历多轮 propose/apply/archive，或者作为单大 change 多 phase 推进。proposal 偏向后者，tasks.md 按 stage 组织。
