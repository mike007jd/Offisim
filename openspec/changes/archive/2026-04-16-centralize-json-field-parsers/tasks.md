## 1. 创建 shared-types 解析器模块

- [x] 1.1 创建 `packages/shared-types/src/json-field-parsers.ts`
- [x] 1.2 定义 `EmployeePersona` interface（全字段 optional，含 avatarSeed/appearance/communicationFrequency/riskPreference/decisionStyle/expertise/style/customInstructions）
- [x] 1.3 定义 `EmployeeConfig` interface（modelPreference / temperature / maxTokens / runtimeSkill / toolPermissionPolicy，全 optional）
- [x] 1.4 实现 `parseEmployeePersona(raw: string | null): EmployeePersona`
- [x] 1.5 实现 `parseEmployeeConfig(raw: string | null): EmployeeConfig`
- [x] 1.6 实现 `parsePrefabBindings(raw: string | null): PrefabBinding[]`（带结构校验，过滤无效项）
- [x] 1.7 在 `packages/shared-types/src/index.ts` 导出新模块

## 2. 改造 avatar-seed

- [x] 2.1 `packages/ui-office/src/lib/avatar-seed.ts` 中 inline try/catch 换成 `parseEmployeePersona()`

## 3. 改造 ui-office form wrapper

- [x] 3.1 `useEmployeeEditor.ts` 的 `parsePersonaJson` 改为调 `parseEmployeePersona()` + 添加 form 默认值
- [x] 3.2 `useEmployeeEditor.ts` 的 `parseConfigJson` 改为调 `parseEmployeeConfig()` + 添加 form 默认值
- [x] 3.3 确认签名/返回类型不变（UI callers 无感知）

## 4. 改造 core employee 读取

- [x] 4.1 `packages/core/src/agents/employee-roster.ts` 中对 `employee.persona_json` / `employee.config_json` 的 `safeParseJson` 调用换用 `parseEmployeePersona` / `parseEmployeeConfig`
- [x] 4.2 `packages/core/src/agents/pm-planner-node.ts` 中 `safeParseJson(employee.config_json)` 换用 `parseEmployeeConfig`
- [x] 4.3 `packages/core/src/permissions/tool-permission-engine.ts` 中 config_json 读取换用 `parseEmployeeConfig`（内部的 toolPermissionPolicy 嵌套解析保留）
- [x] 4.4 `packages/core/src/agents/employee-node.ts` 的 `parseRuntimeSkillConfig` 底层改用 `parseEmployeeConfig`

## 5. 改造 prefab bindings

- [x] 5.1 `packages/core/src/services/prefab-service.ts` 第 131 行 inline parse 换用 `parsePrefabBindings`
- [x] 5.2 `packages/core/src/services/prefab-service.ts` 第 167 行 inline parse 换用 `parsePrefabBindings`

## 6. 验证

- [x] 6.1 `pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/core build && pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web typecheck` 全绿
- [x] 6.2 grep 确认无新增 `JSON.parse.*persona_json` / `JSON.parse.*config_json` / `JSON.parse.*bindings_json` 裸调用
