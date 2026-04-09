# SOP DAG Editor V2 — 可视化节点编辑器重设计

## Context

当前 SOP DAG "编辑器"是假的——节点位置由拓扑排序算法计算、不可拖拽、Add Step 只能创建硬编码空节点、没有角色选择。需要重新设计为真正的可视化工作流编辑器。

## 当前架构问题

1. **节点位置不持久** — `computeDagLayout()` 每次从 `dependencies` 纯计算，无 position 存储
2. **节点不可拖拽** — 没有节点级 drag 交互，只有画布级 pan
3. **Add Step 缺 UI** — 没有角色/员工选择器，硬编码 `role_slug: 'developer'`
4. **数据模型无位置字段** — `SopStep` 只有 `step_id, label, role_slug, instruction, dependencies, output_key`

## 设计方案

### 1. 数据模型扩展

**`packages/shared-types/src/sop.ts` — SopStep 增加可选位置字段：**
```ts
interface SopStep {
  // ...existing fields...
  position?: { x: number; y: number }; // 手动布局位置，undefined 时走自动布局
}
```

**布局策略：**
- 有 `position` 的节点用手动坐标
- 无 `position` 的节点走现有 `computeDagLayout` 自动布局
- 首次进入编辑模式时，自动布局坐标"烘焙"到每个节点的 `position` 字段（一次性）
- 后续拖拽直接更新 `position`

### 2. 节点拖拽

**`SopDagCanvas.tsx`：**
- 新增 `draggingNode: { stepId: string, offsetX: number, offsetY: number } | null` 状态
- mouseDown 在节点上 → 记录 offset，进入节点拖拽模式（区分于画布 pan）
- mouseMove → 更新节点 position（实时预览）
- mouseUp → 持久化新 position 到 definition

**区分画布 pan vs 节点 drag：**
- 节点上 mouseDown → 节点拖拽
- 空白区域 mouseDown → 画布 pan
- 端口上 mouseDown → 连线模式（已实现）

### 3. Add Step 对话框

**新组件 `SopAddStepPopover.tsx`：**
- 点击 "Add Step" 按钮或双击画布空白处触发
- 表单字段：
  - `label` — 步骤名称
  - `role_slug` — 角色选择器（developer/designer/pm/qa/devops）
  - `instruction` — 简要指令
- 创建后节点放置在点击位置或画布视口中心
- 可选：从公司员工列表选择（映射到 role_slug）

### 4. 节点右键菜单 / 选中操作

**选中节点后的操作：**
- Edit — 弹出编辑 popover（修改 label/role/instruction）
- Delete — 删除节点 + 清理引用
- Duplicate — 复制节点到偏移位置

### 5. 布局算法适配

**`sop-dag-layout.ts` 修改：**
```ts
function computeDagLayout(definition: SopDefinition): DagLayout {
  // 如果所有 step 都有 position → 使用手动位置
  // 否则 → 走现有拓扑排序自动布局
  // 混合模式：有 position 用 position，无 position 的自动填充
}
```

**"Auto Layout" 按钮：** 清除所有 `position` 字段，回到自动布局

### 6. 文件清单

| 文件 | 改动 |
|------|------|
| `packages/shared-types/src/sop.ts` | SopStep 加 `position?` |
| `packages/ui-office/src/components/sop/sop-dag-layout.ts` | 混合布局（手动 + 自动） |
| `packages/ui-office/src/components/sop/SopDagCanvas.tsx` | 节点拖拽 + 空白双击添加 |
| `packages/ui-office/src/components/sop/SopAddStepPopover.tsx` | **NEW** 添加步骤 UI |
| `packages/ui-office/src/components/sop/SopNodeContextMenu.tsx` | **NEW** 右键/选中操作菜单 |
| `packages/ui-office/src/components/sop/SopViewSurface.tsx` | 新增 mutation handler |
| `packages/ui-office/src/components/sop/SopLibraryBar.tsx` | Auto Layout 按钮 |

### 7. 交互规范

```
画布空白 mouseDown  → 画布 pan
节点 mouseDown       → 节点拖拽（编辑模式）/ 选中（非编辑模式）
端口 mouseDown       → 连线拖拽
Edge 点击            → 断开连接（编辑模式）
双击空白             → 添加步骤（编辑模式）
双击节点             → 编辑步骤
Delete 键            → 删除选中节点
Escape              → 取消当前操作
```

### 8. 验证

1. `pnpm typecheck` — 全量通过
2. `pnpm test` — 全量通过
3. 浏览器：创建新 SOP → 添加 3 个不同 role 的步骤 → 拖拽排列 → 连线 → 保存 → 刷新后位置保留
4. 浏览器：Auto Layout → 回到算法布局 → 再拖拽 → 位置又持久化
5. 浏览器：运行 SOP → 节点状态实时变色（active/completed/failed）
