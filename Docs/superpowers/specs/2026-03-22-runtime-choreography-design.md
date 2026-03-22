# Runtime Choreography — 设计文档 v3（定版）

> 策划 + 制作人 + 前端主程 + 后端主程联合评审定稿

## 概述

当前办公室是静态的——员工固定在工位，发消息后只有颜色/气泡变化。本设计让员工**会走路、会开会、会拿任务、会被抓起来**，把办公室从"着色仪表板"变成"活着的公司"。

### 核心理念

1. **Meeting Room 是仪式书签** — 开始时集合布置计划，结束时集合汇报结果
2. **空间即状态** — 休息区=空闲、Meeting Room=计划/汇报、工位=干活
3. **员工是负责人** — 一个 lead 可以并行处理 N 个 sub-task
4. **LLM 与动画并行** — 走路和 LLM 处理同时进行，无感知延迟

### 已实现的基础（本 session 完成）

- `useAgentAnimation` hook — 5 档状态动画（idle/working/blocked/success/failed）
- 状态脉冲环（ringRef + ringMatRef）
- 帧率无关的指数阻尼过渡
- 2D SVG SMIL 脉冲动画 + CSS transition

---

## 完整任务生命周期

```
用户发消息
  ↓ 即时
Boss 区域闪光（0.3s）+ 流线到 Manager
  ↓ LLM routing（与走路并行）
全员从休息区走向 Meeting Room
  ↓ 到达（~3s）
Meeting 气泡："Analyzing..."
  ↓ PM 出计划
气泡更新："Planning: N steps"
  ↓ 逐个分配（每人 0.5s 间隔）
被分配的人高亮 → 离开 → 走向工位
没分配到的人 → 走回休息区
  ↓ 各自在工位工作
工作动画 + 状态气泡（单任务显示描述，多任务显示 N/M）
  ↓ 全部完成
【结束仪式】参与者走回 Meeting Room
  ↓ Boss Summary
气泡显示最终结果摘要
  ↓ 1.5s 展示
散会 → 全员走回休息区
```

### 关键决策记录

| 决策 | 结论 | 理由 |
|------|------|------|
| 员工默认位置 | **休息区** | 空间即状态：休息区人多=空闲，工位有人=在干活 |
| 全员集合开会 | **是** | 仪式感，用户看到集合就知道"开始了"，看到回来就知道"完成了" |
| 结束仪式触发 | **仅当存在 taskPlan 时** | 简单聊天回复（boss 直接 reply）不触发集合 |
| 并发任务 | **取消当前仪式，开新仪式** | 新消息 = 新一轮工作，旧仪式中断 |
| 移动方式 | **直线，不做 A*** | 开放平面无阻隔 |
| 移动速度 | **4 单位/秒，仪式 5 单位/秒** | 制作人要求不能太慢 |

---

## 子系统 A：寻路移动

### 移动参数

- 直线移动，目标点 ±0.3 随机偏移避免重叠
- 速度：常规 4 单位/秒，仪式集合 5 单位/秒
- 到达减速：最后 0.5 单位 ease-out + 落座 squash（scaleY 0.95→1.0, 0.3s）

### 区域坐标

| Zone | 中心 [x, z] | 用途 |
|------|------------|------|
| rest | [8, 2] | 空闲默认位置 |
| mtg | [-10, -8] | 任务仪式 |
| dev | [-13, 11] | 开发工位 |
| prod | [0, 11] | 产品工位 |
| art | [12, 11] | 设计工位 |

### 行走动画

给 LowPolyCharacter 的肢体加 ref（行走 + 拖拽共用）：

```typescript
interface CharacterLimbRefs {
  leftLeg: React.RefObject<THREE.Mesh | null>;
  rightLeg: React.RefObject<THREE.Mesh | null>;
  leftArm: React.RefObject<THREE.Mesh | null>;
  rightArm: React.RefObject<THREE.Mesh | null>;
  body: React.RefObject<THREE.Mesh | null>;
  head: React.RefObject<THREE.Mesh | null>;
}
```

行走中：
- 腿：交替前后摆 `rotationX = ±sin(t * 8) * 0.4`
- 臂：与腿反相 `rotationX = ∓sin(t * 8) * 0.3`
- 身体上下颠：`posY = abs(sin(t * 8)) * 0.03`
- 面朝方向：`group.rotationY = atan2(dx, dz)`

