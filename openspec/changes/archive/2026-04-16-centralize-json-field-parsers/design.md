## Context

现状：
- `useEmployeeEditor.ts` 有 typed `parsePersonaJson` / `parseConfigJson` 返回 `Pick<EmployeeFormData, ...>` — 带 UI form 默认值（空串、'medium'、'balanced'），core 用不上
- `employee-roster.ts` 的 `safeParseJson(raw: string | null): JsonObject` — 无类型，返回 `{}`，被 pm-planner / tool-permission / employee-roster 自己使用
- `tool-permission-engine.ts` 重定义了一个私有 `safeParseJson` 返回 `JsonRecord`，形状相同
- `prefab-service.ts:131,167`：`JSON.parse(row.bindings_json) as PrefabBinding[]` — 裸 cast 无错误处理
- `avatar-seed.ts`：inline try/catch parse persona 只为取 avatarSeed
- 事件层（`payload_json` / `output_json` / `response_json` 等）异构 shape，不在本 scope

## Goals / Non-Goals

**Goals:**
- Employee config/persona 和 Prefab bindings 有单一来源的 typed 解析器
- UI form wrapper 不 regress（保持现有 UX 默认值）
- core hot path（tool-permission-engine, avatar-seed）拿到类型安全

**Non-Goals:**
- 不改 DB schema
- 不改 event payload_json / output_json 等异构 shape
- 不做 caching 层（先解决类型/重复问题，性能按需再加）
- 不删 `safeParseJson` 这个 generic helper（它在 `tool-permission-engine.ts` 内部还用于 toolPermissionPolicy 这种嵌套子字段的安全解析）

## Decisions

### D1: 解析器放 `@offisim/shared-types`

**选择**: 新文件 `packages/shared-types/src/json-field-parsers.ts`。`shared-types` 已有 `zone-resolution.ts` 等纯函数模块，无依赖，core + ui-office 都能 import。

**备选**: 放 `@offisim/core/shared`。否决理由：ui-office 依赖 core，但如果只需要类型 + 纯函数，shared-types 更底层、更合适。

### D2: 类型返回值是"可选字段"而非"带默认值"

**选择**: `parseEmployeePersona(raw): EmployeePersona` 返回全 optional 字段：
```ts
interface EmployeePersona {
  expertise?: string;
  style?: string;
  customInstructions?: string;
  avatarSeed?: string;
  appearance?: EmployeeAppearance;
  communicationFrequency?: 'low' | 'medium' | 'high';
  riskPreference?: 'conservative' | 'balanced' | 'aggressive';
  decisionStyle?: 'analytical' | 'intuitive' | 'collaborative' | 'directive';
}
```

**备选**: 带默认值返回 `Required<...>`。否决理由：默认值是 UI form 关心的事，core 关心"字段是否真的存在"。分层更干净。

### D3: UI form wrapper 保留但底层复用

**选择**: `useEmployeeEditor.ts` 的 `parsePersonaJson` / `parseConfigJson` 改为调用 `parseEmployeePersona` + 加 form 默认值的 wrapper。签名（返回 `Pick<EmployeeFormData, ...>`）保持不变，不破坏调用方。

### D4: `parsePrefabBindings` 返回 `PrefabBinding[]` 带校验

**选择**: 对 `bindings_json` 做结构校验（数组 + 每项有 slotName/resourceRef），失败返回空数组 + console.warn。不再裸 `as PrefabBinding[]` cast。

### D5: `safeParseJson` 保留

**选择**: `employee-roster.ts` 的 `safeParseJson` 保持为 generic helper（它还用于其他地方做通用解析）。但对 employee.persona_json / config_json 的具体调用点换用 typed 版本。

## Risks / Trade-offs

- **[风险] 现有代码依赖 safeParseJson 返回的 JsonObject 形态做 spread/merge** → 逐个审查，typed 返回值是 `{ ... }` 对象，spread 行为兼容。
- **[风险] UI form wrapper 层额外一层函数调用影响性能** → 可忽略，form 只在编辑 dialog 打开时解析一次。
- **[风险] parsePrefabBindings 新增的结构校验导致既存不合规数据被丢弃** → 接受：project 处于 pre-launch 阶段，旧数据本来就不做兼容（参见 memory feedback）。console.warn 会告警。
