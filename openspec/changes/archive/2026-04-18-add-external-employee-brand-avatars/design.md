## Context

Phase 2b 第 1 条已把 A2A peer 从 external-department 抽象翻成 external-employee 语义 + A2A protocol layer 升到 v1.0；`is_external` / `a2a_url` / `brand_key` 三字段在 schema、dispatch、events、task_run 里全通，但 **scene 渲染层对这三字段熟视无睹**：

- 2D canvas (`canvas-layers/draw-employees.ts` + `office-2d-avatar-cache.ts`) 一律调 `createOffisimAvatar(seed, 64)` 走 DiceBear avataaars。
- 3D scene (`office3d-employees.tsx` → `EmployeeMarker` → `LowPolyCharacter`) 一律用 `outfitColorFromSeed(seed)` + `skinToneFromSeed(seed)` 生成块人。
- 列表 UI (`AgentCard` / `EmployeeInspector` / `DeliverableCard` / `TeamHealthCard` / `EmployeeCreatorOverlay`) 一律用 `<DicebearAvatar seed={name}>`。

产品要求：外部员工走 **品牌独立资产**（2D + 3D 都是），不共用 DiceBear / LowPolyCharacter；未命中支持品牌走 **custom 通用外包**（视觉可区分但不冒充品牌）。首批 3 个品牌 + custom fallback：

- `hermes`
- `openclaw`（龙虾）
- `codex`
- `custom`（未命中品牌）

本 change 只做**渲染层**；install UI / agent card discovery 归第 3 条。

## Goals / Non-Goals

**Goals:**

- 建立 `BrandRegistry` SSOT（`packages/ui-office/src/lib/brand-registry.ts`）：输入 `{ is_external, brand_key }`，输出 brand entry 或 `INTERNAL_BRAND` / `CUSTOM_BRAND` sentinel；entry 含 2D 资产 URI + 3D variant key + displayName + accentColor。
- 首批 3 + 1 个 brand 的 2D SVG 资产落到 `packages/ui-office/src/assets/brands/`；3D 侧用 **LowPolyCharacter variant 参数化** 实现（不引入 GLB pipeline，bundle 可控）。
- 2D canvas + 3D scene 渲染分支：`is_external === 1` → 走 brand asset；`is_external === 0` → 走原 DiceBear / LowPolyCharacter 路径 byte-identical。
- 列表 UI 头像分支：同上，`BrandAvatar2D` 组件包装 `<img src={asset2dUri}>`。
- Avatar cache key 扩展到 `(companyId, isExternal, brandKey || seed)`，保证 internal 和 external 不互相污染。
- `AvatarCustomizer` 对 external employee disable clothing panel（品牌资产固定，不允许个体改色）。

**Non-Goals:**

- 不做 Market / Settings "安装外包员工" UI（第 3 条）。
- 不做 agent card fetch → `brand_key` 自动推断（第 3 条）。
- 不引入 GLB / FBX / 3D asset pipeline；3D 品牌只做 `LowPolyCharacter` variant（或轻量 R3F 自绘），总 bundle 新增 ≤ 500KB。
- 不做同品牌多实例的 variant 区分（两个 Hermes 员工长得一样可接受）。
- 不改 `EmployeeRow` schema 或 db migration；只消费 Phase 2b 第 1 条已有字段。
- 不改 internal 员工任何渲染路径（DiceBear seed 派生 / LowPolyCharacter `outfitColorFromSeed` 逻辑 byte-identical 保留）。

## Decisions

### 1. BrandRegistry 位置：`packages/ui-office/src/lib/brand-registry.ts`

**选择**：放 ui-office，不放 renderer 或 shared-types。
**理由**：brand entry 包含 `asset2dUri` (可能是 ESM import 产生的 URL) + `asset3dVariant` (3D 组件 variant key)，两者都是 ui-office 侧概念。core / shared-types 只需要 `brand_key` string，不需要知道渲染细节。
**否决**：放 renderer — renderer 包是 prefab / layout 引擎，avatar 不属于它；放 shared-types — 会把 SVG asset 路径拖进零依赖包。

