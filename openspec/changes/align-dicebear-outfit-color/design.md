## Context

2026-04-16 `unify-avatar-source` change 把 3D 员工块人的 outfit/skin 配色从 `globalIndex % OUTFIT_COLORS.length` 迁移到 `outfitColorFromSeed(resolveAvatarSeed(employee))`，并把 `OUTFIT_COLORS` / `SKIN_TONES` 作为 SSOT 放到 `packages/ui-office/src/lib/avatar-seed.ts`。canonical spec `openspec/specs/avatar-seed-resolution/spec.md`（4 requirement）已 published。

但 2D 头像 pipeline（`office-2d-avatar-cache.ts` for canvas 场景 + `DicebearAvatar.tsx` for chat rail / team panel / onboarding 等）走 `@dicebear/core@9.4.2` + `@dicebear/avataaars@9.4.2`。虽然 `seed` 已经用 `resolveAvatarSeed(agent)` 统一，但 DiceBear 的 clothing color 由 avataaars 风格自己的内部 palette + 自己的 seed hash 决定，不看 `OUTFIT_COLORS`。结果是同一员工在 2D 头像里的 shirt 色和 3D 场景里的 body 色完全无关联。

DiceBear license（code-MIT + design-"Free for commercial use"）兼容 Offisim MIT 开源，用户明确要求保留 DiceBear（同级细节自画不现实）。所以这个 change 走 "桥接" 路线——用 DiceBear 的 `clothingColor` option 把 2D 衣服色强制对齐 `outfitColorFromSeed(seed)` 的输出。

`AvatarCustomizer.tsx` 独立维护了 `SKIN_COLORS` / `HAIR_COLORS` / `CLOTHING_COLORS` 三套 palette（number-typed `0xRRGGBB`，仅给 `EmployeeCreatorOverlay` 手动配色用），其中 `CLOTHING_COLORS`（6 色）语义与 `OUTFIT_COLORS`（8 色）重复但不同步。

`CLAUDE.md:189` 的描述 `"3D 员工外观 (office3d-employees.tsx 硬编码 OUTFIT_COLORS / SKIN_TONES) 与 2D DiceBear 头像 不同源"` 在 2026-04-16 `unify-avatar-source` archive 之后就 stale（3D 早已从 seed 派生）。顺手清。

## Goals / Non-Goals

**Goals:**

- 2D DiceBear 头像的 shirt 颜色 = `outfitColorFromSeed(resolveAvatarSeed(employee))`，与 3D 块人 body 颜色 hex 字节等价
- `OUTFIT_COLORS` 作为仓库 SSOT——`AvatarCustomizer.tsx` 的 `CLOTHING_COLORS` 从这里派生，不再独立 number 数组
- 文档真相：修 `CLAUDE.md` 的 stale 描述；`MEMORY.md` 对 "3D↔2D avatar 视觉割裂" 的 Open Issue 描述按本 change 结果更新
- 契约：`avatar-seed-resolution` spec 新增一条 requirement 描述 2D DiceBear outfit color 的派生契约

**Non-Goals:**

- **不**弃 DiceBear 自画 2D avatar（用户拒绝）
- **不**把 DiceBear 的 hair / skin / accessories / face 等部件也强制对齐我们的 palette——只锁 clothing 一层作为视觉锚点；其他部件保持 DiceBear seed-派生的多样性
- **不**归并 `SKIN_COLORS` / `HAIR_COLORS`（它们是 manual-config 专用，和 seed-derived 自动配色不同语义，强行合会让 customizer 失去可选范围）
- **不**改 DiceBear 依赖版本 / 风格（还是 avataaars，不换 style）
- **不**改 3D 渲染（3D 已经 seed-derived，本 change 单向改 2D）
- **不**写 migration 处理旧 `persona_json.avatarAppearance.clothingColor`——遵循 MEMORY.md "pre-launch 脏数据清掉不写 migration" 纪律

## Decisions

### Decision 1 — DiceBear `clothingColor` option 强制传单元素数组

**选择**：`office-2d-avatar-cache.ts:54` 的 `createAvatar(avataaars, { seed, size: 64 })` 改为 `createAvatar(avataaars, { seed, size: 64, clothingColor: [outfitColorFromSeed(seed).slice(1)] })`。`DicebearAvatar.tsx:13-16` 同步改，加派生逻辑。

**原因**：DiceBear 风格的 option 形如 `clothingColor?: string[]`，数组元素是 hex-without-`#`。单元素数组 = 强制 pick 该色；多元素或空 = DiceBear 自 seed 派生 pick。单元素锁定是最小而精确的控制方式。

