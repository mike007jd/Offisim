# Runtime Completion — Design Spec

**Version:** 1.0
**Date:** 2026-03-12
**Status:** Draft
**Scope:** PRD §5 Runtime features gap — Office Interaction, Employee Versioning, Interview Onboarding, Cost Tracking + Dashboard, Queue Visibility
**Depends on:** `spec/PROJECT_CONSTITUTION.md`, `spec/DESIGN_RULES.md`, `spec/UX_RULES.md`, `SCENE_STATE_MATRIX.md`

---

## 1. Problem Statement

PRD §5 要求 1.0 具备完整的运行时体验，但当前实现存在以下缺口：

| 缺口 | PRD 要求 | 现状 |
|---|---|---|
| 工位拖拽交互 | "办公室场景、工位拖拽、部门与基础布局编辑" | PixiJS 场景渲染了员工但无鼠标/拖拽交互 |
| 员工版本历史 | "版本历史" | employees 表无版本追踪字段 |
| 面谈式入职 | "面谈式入职" | 仅有表单 Dialog |
| 成本追踪 | "成本、状态、错误、通知、队列与下载记录" | llm_calls 表有 token 数但无成本计算 |
| 队列可视化 | "队列" | task_runs 有状态但无队列 UI |

---

## 2. Design Principles

1. **Event-driven presentation** — 所有视觉反馈由 EventBus 事件驱动，不发明业务状态
2. **Repository pattern** — 新增数据通过 Repository 接口 + memory/drizzle 双实现
3. **渐进增强** — Tier A/B/C 性能降级，reduced-motion 支持
4. **Local-first** — 所有数据存储在本地 SQLite，不依赖远程服务
5. **复用优先** — 使用已有 SceneEntity 接口、GSAP 动画、shadcn/ui 组件

---

## 3. Feature Design

### 3.1 Office Workstation Drag-Drop Interaction

#### 3.1.1 交互模型

```
User mousedown on entity → enter drag mode → visual feedback (ghost + highlight)
→ hover over workstation → show drop target → release → assign/unassign
→ EventBus emit → DB update → scene update → permission flow
```

**PixiJS 8 交互 API 注意事项：**
- PixiJS 8 使用 `eventMode = 'static'` 或 `'dynamic'` 而非旧版 `interactive = true`
- 拖拽使用 `pointerdown` / `pointermove` / `pointerup` 事件
- Entity Container 设置 `eventMode = 'static'`，`cursor = 'grab'`

#### 3.1.2 拖拽状态机

```
idle → dragging (pointerdown on entity)
dragging → hovering_target (pointermove over valid workstation)
dragging → cancelled (Escape key / pointerup outside target)
hovering_target → assigned (pointerup on workstation)
hovering_target → dragging (pointermove away from workstation)
```

#### 3.1.3 视觉反馈

| 状态 | World Layer | Motion |
|---|---|---|
| dragging | 实体跟随鼠标，原位显示半透明 ghost，L6 focus 层显示拖拽阴影 | M2 |
| hovering_target | 目标工位高亮（accent 层边框发光），工位标签显示 | M1 |
| assigned | 实体滑动到工位位置，入场动画 | M1 |
| cancelled | 实体弹回原位 | M2 |

#### 3.1.4 权限流

工位分配更新流程：
1. `employees.workstation_id` 更新
2. 触发 `employee.workstation.changed` 事件
3. 旧工位关联的 Rack/Slot 权限撤销
4. 新工位关联的 Rack/Slot 权限授予
5. Scene 更新实体位置

#### 3.1.5 约束

- 工位有 `seat_capacity`，满座时拒绝放置并显示提示
- 拖拽到空白区域 = 取消分配（从工位离开）
- Accessibility：提供 DOM 面板的 "Assign to Workstation" 下拉作为非 canvas 替代路径（UX_RULES §Accessibility）
- Reduced motion：实体直接 snap 到目标位置，无滑动动画

#### 3.1.6 新增 SceneEntity 接口方法

```typescript
// 在 SceneEntity 接口新增（可选方法）
interface SceneEntity {
  // ... existing
  /** 设置为可拖拽 */
  setDraggable?(enabled: boolean): void;
  /** 设置拖拽视觉状态 */
  setDragState?(state: 'idle' | 'dragging' | 'drop-valid' | 'drop-invalid'): void;
}
```

