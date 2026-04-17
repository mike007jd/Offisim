## 1. Pre-work audit（开工前，A/B 级全收完后）

- [ ] 1.1 全仓 grep 所有读 `bindings_json` / `config_json` 的点，枚举 25+ consumer 清单
- [ ] 1.2 按 archetype 分组统计 consumer 期望的字段（reverse-engineer schema）
- [ ] 1.3 基线截图：3D + 2D render 默认公司 10+ prefab
- [ ] 1.4 确认 A 级 ② ③ + B 级 ④-⑦ 全部 archived（本 change 最后做）

## 2. 阶段 1: 定义 types + schema + parser（无 consumer 改动）

- [ ] 2.1 `packages/shared-types/src/prefab-config.ts`：`PrefabArchetype` union + `PrefabConfigBase<T>` + 11 archetype-specific config interface + `PrefabConfig` union + `PrefabBinding` union
- [ ] 2.2 `packages/asset-schema/schemas/prefab-config.schema.json`：AJV JSON schema 覆盖每种 archetype
- [ ] 2.3 `packages/asset-schema/src/prefab-config-parser.ts`：`parsePrefabConfig` / `parsePrefabBindings` / `stringifyPrefabConfig` / `stringifyPrefabBindings` + `ParseResult<T>` + `ParseError`
- [ ] 2.4 parser 对 invalid JSON 返回 Result，对 schema-violation 走 best-effort fallback + warn
- [ ] 2.5 typecheck + build 绿

## 3. 阶段 2: 迁移高风险 consumer（3D / 2D 渲染路径）

- [ ] 3.1 `packages/renderer/prefab/builtin-catalog.ts` consumer（若有解析点）
- [ ] 3.2 `packages/ui-office/src/lib/prefab-spatial.ts` — footprint / anchor 计算
- [ ] 3.3 `packages/ui-office/src/lib/seat-registry.ts` — seat position / approach
- [ ] 3.4 `packages/ui-office/src/components/scene/Office3DView.tsx` — 3D silhouette 绘制
- [ ] 3.5 `packages/ui-office/src/components/scene/office-2d-canvas-renderer.ts` + layers — 2D 绘制
- [ ] 3.6 每文件改后独立 live verify 3D + 2D render 对齐 baseline，失败立刻回退

## 4. 阶段 3: 迁移低风险 consumer

- [ ] 4.1 `packages/ui-office/src/components/office/OfficeEditorOverlay.tsx` + editor 子文件 — Studio 编辑器
- [ ] 4.2 `packages/install-core/**` — install 路径
- [ ] 4.3 `packages/core/src/runtime/repos/**/prefab*.ts` — 3 后端 repo 的 read/write
- [ ] 4.4 `packages/core/src/services/**` 里涉及 prefab config 的服务
- [ ] 4.5 每文件改后 typecheck，按 domain 批次 live verify

## 5. 阶段 4: DB migration

- [ ] 5.1 `packages/db-local/migrations/024_prefab_schema_version.sql`：加 4 个 INTEGER DEFAULT 1 列
- [ ] 5.2 `apps/desktop/src-tauri/migrations/030_prefab_schema_version.sql`：同上
- [ ] 5.3 `apps/desktop/src-tauri/src/lib.rs`：version bump 到 30 + 注册新 migration
- [ ] 5.4 Fresh boot 验证：新 DB 四列均为 1；既有 DB 升级后老行自动填 1

## 6. 阶段 5: Enforcement

- [ ] 6.1 全仓 grep `JSON\\.parse\(.*\\b(bindings_json|config_json|bindingsJson|configJson)\\b`（不含 archive/ 和 dist/）零匹配
- [ ] 6.2 全仓 grep `JSON\\.stringify\(.*Config\)` 在 prefab context 零直接匹配
- [ ] 6.3 `openspec validate refactor-prefab-config-schema --strict` 绿
- [ ] 6.4 `pnpm typecheck` + 5 包串行 build 绿

## 7. Live runtime verification（全阶段收官）

- [ ] 7.1 web live：加载既有公司，3D + 2D render 与 baseline 截图 pixel-perfect 对齐
- [ ] 7.2 Studio Zone Mode 打开既有 layout，prefab preset 显示正常
- [ ] 7.3 Legacy 数据场景：手动造 `config_json` 缺字段 → reload → 观察 warn + fallback 渲染，不 crash
- [ ] 7.4 Install / publish 路径：安装一个带 prefab 的 employee 模板，zone layout 正确实例化
- [ ] 7.5 Tauri desktop live：同样 3D + 2D render + Studio 三路径覆盖
- [ ] 7.6 观察记录到 `verify-notes.md`（含 baseline 截图 diff）

## 8. 最终 gate

- [ ] 8.1 `openspec validate refactor-prefab-config-schema --strict` 绿
- [ ] 8.2 通知用户等 `/opsx:archive`
