## Context

3D 员工在 `office3d-employees.tsx` 中通过 `globalIndex % OUTFIT_COLORS.length` 分配颜色，globalIndex 是 usePlacedEmployees 迭代时的递增计数器。2D 在 `Office2DCanvasView.tsx` 中用 `agent.name` 作为 DiceBear seed（行 137）。`persona_json.avatarSeed` 存在但只有 EmployeeCreatorOverlay 创建的员工才有，且 2D 渲染没用它。

## Goals / Non-Goals

**Goals:**
- 同一员工在 2D 和 3D 中的 outfit color 对应稳定
- 颜色不受员工列表顺序影响（去掉 globalIndex 依赖）
- 复用已有 OUTFIT_COLORS / SKIN_TONES 调色板

**Non-Goals:**
- 不做 2D/3D 像素级一致（DiceBear 是卡通风格，3D 是 low-poly，不需要完全匹配）
- 不改 DiceBear 的 avataaars 风格或 3D 模型 mesh
- 不做头像编辑器或用户自定义配色
- 不改 persona_json schema（avatarSeed 字段保持可选）

## Decisions

### D1: 创建 `avatar-seed.ts` 工具模块

**选择**: 新文件 `packages/ui-office/src/lib/avatar-seed.ts`，导出：
- `resolveAvatarSeed(agent: { name: string; persona_json?: string }): string` — 解析 avatarSeed，回退 name
- `hashSeed(seed: string): number` — 确定性 hash（简单 djb2 或类似算法）
- `outfitColorFromSeed(seed: string): string` — `OUTFIT_COLORS[hashSeed(seed) % 8]`
- `skinToneFromSeed(seed: string): string` — `SKIN_TONES[hashSeed(seed) % 7]`（用不同 salt 避免 outfit 和 skin 总是同一个 index）

**备选**: 把 hash 逻辑放在 3D 文件里。否决理由：2D 也需要 seed 解析，应共享。

### D2: 3D 渲染用 seed hash 替代 globalIndex

**选择**: `office3d-employees.tsx` 中 `usePlacedEmployees` 改为用 `outfitColorFromSeed(seed)` + `skinToneFromSeed(seed)` 替换 `OUTFIT_COLORS[globalIndex % 8]` + `SKIN_TONES[globalIndex % 7]`。seed 从 agent name 或 persona_json 获取。

### D3: 2D 渲染 seed 来源统一

**选择**: `Office2DCanvasView.tsx` 行 137 的 `seed: agent.name` 改为 `seed: resolveAvatarSeed(agent)`。其他位置（行 379 ceremony）同样改。

### D4: OUTFIT_COLORS / SKIN_TONES 移到 avatar-seed.ts

**选择**: 把两个数组从 office3d-employees.tsx 移到 avatar-seed.ts 作为导出常量。3D 文件 import 它们。这样颜色定义有一个 SSOT。

## Risks / Trade-offs

- **[风险] 颜色分布不均** → djb2 hash 在小 modulus (8/7) 下分布足够均匀。如果不满意可以后续加 Fisher-Yates shuffle seed。
- **[风险] 已有员工颜色会变化** → 接受：当前颜色本身就是不稳定的（globalIndex 随列表顺序变），切到 seed-based 后会一次性变化但之后稳定。
- **[风险] persona_json 解析性能** → resolveAvatarSeed 只做一次 JSON.parse + 字段读取，在渲染路径上开销可忽略。