不在 SceneEntity 上强制要求拖拽方法——拖拽逻辑属于 SceneManager 的 InteractionController。

#### 3.1.7 InteractionController 设计

提取到独立类 `InteractionController`，由 SceneManager 持有：

```typescript
class InteractionController {
  constructor(
    private stage: Container,
    private entities: Map<string, SceneEntity>,
    private workstationPositions: Map<string, { x: number; y: number; capacity: number }>,
    private eventBus: SceneEventBus,
    private motion: MotionTokens,
  ) {}

  enable(): void;   // 注册 pointer 事件
  disable(): void;  // 注销 pointer 事件
  destroy(): void;  // 清理
}
```

---

### 3.2 Employee Version History

#### 3.2.1 数据模型

新增 `employee_versions` 表：

```sql
CREATE TABLE employee_versions (
  version_id    TEXT PRIMARY KEY,
  employee_id   TEXT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  version_num   INTEGER NOT NULL,
  change_type   TEXT NOT NULL,  -- 'create' | 'update' | 'rollback'
  snapshot_json TEXT NOT NULL,  -- 完整 employee 快照（name, role, persona, config）
  change_summary TEXT,          -- 自动生成的变更摘要
  created_by    TEXT NOT NULL DEFAULT 'user',  -- 'user' | 'system' | 'install'
  created_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_emp_ver_emp_num ON employee_versions(employee_id, version_num);
CREATE INDEX idx_emp_ver_emp ON employee_versions(employee_id);
```

#### 3.2.2 快照策略

- **Save on edit**: `useEmployeeEditor.save()` 成功后自动存储版本
- **Save on create**: 首次创建 = version 1, change_type = 'create'
- **Save on rollback**: 回滚也记录为新版本，change_type = 'rollback'
- 快照是完整的 JSON blob（不是 diff），保证独立可读
- 版本号单调递增，不允许间隙

#### 3.2.3 Repository 接口

```typescript
interface EmployeeVersionRow {
  version_id: string;
  employee_id: string;
  version_num: number;
  change_type: 'create' | 'update' | 'rollback';
  snapshot_json: string;
  change_summary: string | null;
  created_by: string;
  created_at: string;
}

interface EmployeeVersionRepository {
  create(version: Omit<EmployeeVersionRow, 'version_id' | 'created_at'>): Promise<EmployeeVersionRow>;
  findByEmployee(employeeId: string, opts?: { limit?: number }): Promise<EmployeeVersionRow[]>;
  findByVersion(employeeId: string, versionNum: number): Promise<EmployeeVersionRow | null>;
  getLatestVersion(employeeId: string): Promise<number>;
}
```

#### 3.2.4 版本比较

`diffVersions(a: snapshot, b: snapshot)` 返回结构化 diff：

```typescript
interface VersionDiff {
  field: string;   // e.g. 'name', 'persona.expertise', 'config.temperature'
  from: unknown;
  to: unknown;
}
```

使用 flat path 比较（`JSON.stringify` 两层扁平），不引入 deep-diff 库。

#### 3.2.5 UI 设计

在 EmployeeEditorDialog 的 `Tabs` 中新增第 4 个 Tab "History"：

- 时间线列表：版本号 + 时间 + change_type + summary
- 点击版本展开 diff 对比（与当前版本 or 上一版本）
- "Rollback to this version" 按钮，需二次确认
- 空状态：新员工只有 1 个版本时显示 "No previous versions"

---

### 3.3 Interview-Style Onboarding

#### 3.3.1 交互流程

```
User clicks "New Employee" → opens Interview Wizard (fullscreen Dialog)
→ HR agent 提问 → 用户回答 → 逐步构建 employee config
→ 最终 Preview → Confirm → 创建员工 + version 1
```

#### 3.3.2 对话阶段

| 阶段 | HR 提问方向 | 提取字段 |
|---|---|---|
| 1. Role | "What role are you hiring for?" + 角色选项 | role_slug |
| 2. Name & Identity | "What should we call them?" | name |
| 3. Expertise | "What are their key skills and experience?" | persona.expertise |
| 4. Working Style | "How do they approach work?" | persona.style |
| 5. Instructions | "Any special instructions?" | persona.customInstructions |
| 6. Model Config | "Any model preferences?" (optional, can skip) | config.* |
| 7. Preview | 汇总展示，允许编辑 | — |

