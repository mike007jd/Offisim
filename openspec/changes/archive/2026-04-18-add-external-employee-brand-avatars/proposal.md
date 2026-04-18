## Why

Phase 2b 第 1 条落地后，external employee 通过 `is_external=1 / a2a_url / brand_key` 走 A2A dispatch，跑通端到端；但 **scene 视觉层还没分支**：2D canvas 里 external employee 继续走 `createOffisimAvatar(seed)`（DiceBear avataaars）渲染成通用卡通头，3D 场景里继续走 `LowPolyCharacter`（参数只有 `outfitColor` + `skinTone`）渲染成通用块人。产品方向明确：**每个 A2A brand（OpenClaw 龙虾 / Hermes 女孩 / Codex 等）必须有自己独立的 2D + 3D avatar 资产**，不和内部员工共用 DiceBear / 块人体系；未命中支持列表的 external employee 走 **custom** 通用外包样式（视觉上和内部员工可区分，但不冒充任何品牌）。

当前 `brand_key` 字段只流到 manager prompt 和 a2a executor 的 agent event payload，scene 层完全忽略它。本 change 把 `brand_key` 接进渲染链路：建立 `BrandRegistry` SSOT + 首批 3 个品牌资产（OpenClaw / Hermes / Codex）+ custom fallback + 2D canvas 和 3D scene 两侧都按 `employee.is_external === 1` 分支到 brand renderer。

## What Changes

- **NEW** `packages/ui-office/src/lib/brand-registry.ts` — SSOT of supported brand keys. 每个 entry 包含 `brandKey` / `displayName` / `asset2dUri` (SVG data-URI 或模块 import path) / `asset3d` (`LowPolyCharacter` variant key 或自定义 3F component) / `accentColor` (供 UI 徽章 / name pill 用)。包括 `custom` fallback entry。
- **NEW** `packages/ui-office/src/assets/brands/` — 首批 3 个 brand 的 2D SVG 资产（hermes / openclaw / codex）+ custom fallback 占位。格式统一 1:1 square，viewBox 适合圆形裁剪（和现有 `drawAvatarCircle` 兼容）。
- **NEW** 3D brand character — `LowPolyCharacter` 扩 `variant?: BrandVariant` prop，或抽 `BrandCharacter3D` 包装层按 `variant` switch 到对应 3D 实现。首批 3 个 brand + `default` internal + `custom` external placeholder。
- **BREAKING** `packages/ui-office/src/components/scene/office3d-employees.tsx` `EmployeeMarker` 按 `emp.agent.is_external + brand_key` 分支渲染：internal 走原 `LowPolyCharacter(outfit,skin,seed派生)`；external 走 `BrandCharacter3D(variant=brand_key resolved or 'custom')`，**不派生 outfit/skin from seed**。
- **BREAKING** `packages/ui-office/src/components/scene/canvas-layers/draw-employees.ts` + `office-2d-avatar-cache.ts` 同分支：internal 走 DiceBear 路径；external 走 `getBrandAvatar2D(brand_key)`，缓存 key 改成 `(companyId, is_external, brand_key || seed)`。
- **BREAKING** `AgentState` / `PlacedEmployee` / `EmployeeRenderData` 在渲染层需要拿到 `is_external` + `brand_key`。`use-agent-states.ts` 把这俩字段从 `EmployeeRow` 透到 `AgentState`；`usePlacedEmployees` / 2D render registry 同步透出。
- **NEW** `packages/ui-office/src/lib/brand-registry.ts` 导出 `resolveBrand(employee): BrandEntry` helper — 输入 `{ is_external, brand_key }`，返回：internal → `INTERNAL_BRAND` sentinel（不进入 brand rendering path），external 命中白名单 → 对应 brand entry，external 未命中 → `CUSTOM_BRAND` fallback entry。
- **NEW** UI 徽章 — 外部员工的 `DicebearAvatar` 调用点（AgentCard / EmployeeInspector / DeliverableCard / TeamHealthCard）按 `is_external` 改调 `BrandAvatar2D` 组件（新建，包装 `<img src={brandAsset2dUri}>`），不再走 DiceBear seed 派生。
- **BREAKING** `AvatarCustomizer` clothing panel 面板逻辑：external employee 不允许改 clothing（clothing 来自品牌资产固定值）；`is_external=1` 时面板 disabled 并显示提示（或整个 avatar customizer 对外包员工隐藏）。

## Capabilities

### New Capabilities