**替代**：
- (a) 传多元素数组（如 `[OUTFIT_COLORS.slice(1) for each]` strip `#`）→ DiceBear 会自 seed hash 选一个，**但未必和 3D 侧选的同一个**，失去锚点。否决
- (b) 修改 seed 让 DiceBear 派生到预期色 → 不可控（DiceBear 的 hash 算法黑盒）。否决

**Apply Phase 0 必验**：读 `node_modules/@dicebear/avataaars@9.4.2/lib/schema.json`（或等价 types file）确认：
1. `clothingColor` option 存在
2. 类型是 `string[]`
3. 单元素数组行为 = 锁定
4. 若约束不符，降级走 "只做 D 部分"（palette 归并 + 文档清理），UI 层保持现状

### Decision 2 — 派生逻辑放在 DicebearAvatar / cache 内部，不上移到调用方

**选择**：`DicebearAvatar.tsx` 和 `office-2d-avatar-cache.ts` 内部各自调 `outfitColorFromSeed(seed)`，调用方 props 不变（还是传 `seed`）。

**原因**：DiceBear 封装的职责就是"给定 seed 渲染 avatar"，"衣服色 = 该 seed 派生"是这个语义的自然扩展，caller 不应关心该实现细节。调用点遍及 `ChatPanel` / `TeamHealthCard` / `EmployeeInspector` / `AgentCard` / `Office2DCanvasView` 等 9+ 文件，每处都传 clothingColor 是 param sprawl。

**替代**：
- (a) DicebearAvatar 加 `clothingColor?: string` prop，有则覆盖，没则 seed 派生 → 保留未来手动覆盖空间。**接受该扩展位**——但 default 行为就是 seed 派生，手动覆盖留给后续需求

### Decision 3 — `OUTFIT_COLORS_NUMERIC` 派生常量 vs `outfitHexToNumber` helper

**选择**：派生常量 `OUTFIT_COLORS_NUMERIC: readonly number[]` 导出自 `avatar-seed.ts`，定义为 `OUTFIT_COLORS.map(hex => parseInt(hex.slice(1), 16))`。

**原因**：`AvatarCustomizer.tsx` 消费的是"一组 { value: number; label: string }"，需要遍历数组生成 swatches。派生常量直接给集合；helper 每次 map 一次是等价但语义更绕。

**替代**：
- (a) 只加 helper `outfitHexToNumber(hex: string): number`，让 `AvatarCustomizer` 自己 map → 接受但多一步。派生常量 SSOT 更直接
- (b) 在 `AvatarCustomizer.tsx` 内部继续维护 number 数组但手动同步 → 违反 D 清理初衷

### Decision 4 — `AvatarCustomizer.tsx` 的 labels 从 `'Blue' / 'Purple' / ...` 派生

**选择**：`CLOTHING_COLORS` 改为 `OUTFIT_COLORS_NUMERIC.map((value, i) => ({ value, label: OUTFIT_LABELS[i] ?? `Color ${i+1}` }))`，新增 `OUTFIT_LABELS: readonly string[]` 导出自 `avatar-seed.ts`（`['Blue', 'Purple', 'Green', 'Indigo', 'Orange', 'Red', 'Cyan', 'Amber']`）。

**原因**：labels 也该 SSOT——否则未来 `OUTFIT_COLORS` 扩色 / 换色时 `AvatarCustomizer` 的 labels 会漂。

**替代**：
- (a) labels 留在 `AvatarCustomizer` 内 → 小事但违反 SSOT 原则。否决
- (b) 用色相解析 hex 自动派生 label → overengineering，8 色手工标 label 没问题

### Decision 5 — `SKIN_COLORS` / `HAIR_COLORS` 保留独立，加注释

**选择**：`AvatarCustomizer.tsx` 的 `SKIN_COLORS` / `HAIR_COLORS` 不归并到 `avatar-seed.ts`，在 `SKIN_COLORS` 声明上方加注释：

```ts
// Manual-config palette for the AvatarCustomizer UI. NOT shared with seed-derived
// rendering (SKIN_TONES in avatar-seed.ts is for hash-index pick; these labeled
// swatches let a user pick explicitly). Keep independent.
```

**原因**：manual-config 和 seed-derived 是两个独立用例。`SKIN_TONES`（7 色，无 label）用来从 hash index pick；`SKIN_COLORS`（5 色，有 label）用来手动 pick。强行合并会让 customizer 失去一致的 UX（要么 SKIN_TONES 加 labels 让 label 集变乱，要么 SKIN_COLORS 失去精选 5 色变 7 色）。