#### 3.3.3 实现策略

**不依赖 LLM 进行 onboarding。** 原因：
- 入职流程必须离线可用（Local-first 原则）
- LLM 延迟会破坏流畅感
- 字段提取准确性无法保证

使用 **结构化问答 UI**（stepper wizard），每步一个卡片，带预设选项 + 自由文本：
- 模拟"面谈"感觉：每步有 HR 角色的引导文案
- 角色选择用卡片网格（不是下拉）
- 技能用 tag input + 建议列表
- 最终 Preview 页可直接编辑任何字段

#### 3.3.4 组件结构

```
InterviewWizard (Dialog, fullscreen)
├── InterviewStep (泛型步骤容器，带 HR 头像 + 对话框)
│   ├── RoleStep — 角色卡片网格
│   ├── NameStep — 输入框 + 随机名生成器
│   ├── ExpertiseStep — tag input
│   ├── StyleStep — 预设选项 + 自由文本
│   ├── InstructionsStep — textarea
│   └── ModelStep — optional, 可跳过
└── PreviewStep — 完整配置预览 + inline 编辑
```

#### 3.3.5 状态管理

wizard 状态用 `useReducer` 管理：

```typescript
type WizardState = {
  currentStep: number;
  formData: EmployeeFormData;
  completedSteps: Set<number>;
};
type WizardAction =
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'goto'; step: number }
  | { type: 'updateField'; key: keyof EmployeeFormData; value: unknown }
  | { type: 'reset' };
```

#### 3.3.6 入口点

AgentPanel 的 "+" 按钮改为下拉菜单：
- "Quick Create" → 现有 EmployeeEditorDialog
- "Interview Onboarding" → InterviewWizard

---

### 3.4 Cost Tracking + Boss Dashboard

#### 3.4.1 成本计算模型

新增 `model_cost_rates` 表：

```sql
CREATE TABLE model_cost_rates (
  rate_id         TEXT PRIMARY KEY,
  provider        TEXT NOT NULL,
  model_pattern   TEXT NOT NULL,  -- glob pattern, e.g. 'gpt-4*', 'claude-3-opus*'
  input_cost_per_mtok  REAL NOT NULL,  -- $ per million input tokens
  output_cost_per_mtok REAL NOT NULL,  -- $ per million output tokens
  effective_from  TEXT NOT NULL,
  effective_until TEXT,           -- NULL = current rate
  created_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_cost_rates_provider_model ON model_cost_rates(provider, model_pattern, effective_from);
```

#### 3.4.2 成本计算服务

```typescript
interface CostCalculationService {
  /** 计算单次 LLM 调用成本 */
  calculateCallCost(call: LlmCallRow): Promise<{ inputCost: number; outputCost: number; totalCost: number }>;
  /** 聚合时间段内总成本 */
  aggregateCost(companyId: string, opts: {
    from?: string;
    to?: string;
    groupBy?: 'model' | 'employee' | 'day';
  }): Promise<CostAggregate[]>;
}

interface CostAggregate {
  groupKey: string;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  callCount: number;
}
```

成本计算规则：
- 使用 `model_pattern` glob 匹配（`*` 通配符）
- 优先匹配最精确的 pattern
- 无匹配时 cost = 0，不阻塞流程
- 内置默认费率表（主流模型 2026 价格），用户可覆盖

#### 3.4.3 Boss Dashboard 设计

Dashboard 作为 `apps/web` 的顶级 Tab 或侧边栏面板：

```
BossDashboard
├── CostOverview — 总成本、今日成本、趋势图（简单柱状图）
│   ├── CostByModelChart
│   └── CostByEmployeeChart
├── CompanyStatus — 员工状态摘要（idle/active/blocked 计数）
│   └── ActiveTasksSummary
├── TaskQueue — 当前活跃 + pending 任务列表
│   └── TaskQueueItem — 状态、员工、时长
└── RecentActivity — 最近 N 条运行时事件
```

#### 3.4.4 可视化选型

**不引入重量级图表库。** 使用：
- 数字卡片（KPI cards）— 用现有 `Card` 组件
- 简单条形图 — 纯 CSS（div width 百分比）或 Canvas 2D
- 状态分布 — CSS 进度条