### 实现

新 hook：`useCharacterMovement(groupRef, limbRefs)`
- useFrame 驱动位置插值 + 肢体旋转
- 通过 ref 接收 MovementTarget（零 re-render）
- **与 `useAgentAnimation` 共存**：移动时 useCharacterMovement 控制位置和肢体，useAgentAnimation 控制状态环和 scale。两者写不同属性，不冲突

### 2D 视图

SVG 移动用 CSS transition：`transition: transform 2s ease-in-out`

---

## 子系统 B：任务编排

### 编排引擎

新组件 `SceneOrchestrator`（在 Office3DView 内），监听 EventBus：

```typescript
eventBus.on('graph.node.entered', (e) => {
  const node = e.payload.nodeName;
  if (node === 'manager') startGatherCeremony();
  if (node === 'step_dispatcher') assignAndDispatch();
  // boss_summary 仅在有 taskPlan 时触发结束仪式
  if (node === 'boss_summary' && hasActivePlan) startReportCeremony();
});
```

### 开始仪式（manager 触发）

1. 所有 enabled 员工从休息区走向 mtg 区域
2. 围成半圆排列（8 个预计算位置，半径 2.5，面朝圆心）
3. mtg 上方大气泡（glassmorphism 风格）显示进度：
   - manager："Analyzing request..."
   - pm_planner："Planning: 3 steps"
   - step_dispatcher："→ Alice: Design UI"

### 逐个分配（step_dispatcher 触发）

1. 被分配员工 scale pulse 1.1 + 名字高亮
2. 0.5s 后该员工离开 meeting → 走向对应 zone 的工位
3. 未分配的人留在 meeting 等下一步
4. 所有步骤分配完 → 剩余人走回**休息区**

### 结束仪式（boss_summary 触发，仅当 hasActivePlan）

1. 参与任务的员工走回 mtg 区域
2. 大气泡显示 Boss 总结内容
3. 展示 1.5s → 全员走回**休息区**

### 并发处理

用户在任务执行中发新消息 → 中断当前仪式 → 所有员工立即停止当前移动 → 开始新一轮（走向 meeting room）

### Meeting 半圆位置

```typescript
const MTG_CENTER: [number, number, number] = [-10, 0, -8];
const MTG_RADIUS = 2.5;
const MTG_POSITIONS = Array.from({ length: 8 }, (_, i) => {
  const angle = Math.PI * (i + 1) / 9;
  return [
    MTG_CENTER[0] + Math.cos(angle) * MTG_RADIUS,
    0,
    MTG_CENTER[2] + Math.sin(angle) * MTG_RADIUS,
  ] as [number, number, number];
});
```

### 后端需求

新增事件 `task.assignment.dispatched`：
```typescript
{
  type: 'task.assignment.dispatched',
  companyId, entityId: employeeId,
  payload: { employeeId, employeeName, stepLabel, stepIndex, totalSteps }
}
```

### 2D 视图

- 集合/散开：CSS transition 移动
- 气泡：DOM overlay（absolute positioned）
- 分配：高亮边框 + 移动到目标区域

---

## 子系统 C：拖拽抓取

### Phase 1（必做）

**抓起**：
- pointerDown + 5px 阈值 → 拖拽激活
- 原位员工 opacity → 0
- 光标出现完整 LowPolyCharacter（替代当前简化 DragGhost3D）
- 提起 y=0.5 + 阴影圆盘
- raycast 到 y=0 平面跟随鼠标

**放下**：
- 有效区域：squash 落地（y 0.5→0 + scaleY 0.9→1.0, 0.2s）
- 无效/取消：飞回原位（0.3s ease-out）

### Phase 2（Nice to have）

手脚晃动：基于鼠标速度驱动肢体摆动（复用 CharacterLimbRefs）

---

## 子系统 D：左侧面板联动

### AgentState 统一扩展

```typescript
interface AgentState {
  name: string;
  role: string;
  state: string;
  taskRunId?: string;
  workstationId?: string | null;
  // 任务信息（D + E 共用）：
  currentTask?: {
    stepLabel: string;
    stepIndex: number;
    totalSteps: number;
  } | null;
  // Sub-agent 并行任务列表（E）：
  subTasks?: Array<{
    stepIndex: number;
    label: string;
    status: 'queued' | 'running' | 'done' | 'failed';
    startedAt?: number;
  }>;
}
```

