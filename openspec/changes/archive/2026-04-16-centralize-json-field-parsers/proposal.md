## Why

Typed parsers for `persona_json` / `config_json` 已存在但锁在 `useEmployeeEditor.ts`（UI hook 文件），core 无法复用，只能用无类型的 `safeParseJson` 返回 `JsonObject`。`prefab-service.ts` 有 2 处 inline `JSON.parse(row.bindings_json) as PrefabBinding[]`。`avatar-seed.ts` 也 inline 解析 persona_json 只为取 avatarSeed。scattered 的 `JSON.parse` 意味着相同字段形状在多处重复推断，IDE 无类型辅助。

## What Changes

- 在 `packages/shared-types/src/` 新建 `json-field-parsers.ts`：导出 `EmployeePersona` / `EmployeeConfig` 类型 + `parseEmployeePersona` / `parseEmployeeConfig` / `parsePrefabBindings` 纯函数
- `useEmployeeEditor.ts` 的 UI form-oriented wrapper 保留，但底层类型和解析逻辑从 shared-types 导入
- core 的 `safeParseJson(employee.config_json)` 调用改为 `parseEmployeeConfig(employee.config_json)`
- `prefab-service.ts` 的 inline parse 改为 `parsePrefabBindings()`
- `avatar-seed.ts` 的 inline parse 改为 `parseEmployeePersona()`

## Capabilities

### New Capabilities
- `typed-json-field-parsers`: 共享的 typed 解析器模块，消除 scattered JSON.parse + 统一类型契约

### Modified Capabilities
(无)

## Impact

- `packages/shared-types/src/json-field-parsers.ts` — 新文件
- `packages/shared-types/src/index.ts` — 导出新模块
- `packages/ui-office/src/hooks/useEmployeeEditor.ts` — 底层换成 shared parsers
- `packages/ui-office/src/lib/avatar-seed.ts` — 用 parseEmployeePersona
- `packages/core/src/agents/employee-roster.ts` — 保留 safeParseJson（generic helper），但消费 employee.config/persona 的地方换用 typed
- `packages/core/src/agents/pm-planner-node.ts` — employee config 读取换用 typed
- `packages/core/src/permissions/tool-permission-engine.ts` — config_json 读取换用 typed
- `packages/core/src/services/prefab-service.ts` — 2 处 inline parse 换用 parsePrefabBindings