### 2. 2D asset 格式：SVG 模块 import

**选择**：SVG 文件放 `packages/ui-office/src/assets/brands/`，vite 默认把 SVG 当 asset import，拿到可 `<img src=>` 的 URL。brand-registry 直接 `import hermesSvg from '../assets/brands/hermes.svg?url'` 存进 entry。
**否决**：SVG → React component (`?react`)——增加运行时开销；SVG inline data URI——bundle 变大、失去缓存优势；PNG——矢量缩放差、高 DPI 模糊。
**约束**：每张 SVG 必须 viewBox `0 0 100 100`（正方形），主视觉居中，留 ~10% padding 以适应 `drawAvatarCircle` 圆形裁剪。

### 3. 3D brand character：LowPolyCharacter variant 参数化

**选择**：`LowPolyCharacter` 加 `variant: 'default' | 'hermes' | 'openclaw' | 'codex' | 'custom'` prop；`default` 保持原块人 100% byte-identical；其他 variant 在 `LowPolyCharacter` 内部条件渲染不同 geometry / material / 额外 mesh（比如 openclaw 加龙虾爪 mesh，hermes 换头部形状 + 头发 mesh）。
**否决 A**：每个 brand 独立组件（`HermesCharacter3D` / `OpenClawCharacter3D` / ...）——代码重复高，limb ref 接线每个组件都要重抄；
**否决 B**：GLB 文件 + `useGLTF` 加载——需要 asset pipeline + loading state + 运行时 blob 体积不可控，本条 non-goal。
**约束**：每个 variant 必须共用 `limbRefs` 接口（leftLeg / rightLeg / leftArm / rightArm），保证 `useAgentAnimation` / `useCharacterMovement` 动画对所有 brand 等价工作。若某 brand 没有"腿"（比如龙虾），用同位置的隐形 mesh 占位让 limb ref 继续可 animate，ceremony 动画不退化。
**首批实现强度**：`custom` variant = 原块人换配色（紫灰）+ 肩上加"外包"小徽章 mesh；`hermes` / `openclaw` / `codex` 按品牌印象手写简易 R3F 几何（spheres / cylinders / boxes），不追求像素级还原，追求一眼可辨。

### 4. 渲染分支位置：在 render-layer 边界

**选择**：分支发生在：
- 2D: `drawEmployeeNode()` 内部先 switch `emp.isExternal / emp.brandKey`，external 走新 `drawBrandAvatarCircle()`，internal 走现有 `drawAvatarCircle()`。
- 3D: `EmployeeMarker` 内部 switch `emp.agent.is_external`，external 传 `<BrandCharacter3D variant={resolved.variant} .../>`，internal 传 `<LowPolyCharacter variant='default' outfit={...} skin={...} .../>`。
- 列表 UI: 每个 `DicebearAvatar` 调用点加 `isExternal` 判断分支到 `<BrandAvatar2D brandKey={...}>`。

**否决**：在 `PlacedEmployee` / `AgentState` 构造阶段就把 `avatarUri` 预解析完——会让 render-data 承载太多 UI 细节；**render layer 应当是消费 resolver 的纯分支点**，不要把 UI resolution 提前到 data composition。

### 5. `AgentState` / `PlacedEmployee` / `EmployeeRenderData` 扩字段

**选择**：
- `AgentState` 加 `isExternal?: boolean` + `brandKey?: string | null`，由 `use-agent-states.ts` 从 `EmployeeRow.is_external` + `EmployeeRow.brand_key` 透出。
- `PlacedEmployee` 派生：`emp.agent.isExternal` / `emp.agent.brandKey` 直接可读。
- `EmployeeRenderData` (2D) 在 `office-2d-canvas-renderer.ts` snapshot 构造时加 `isExternal` + `brandKey`，`drawEmployees` 消费。