- `external-employee-brand-avatars`: 外部员工品牌 avatar 规范——BrandRegistry 作为支持品牌列表 + 资产映射的 SSOT；2D canvas + 3D scene 两侧渲染按 `is_external + brand_key` 分支；未命中品牌走 custom fallback；内部员工（`is_external=0`）渲染路径和 Phase 2b 第 1 条前 byte-identical 不动。

### Modified Capabilities

- 无。Phase 2b 第 1 条的 `external-employee-a2a-dispatch` spec 不变（本 change 只加视觉层，不动 dispatch / transport / schema）。

## Impact

**代码改动范围**：

| 层 | 文件 | 动作 |
|---|---|---|
| Registry | `packages/ui-office/src/lib/brand-registry.ts` | **NEW** SSOT + `resolveBrand(employee)` |
| Assets | `packages/ui-office/src/assets/brands/{hermes,openclaw,codex,custom}.svg` | **NEW** 首批 4 张 SVG（3 brand + 1 custom fallback）|
| 2D render | `packages/ui-office/src/components/scene/office-2d-avatar-cache.ts` | branch by brand + 缓存 key 扩 |
| 2D render | `packages/ui-office/src/components/scene/canvas-layers/draw-employees.ts` | 分支走 brand asset 路径 |
| 2D render | `packages/ui-office/src/components/scene/office-2d-canvas-renderer.ts` | `EmployeeRenderData` 加 `isExternal` + `brandKey` |
| 3D render | `packages/ui-office/src/components/scene/office3d-employees.tsx` | `EmployeeMarker` 分支 + `PlacedEmployee` 加字段 |
| 3D render | `packages/ui-office/src/components/scene/office3d-brand-characters.tsx` (或同文件) | **NEW** `BrandCharacter3D` variant |
| Agent state | `packages/ui-office/src/runtime/use-agent-states.ts` | `AgentState` 加 `is_external` + `brand_key` |
| UI list | `packages/ui-office/src/components/shared/BrandAvatar2D.tsx` | **NEW** `<img src={brandAsset}>` 包装 |
| UI list consumer | `AgentCard.tsx` / `EmployeeInspector.tsx` / `DeliverableCard.tsx` / `TeamHealthCard.tsx` / `EmployeeCreatorOverlay.tsx` | 按 `is_external` 分支到 `BrandAvatar2D` |
| Avatar editor | `packages/ui-office/src/components/avatar/AvatarCustomizer.tsx`（如适用）| external employee disable clothing 面板或整体隐藏 |

**产品影响**：

- 落地后可以真实区分 internal 员工 vs 不同品牌外包员工；场景里一眼认出 "哦这是 Hermes" "哦这是 OpenClaw"。
- 未命中品牌的 external employee（agent card 没有或 brand_key='custom'）→ 所有渲染点走 custom 占位，明确标示"外包"身份但不冒充任何品牌。
- 第 1 条期间 external employee 视觉上和 internal 没区别的退化被修复。
- 第 3 条（Market/Settings 安装入口）依赖本条的 BrandRegistry 做 agent card → brandKey 匹配。

**Non-Goals**：

- 不做 Market / Settings 安装 UI（第 3 条）。
- 不做 agent card discovery → brandKey 自动推断（第 3 条；本条的 `brand_key` 仍按 Phase 2b 第 1 条的手动输入语义）。
- 不引入 GLB / FBX asset pipeline；3D 品牌 character 用**参数化 LowPolyCharacter variant** 或 **小规模手写 R3F 组件**，首批 bundle 大小不超过 500KB。
- 不改 DiceBear / LowPolyCharacter 本身的 internal 员工渲染路径（`is_external=0` byte-identical）。
- 不做同品牌 multiple peers 的 variant 区分（例如两个 Hermes 员工长得一模一样是可接受的；第 3 条 install UI 若引入同品牌多实例区分，单独迭代）。

**验证策略**（live agent，无自动化）：

- typecheck / build 串行四包（shared-types / core / ui-office / web）绿。
- Live verify：基于 Phase 2b 第 1 条的 external employee 记录（hermes brand_key），2D / 3D 两个视图都看到 Hermes 独立 avatar，不是 DiceBear 卡通头 / 通用块人。换一条 `brand_key='openclaw'` 的记录，看到切换。伪造一条 `brand_key='totally-unknown'` 的记录，看到走 custom fallback 不崩。
- Internal 员工回归：一轮 chat + scene 3D ceremony 无退化，DiceBear / LowPolyCharacter 路径不变。
