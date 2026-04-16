## 1. 创建 avatar-seed 模块

- [x] 1.1 创建 `packages/ui-office/src/lib/avatar-seed.ts`
- [x] 1.2 实现 `resolveAvatarSeed(agent: { name: string; persona_json?: string | null }): string`
- [x] 1.3 实现 `hashSeed(seed: string): number`（djb2 或类似确定性 hash）
- [x] 1.4 从 `office3d-employees.tsx` 移入 `OUTFIT_COLORS` 和 `SKIN_TONES` 数组，导出为常量
- [x] 1.5 实现 `outfitColorFromSeed(seed: string): string` 和 `skinToneFromSeed(seed: string): string`

## 2. 改造 3D 渲染

- [x] 2.1 `office3d-employees.tsx` 删除本地 OUTFIT_COLORS / SKIN_TONES，改为从 avatar-seed 导入
- [x] 2.2 `usePlacedEmployees` 中 outfit/skin 赋值从 `globalIndex % length` 改为 `outfitColorFromSeed(seed)` / `skinToneFromSeed(seed)`
- [x] 2.3 确认 seed 来源：从 agent 数据中获取（name 或 persona_json）

## 3. 改造 2D 渲染

- [x] 3.1 `Office2DCanvasView.tsx` 中所有 `seed: agent.name` 改为 `seed: resolveAvatarSeed(agent)`
- [x] 3.2 确认 ceremony 路径（行 379 附近）也使用 resolveAvatarSeed

## 4. 验证

- [x] 4.1 `pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web typecheck` 全绿
- [x] 4.2 浏览器 dev 验证：3D 视图员工颜色正常显示
- [x] 4.3 浏览器 dev 验证：2D 视图员工头像正常显示
- [x] 4.4 确认 OUTFIT_COLORS 和 SKIN_TONES 只在 avatar-seed.ts 定义（grep 验证）