**否决**：直接让渲染层查 `repos.employees.findById(id).is_external`——scene render 已经有 snapshot 模型，加字段更一致。

### 6. Avatar cache key 扩展

**选择**：
- `office-2d-avatar-cache.ts` key 从 `${companyId}:${seed}` 改成 `${companyId}:${isExternal ? 'brand:' + brandKey : 'dicebear:' + seed}`。
- brand key 部分的 URI 直接来自 `brand-registry.ts` 里 `asset2dUri`（SVG 模块 import 生成的 URL），不需要实际生成 data URI。所以 brand path 走 `brandRegistry.resolve(brandKey).asset2dUri` 即可，LRU cache 只缓存 decoded `HTMLImageElement`（SVG URL 的 Image 缓存）。

**理由**：SVG static asset 的 URL 本身就是 CDN-friendly 缓存单元；没必要再做 data URI 转化。

### 7. `BrandAvatar2D` 组件接口

**选择**：
```tsx
interface BrandAvatar2DProps {
  brandKey: string | null;      // 来自 employee.brand_key
  size?: number;
  className?: string;
}
// 内部 resolve brandRegistry → entry.asset2dUri → <img>
```
**否决**：直接传 `employee` 对象——调用点耦合太重；直接传 URL——把 registry resolve 逻辑散到调用点。

### 8. AvatarCustomizer 对 external employee 的处理

**选择**：在 `EmployeeInspector` 打开 avatar customizer 之前判断 `employee.is_external === 1`，是 → 不展示 clothing panel（或整个 customizer 面板换成 "品牌 avatar，不可自定义" banner）。
**否决**：partially disable（某些 panel gray-out）——UX 混乱，不如明确区隔。
**Non-goal**：为 external employee 提供品牌内 variant 选择（同品牌多实例区分），第 3 条或后续迭代做。

### 9. `INTERNAL_BRAND` 和 `CUSTOM_BRAND` sentinel

**选择**：`brand-registry.ts` 导出三类：
- `INTERNAL_BRAND`：sentinel，表示 `is_external === 0`，消费者不应调 `resolveBrand`；仅作类型 exhaustiveness 辅助。
- `CUSTOM_BRAND`：真实 entry，`brandKey: 'custom'`，有 asset2dUri + asset3dVariant，是 external 未命中白名单的 fallback。
- 具名 brand entries：`HERMES_BRAND` / `OPENCLAW_BRAND` / `CODEX_BRAND`。

**resolveBrand 契约**：
```ts
function resolveBrand(employee: { is_external: number; brand_key: string | null }):
  | { kind: 'internal' }
  | { kind: 'external'; entry: BrandEntry };
```
internal 返回 `{kind:'internal'}`；external 命中白名单返回对应 entry；未命中返回 `CUSTOM_BRAND` entry。

**理由**：sentinel + kind discriminator 让渲染层 switch 类型安全，无 null 陷阱。

### 10. 首批支持列表白名单 = 硬编码常量

