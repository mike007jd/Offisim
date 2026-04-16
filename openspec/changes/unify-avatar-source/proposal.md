## Why

3D 员工外观（outfit color + skin tone）由 `globalIndex % arrayLength` 决定，跟员工身份完全无关——员工列表顺序变化会导致颜色变化。2D 用 `agent.name` 做 DiceBear seed，虽然稳定但与 3D 无对应关系。同一个员工在 2D/3D 之间视觉不一致。

## What Changes

- 引入 `resolveAvatarSeed(employee)` 工具函数：优先用 `persona_json.avatarSeed`，回退到 `employee.name`
- 3D 的 outfit color 和 skin tone 改为从 seed 的 hash 值 derive（`hashCode(seed) % arrayLength`），不再用 globalIndex
- 2D 的 avatar seed 统一走 `resolveAvatarSeed`（当前硬编码 `agent.name`）
- 结果：同一员工在 2D/3D 之间颜色对应稳定，且不受列表顺序影响

## Capabilities

### New Capabilities
- `avatar-seed-resolution`: 统一的员工外观种子解析，2D 和 3D 共用

### Modified Capabilities
(无——纯视觉一致性改进，不改变任何行为 requirement)

## Impact

- `packages/ui-office/src/components/scene/office3d-employees.tsx` — outfit/skin 从 seed hash 取值
- `packages/ui-office/src/components/scene/Office2DCanvasView.tsx` — seed 来源改为 resolveAvatarSeed
- 新增 `packages/ui-office/src/lib/avatar-seed.ts` — 共享 seed 解析 + hash 函数