**替代**：
- (a) 合并并加 labels → 语义冲突（见上）
- (b) 把 customizer 的 manual-config 也改成 seed-derived → 破坏手动配色功能

### Decision 6 — LRU cache key 不扩

**选择**：`office-2d-avatar-cache.ts` 的 cache key 保持 `${companyId}:${seed}`，不加 clothingColor 维度。

**原因**：同一 seed 永远派生同一 clothingColor（`outfitColorFromSeed(seed)` 是纯函数），一个 seed 只会生成一种 SVG。不需要区分。

### Decision 7 — `CLAUDE.md` stale 描述的修法

**选择**：line 189 的 bullet 改成：

> - 2D DiceBear 卡通头像和 3D 块人是两种渲染引擎；衣服色通过 `outfitColorFromSeed(seed)` 桥接（2D 的 shirt 色 = 3D 的 body 色，hex 字节等价），其他部件（发型 / 脸 / 配饰）由 DiceBear 自 seed 独立派生

**原因**：说真相，而不是描述已修复的旧状态。

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| DiceBear avataaars `clothingColor` option 在 9.4.2 版本里可能不存在 / 类型不同 / 单元素行为不是 "强制锁定" | Apply Phase 0 读 `node_modules/@dicebear/avataaars@9.4.2/lib/schema.json`（或 types）校验，同时 live 采样：同 seed 传入 `['65c9ff']` 生成 SVG，观察 shirt 色是不是 `#65c9ff`。若约束不符，降级 "只做 D 部分" |
| 衣服色被强制统一后，8 员工只能分到 OUTFIT_COLORS 8 色（hash 可能撞色），视觉多样性下降 | 可接受——3D 侧本来就这样，2D 只是跟进；且 DiceBear 的其他部件（发型 / 脸 / 配饰）仍 seed-派生保持多样性 |
| 已存 employee `persona_json.avatarAppearance.clothingColor` 的 number 不在新 `OUTFIT_COLORS_NUMERIC` 集合里 → AvatarCustomizer 打开时选中态失效 | Phase 0 live 检查是否有真实 `avatarAppearance.clothingColor` 数据。若有：(a) 遵循 MEMORY.md "pre-launch 脏数据清掉不写 migration"，直接清；(b) 若用户已投入配置，保留 `CLOTHING_COLORS` 独立数组不归并，仅文档标注 |
| `DicebearAvatar` 签名扩展 `clothingColor?: string` 可能让未来调用方误传不期望覆盖 | 加 JSDoc 明示默认 seed-派生，`clothingColor` 仅用于特殊场景（测试 / 调试）。当前 change 不暴露给常规调用方 |
| Chat rail / team panel 等已渲染的缓存 URI 在升级后首次加载会 miss 一次重新生成 | 首次渲染一次 DiceBear SVG 生成是 ms 级，用户无感；LRU cache 会迅速填充 |

## Migration Plan

1. **Phase 0**：apply 第一步读 `@dicebear/avataaars@9.4.2` package 里的 schema / types 确认 `clothingColor` option 约束 + live 采样单元素数组行为。若失败，降级分支
2. **Phase 1（UI 层）**：改 `office-2d-avatar-cache.ts` + `DicebearAvatar.tsx`，新增 `OUTFIT_COLORS_NUMERIC` + `OUTFIT_LABELS` 导出
3. **Phase 2（customizer 清理）**：改 `AvatarCustomizer.tsx`，`CLOTHING_COLORS` 派生 + `SKIN_COLORS` / `HAIR_COLORS` 加注释
4. **Phase 3（文档清理）**：改 `CLAUDE.md:189` + `MEMORY.md` 的 Open Issue
5. **Phase 4（验证）**：typecheck/build + live runtime verify（Chrome DevTools MCP） + spec 同步

**Rollback**：纯 git revert。UI 层改动影响面局限在 2D 头像 pipeline + customizer，core / 3D / runtime 零影响。

## Open Questions

- 是否需要给 `DicebearAvatar.tsx` 也暴露 `clothingColor?: string` override prop？默认行为（seed 派生）已足够主流程使用，override 属于"未来需求"。当前 change 不提供，若后续有 use case 再扩。
- DiceBear 还有 `clothing` option（控制款式，不仅颜色），例如 `'blazerShirt' | 'hoodie' | 'shirtCrewNeck' | ...`。是否也按 seed 锁定？**当前 change 不做**——款式对视觉一致性影响较小（3D 是裸块人没款式概念），且锁款式会进一步降低多样性。留给后续需求。