**选择**：第 2 条只锁定 `hermes` / `openclaw` / `codex` + `custom` 四个 brand，brand-registry 用 `Record<string, BrandEntry>` 常量，未来新 brand 走代码改动 + 提交。
**否决**：从 manifest / registry-client 动态拉——第 3 条 install UI 落地前没意义；且动态列表增加复杂度、不利于 tree-shake 资产。
**迁移路径**：若未来需要动态（marketplace 发布第三方 brand），抽 `BrandProvider` context 包装 registry + 允许运行时注册，第 N 条 change 再做。

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Bundle size 膨胀：3D variant 几何 + 4 张 SVG 可能加几百 KB | Bundle gate：ui-office prod build chunk 新增 ≤ 500KB（SVG < 50KB × 4 + 3D variant code ≤ 300KB）。build 超过就 code-split brand 资产到独立 lazy chunk |
| `LowPolyCharacter` variant 化导致 `default` 分支 regression | 首改 only 加 `variant='default'` fast-path early-return 走原来 100% code path，其他 variant 用独立条件分支，不互相污染。测试策略：手动 live 对比"改前 internal 员工 3D 外观 == 改后 internal 员工 3D 外观" |
| SVG 资产质量：首批美术还没交付 | 本 change 先落**占位 SVG**（形状识别度够即可：Hermes 简笔女孩头像 / OpenClaw 红色龙虾剪影 / Codex 蓝色 CLI 图标 / custom 紫灰问号方块），产品方 finalise 美术后换文件不改代码 |
| 同品牌多实例视觉无区分（两个 Hermes 员工看起来一样） | 明确 non-goal，若后续需要，通过 `brand_key` + `variant_slot` (hash(a2a_url) % variant_count) 组合解决。本条不引入 |
| AvatarCustomizer disable 可能影响 E2E 录制脚本 | 在 `EmployeeInspector` disable 面板处明确 `data-testid="external-avatar-disabled"`，让未来自动化抓得到 |
| external-employee 加入后 `resolveAvatarSeed` 仍被调用（死代码路径）| 保留 `resolveAvatarSeed`，internal employee 继续用；不做 dead-code elimination 以免破坏 internal path |

## Migration Plan

1. **Registry + assets 落地**：brand-registry.ts + 4 张 SVG + `BrandAvatar2D` 组件 + `LowPolyCharacter` variant 扩展（`default` 行为 0 变化，其他 variant 加几何）。
2. **Agent state / render data 扩字段**：`use-agent-states.ts` / `usePlacedEmployees` / `office-2d-canvas-renderer.ts` 透传 `is_external` + `brand_key`。
3. **渲染层分支**：2D `drawEmployeeNode` + `office-2d-avatar-cache` + 3D `EmployeeMarker` 按 external 分支；cache key 扩展。
4. **列表 UI 替换**：5 个 `DicebearAvatar` 调用点（AgentCard / EmployeeInspector / DeliverableCard / TeamHealthCard / EmployeeCreatorOverlay）加 `is_external` 分支。
5. **AvatarCustomizer external employee disable**。
6. **串行 build 全绿 + bundle 检查 ≤ 500KB 增量**。
7. **Live verify**：基于 Phase 2b 第 1 条的 Hermes external employee，浏览器看 2D + 3D 双视角都出 brand avatar；`brand_key='openclaw'` 和 `brand_key='totally-unknown'` 两个额外用例人工注入验证切换 + custom fallback。
8. **Rollback**：本条只加 UI branch，`git reset` 单 commit 即可；不触碰 schema / dispatch / transport。

## Open Questions

- **Q1**：`custom` fallback 视觉到底多强的"外包感"标识？选 (a) 同色块人 + 肩章 (b) 全新紫灰块人 (c) DiceBear 特殊 style variant。倾向 (b)：新配色，明确区分且保持块人动画复用。**决议**：在实现期用 (b)，Live verify 后若用户嫌弱，再加肩章。
- **Q2**：3D 模式下是否需要 name pill 前缀 `[ext]` 标记？倾向不需要——视觉差异本身应当够；如果 Live verify 觉得不够强，再考虑加。
- **Q3**：Internal employee 的 DiceBear 会不会因为 cache key 变化（多加了 `isExternal` 维度）而失效缓存一次？是的——第一次部署会全量重新解码；可接受（max 100 entries LRU，<1 秒完成）。
- **Q4**：`LowPolyCharacter` 加 variant 后，barrel 是否会突破 ≤200 NBNC？office3d-employees 已 429 行，不在 200 约束内（该文件没有 spec 约束），本条不新约束它；但若变动后超 600 NBNC，下一条 refactor 再拆。