如果未来需要更丰富的图表，可在 1.1 引入轻量库（如 lightweight-charts 或 uPlot），但 1.0 不引入。

---

### 3.5 Queue Visibility

#### 3.5.1 队列数据来源

现有 `task_runs` 表已有 `status` 字段。队列视图需要：
- pending tasks (status = 'pending' | 'queued')
- active tasks (status = 'running')
- recently completed (status = 'completed' | 'failed', last 10)

#### 3.5.2 TaskQueueRepository 扩展

在 `TaskRunRepository` 上新增：

```typescript
interface TaskRunRepository {
  // ... existing
  /** 获取队列视图数据 */
  findQueue(companyId: string, opts?: {
    statuses?: string[];
    limit?: number;
  }): Promise<TaskRunRow[]>;
  /** 获取活跃任务计数 */
  countByStatus(companyId: string): Promise<Record<string, number>>;
}
```

#### 3.5.3 队列面板 UI

`TaskQueuePanel` 嵌入 BossDashboard 或作为独立侧边栏 section：

```
TaskQueuePanel
├── QueueSummary — "3 active, 2 pending, 5 completed today"
├── ActiveTasks — 实时更新的活跃任务列表
│   └── TaskQueueItem — 员工头像 + 任务类型 + 持续时间 + 状态 badge
├── PendingTasks — 等待中的任务
└── RecentCompleted — 可折叠的最近完成列表
```

实时更新通过 EventBus `task.state.changed` 事件驱动 React state。

---

## 4. New Event Types

| Event Family | Payload | 触发点 |
|---|---|---|
| `employee.workstation.changed` | `{ employeeId, fromWorkstationId, toWorkstationId }` | 拖拽分配完成 |
| `employee.version.created` | `{ employeeId, versionNum, changeType }` | 版本快照保存 |
| `cost.aggregated` | `{ companyId, totalCost, period }` | Dashboard 刷新 |

---

## 5. New DB Tables Summary

| 表名 | 目的 | Migration 编号 |
|---|---|---|
| `employee_versions` | 员工配置版本快照 | 009 |
| `model_cost_rates` | 模型成本费率 | 010 |

---

## 6. Cross-cutting Concerns

### 6.1 Desktop vs Browser

- 所有新功能在 Desktop (Tauri) 和 Browser 环境都可用
- `model_cost_rates` 在 Browser 用 memory 存储，Desktop 用 SQLite
- 拖拽交互仅在 PixiJS canvas 中，两个环境行为一致

### 6.2 Performance Budget

- 拖拽交互：pointermove handler 需 requestAnimationFrame 节流
- Dashboard 聚合查询：使用 SQL 聚合而非 JS 遍历
- 版本历史：默认只加载最近 20 个版本，分页加载

### 6.3 Testing Strategy

| 层 | 测试方法 |
|---|---|
| Repository | Vitest 单元测试，memory 实现 |
| Service 层 | Vitest 单元测试，mock repository |
| InteractionController | Vitest 单元测试，mock PixiJS Container |
| React Components | Vitest + React Testing Library |
| 集成 | Manual smoke test (scene + DB) |

---

## 7. Risks and Mitigations

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| PixiJS 8 拖拽 API 与旧教程不同 | 开发延迟 | 先写 spike test 验证 API |
| 版本快照膨胀 | 存储增长 | 默认保留最近 100 版本，可配置清理 |
| 成本费率过时 | 计算不准 | 提供手动更新入口，不做自动同步 |
| 面谈 wizard 步骤过多 | 用户流失 | 每步可选 skip，最终 preview 可编辑 |

---

## 8. Out of Scope (1.0)

- 自由布局编辑器（固定 2x2 desk grid）
- LLM 驱动的面谈对话（使用结构化 UI 替代）
- 实时成本费率 API 同步
- 部门/房间拖拽编辑
- 成本预算报警
- 任务优先级排序拖拽

---

## 9. Dependencies

- PixiJS 8 pointer events (已集成)
- GSAP 3 (已集成)
- Drizzle ORM (已集成)
- shadcn/ui Tabs, Dialog, Card, Badge (已集成)
- Lucide icons (已集成)

无新外部依赖。
