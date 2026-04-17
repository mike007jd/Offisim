## Why

2D DiceBear 卡通头像和 3D 块人用同一 `resolveAvatarSeed(employee)`，但衣服颜色算法完全独立——DiceBear 自行 seed-派生出它内部 palette 里的某色，3D 走 `outfitColorFromSeed(seed)` 映射到我们自维护的 8 色 `OUTFIT_COLORS`。同一员工在 2D chat 头像里的 shirt 色和 3D 场景里的 body 色毫无关系，切视图视觉无锚点。用户要求保留 DiceBear 风格（同级细节自画不现实），目标是通过 DiceBear 的 `clothingColor` option 把 2D 衣服色强制对齐我们 3D 侧的 `outfitColorFromSeed`，让两个视图"衣服是一样的蓝色"这个锚点站得住。

同时：`AvatarCustomizer.tsx` 独立维护了第三套 palette（`SKIN_COLORS` / `HAIR_COLORS` / `CLOTHING_COLORS`，number-typed 0xRRGGBB），其中 `CLOTHING_COLORS` 和 `OUTFIT_COLORS` 重复语义不同源；`CLAUDE.md` 的 "3D 硬编码 OUTFIT_COLORS / SKIN_TONES" 描述是 2026-04-16 `unify-avatar-source` archive 之后就 stale 的——一并清理。

## What Changes

- **2D DiceBear clothingColor 桥接**：`office-2d-avatar-cache.ts` 和 `DicebearAvatar.tsx` 在调 `createAvatar(avataaars, {...})` 时 append `clothingColor: [outfitColorFromSeed(seed).slice(1)]` option，强制 DiceBear 生成的 shirt 色 = 我们 3D 侧 body 色
- **AvatarCustomizer palette 归并**：`CLOTHING_COLORS`（number-typed）改为从 `avatar-seed.ts` 派生（新增 `OUTFIT_COLORS_NUMERIC` 或 helper `outfitHexToNumber`），确保 manual-config palette 与 seed-derived palette 同源
- **独立 palette 保留并标注**：`SKIN_COLORS` / `HAIR_COLORS` 不归并（它们是 customizer 专用，manual-config palette 独立于 seed-derived 合法），加注释明确语义
- **stale doc 清理**：修 `CLAUDE.md` 关于 3D 硬编码的 bullet（改成桥接状态）
- `avatar-seed-resolution` capability 新增一条 Requirement 描述 2D DiceBear outfit color 的派生契约

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `avatar-seed-resolution`: 新增 requirement "2D DiceBear outfit color derives from same seed as 3D"——把 DiceBear `clothingColor` 的强制约束纳入契约。其余 4 条 requirement 不变。

## Impact

- **Code**
  - `packages/ui-office/src/components/scene/office-2d-avatar-cache.ts` — 给 `createAvatar` 调用 append `clothingColor` option
  - `packages/ui-office/src/components/shared/DicebearAvatar.tsx` — 同步
  - `packages/ui-office/src/lib/avatar-seed.ts` — 新增 `OUTFIT_COLORS_NUMERIC` 派生 或 helper
  - `packages/ui-office/src/components/employees/AvatarCustomizer.tsx` — `CLOTHING_COLORS` 改为从 SSOT 派生，加独立 palette 注释
  - `CLAUDE.md` — 修 stale "3D 硬编码" bullet
- **Schema / Types**: 无变更。`LlmStreamChunkPayload` / `AvatarAppearance` 等字段不动。
- **Dependencies**: 无新增。复用现有 `@dicebear/core@9.4.2` + `@dicebear/avataaars@9.4.2` 的 `clothingColor` option。
- **Risk**:
  - DiceBear `clothingColor` option shape 版本差异——apply Phase 0 先读 `node_modules/@dicebear/avataaars/lib/schema.json` 确认存在性和类型，若 option 不存在或约束异常，降级为"只做 D 部分"（palette 归并 + 文档清理）
  - 已保存 employee `persona_json.avatarAppearance.clothingColor` 的 number 值若不在新 `OUTFIT_COLORS_NUMERIC` 集合里，live 会 surface 为"旧选择失效"——遵循 MEMORY.md 的 "pre-launch 脏数据清掉不写 migration" 纪律，live 观察有无真实用户数据再定降级策略
  - LRU avatar cache key 不含 clothingColor，但同一 seed 永远派生同一 clothingColor，cache hit 稳定无需扩 key