`use-agent-states.ts` 需增加订阅：
- `task.assignment.dispatched` → 更新 `currentTask`
- `task.subtask.progress` → 更新 `subTasks`

### AgentCard 变化

- 状态 badge：CSS transition（颜色 0.3s）
- 新状态时卡片边框 glow（0.5s）
- 任务信息条：`📋 2/5 Design UI`（从右滑入 0.3s）
- 完成变绿 + ✓（0.5s 后淡出），失败变红 + ✗

---

## 子系统 E：Sub-agent 并行任务

### 概念

员工 = **负责人/Team Lead**。一个 plan 拆成 N 个 task 时，负责人在工位并行处理全部。

### 3D 气泡（简洁，一行）

- 单任务：`⚙️ Design UI`
- 多任务：`⚙️ 3/10 tasks`（数字变化时 pulse）
- 完成时：`✅ 10/10 done`（绿色 flash）

### 左侧 AgentCard（详细，可展开）

```
┌─ Alice · Frontend Lead ─────── ⚙️ ─┐
│  📋 3/10 tasks                      │
│  ├ ✅ Layout ·················· done │
│  ├ ⚙️ Routing ················ 12s  │
│  ├ ⚙️ Auth ·················· 8s   │
│  ├ ⏳ API ··················· queued│
│  └ ⏳ ... +6 more                   │
└─────────────────────────────────────┘
```

点击展开/收起。进度用 `3/10` 数字表示。

### 后端需求

新增事件 `task.subtask.progress`：
```typescript
{
  type: 'task.subtask.progress',
  entityId: employeeId,
  payload: { stepIndex, label, status, totalSteps, completedSteps }
}
```

---

## 实施计划

```
Phase 1: 移动 + 拖拽 (1 session)
├─ LowPolyCharacter 肢体 ref 重构（CharacterLimbRefs）
├─ useCharacterMovement hook（移动 + 行走动画）
├─ DragCharacter3D（真实模型 + squash 落地）
├─ 员工初始位置改为休息区
├─ 2D: CSS transition 移动
└─ 验证：拖拽员工、手动触发移动

Phase 2: 编排 + 面板 (1 session)
├─ 后端: task.assignment.dispatched 事件
├─ SceneOrchestrator（EventBus 编排引擎）
├─ 开始仪式：集合→气泡→逐个分配→散开到工位/休息区
├─ 结束仪式：集合→汇报→散会到休息区
├─ 并发处理：中断旧仪式，开新一轮
├─ AgentState 扩展 + AgentCard 任务卡片
├─ Meeting 气泡 UI（glassmorphism）
├─ 2D: 对应表现
└─ 验证：发消息看完整仪式流程

Phase 3: Sub-agent + 打磨 (1 session)
├─ 后端: task.subtask.progress 事件
├─ 3D 气泡多任务计数
├─ AgentCard sub-task 展开列表
├─ 拖拽物理摆动（如果时间够）
├─ 动画参数调优
└─ 边界情况（中途取消、0员工、Lobster 角色）
```

### 工作量

| Phase | 新文件 | 改动文件 | 预估行数 |
|-------|--------|---------|---------|
| 1 | 1 hook + 1 component | 3 | ~400 |
| 2 | 1 orchestrator + 1 bubble | 5 | ~500 |
| 3 | 0 | 4 | ~250 |
| **合计** | **3** | **12** | **~1150行** |

---

## 技术约束

1. 所有动画 useFrame + ref mutation，零 React re-render
2. `useCharacterMovement` 控制位置和肢体，`useAgentAnimation` 控制状态环和 scale，两者写不同属性不冲突
3. 移动速度 4 单位/秒（仪式 5 单位/秒）
4. LLM 处理与行走并行，无感知延迟
5. 后端新增 `task.assignment.dispatched` + `task.subtask.progress` 事件
6. LowPolyCharacter 肢体 ref（CharacterLimbRefs）行走 + 拖拽共用
7. 员工默认在休息区 idle；分配任务走去工位；完成后走回休息区
8. 结束仪式仅在有 taskPlan 时触发（简单聊天不集合）
9. 并发：新消息中断旧仪式，开新一轮
10. 3D 气泡一行简洁，AgentCard 面板承载详细信息
11. 2D 用 CSS transition，不做逐帧 SVG 动画
