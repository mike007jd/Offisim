# UX Transparency & Safety Spec — v1.0-rc.1

> **核心论断：** Offisim 的引擎在后台做了大量正确的事，但前端像个黑箱。1.0 的关键不是"能不能用"，是"用了之后觉不觉得系统在工作"。
>
> **设计原则：** 选边"过程即价值"——凡是系统做了的事，玩家必须能看到、理解、干预。

---

## 依据

- `Docs/audit/ux_edge_case_audit_2026-04-12.md` — 4 CRITICAL / 5 HIGH / 14 MEDIUM
- `Docs/business-logic-map.md` v2 — 已更新的 ground truth
- 制作人 critique：反馈循环断裂 + agency 悖论 + 入口收窄

---

## Tier 0: CRITICAL Bug Fix (丢数据 / 卡死)

### T0-1: Install 并发守卫
**问题：** `useInstallFlow.ts:341` — 快速双击 Install 启动两个并发下载/物化，txnIdRef 互覆盖  
**修复：** `startRegistryInstall` 开头加 `if (txnIdRef.current) return`  
**文件：** `packages/ui-office/src/hooks/useInstallFlow.ts`  
**验证：** 快速双击 Install，只触发一次流程

### T0-2: Settings reinit 失败反馈
**问题：** `SettingsWorkspaceSurface.tsx:457` — config 已保存但 reinitRuntime 失败时 `isReinitializing` 卡 true，无 error  
**修复：** reinit 后 watch `runtimeVersion` 变化，5s 超时显示 error + 重置 `isReinitializing`  
**文件：** `packages/ui-office/src/components/settings/SettingsWorkspaceSurface.tsx`  
**验证：** 保存无效 provider config，5s 后看到错误提示

### T0-3: Studio 保存错误提示
**问题：** `StudioPage.tsx:297-350` — `saveZonesToDb()` 异常时 `markClean()` 未执行且无 error 提示  
**修复：** try/catch 包 saveZonesToDb，catch 中用 `useNotifications()` 弹 error toast  
**文件：** `packages/ui-office/src/components/studio/StudioPage.tsx`  
**验证：** 模拟保存失败（断网），看到 error toast，dirty 标记保持

### T0-4: SOP 角色验证
**问题：** `SopViewSurface.tsx:369` — SOP 步骤 role_slug 无存在性验证，执行时 fallback 到随机员工  
**修复：** `handleRun()` 执行前校验所有 step 的 role_slug 对应公司现有员工，不匹配时弹 warning toast 列出缺失角色  
**文件：** `packages/ui-office/src/components/sop/SopViewSurface.tsx`  
**验证：** 创建引用不存在角色的 SOP 步骤，点 Run，看到 warning

---

## Tier 1: 系统透明度 (让玩家看到引擎在工作)

### T1-1: Employee Memories Panel
**问题：** 记忆系统是核心差异化，但玩家完全看不到  
**方案：** EmployeeInspector 新增 "Memories" 折叠区，展示 top-10 memories（按 importance 降序）

**设计：**
```
[EmployeeInspector]
  ├── Status: Working on "Design landing page"
  ├── Role: Designer
  ├── Memories (7)           ← 新增
  │   ├── ★ "Boss prefers minimal UI"     experience  0.92  [Forget]
  │   ├── ★ "Use Tailwind not plain CSS"  preference  0.85  [Forget]
  │   └── ... (expand to see all, top-5 by importance)
  └── [Edit] [Chat]
```

**决策（2026-04-12 锁定）：** 展示 top-5 按 importance 排序，可折叠展开看全部。每条带 "Forget" 按钮（调用 `repos.memories.delete(id)`）。不加编辑功能。

**文件：**
- `packages/ui-office/src/components/agents/EmployeeInspector.tsx` — 新增 MemoriesSection
- `packages/ui-office/src/hooks/useEmployeeMemories.ts` — 已存在，直接引用

**验证：** 员工完成任务后，inspector 中 Memories 计数增加，展开可见新记忆

### T1-2: Route Decision Label
**问题：** 玩家看得到管道阶段但不知道 boss 选了什么路由  
**方案：** PipelineProgress 在 manager 阶段显示路由决策标签

**设计：** 管道从 `Boss → Routing → ...` 改为 `Boss → Delegating task → Planning → ...` 或 `Boss → Starting meeting → ...`

**实现：**
- boss-node 已在 state 中写入 `routeDecision`（BossDecision.action）
- `usePipelineStage.ts` 读 `graph.node.entered` 事件，需要额外订阅 boss 路由事件
- 新增 `routeLabel` 字段：`delegate` → "Delegating task" / `meeting` → "Starting meeting" / `direct_delegate` → "Direct assignment" / `hire_or_assess` → "HR assessment" / `use_sop` → "Running SOP" / `direct_reply` → "Thinking..."

**文件：**
- `packages/ui-office/src/hooks/usePipelineStage.ts`
- `packages/ui-office/src/components/chat/PipelineProgress.tsx`

**决策（2026-04-12 锁定）：** 只显示路由标签，不加取消窗口。判断错了用户 Stop 重发。

**验证：** 发消息后管道显示具体路由类型

### T1-3: Meeting Action Items 展示
**问题：** Meeting 提取了 action items 但玩家不知道  
**方案：** 会议 summary 消息后追加 action items 列表，每条带 "Delegate" 按钮

**设计：**
```
[Meeting Summary]
  "The team discussed X and agreed on Y..."
  
  Action Items:                              ← 新增
  ☐ Design the landing page — @Designer     [Delegate →]
  ☐ Write API docs — @Engineer              [Delegate →]
```

**实现：**
- `meeting.action.created` 事件已存在（`meeting-subgraph.ts:569-583`）
- 需要在 ChatPanel 订阅此事件，在 summary 消息下方渲染 action items
- "Delegate" 按钮调用 `sendMessage` 自动填充 "@Designer Design the landing page"

**文件：**
- `packages/ui-office/src/components/chat/ChatPanel.tsx` — 订阅 meeting.action.created
- 新增 `packages/ui-office/src/components/chat/MeetingActionItems.tsx` — 渲染组件

**决策（2026-04-12 锁定）：** 方案 C — 逐条 Delegate 按钮，不自动全部派发。

**验证：** 开会后 summary 下方出现 action items，点 Delegate 自动发消息

---

## Tier 2: 安全阀 + 引导线

### T2-1: Dismiss Button
**问题：** 装了有问题的员工包无法卸载  
**方案：** InstalledList 每行加 "Dismiss" 按钮（confirm → `enabled=false` 软删除）

**决策（2026-04-12 锁定）：** 叫 "Dismiss"（解雇），不叫 "Uninstall"。用 `enabled=false` 软删——员工不出现在场景但记忆保留，重新 enable 可恢复。`meeting-subgraph` 已用 `employees.filter(e => e.enabled)` 过滤，零架构成本。

**实现：**
- `InstalledList.tsx` 按钮行加 Dismiss
- 调用 `repos.employees.update(employeeId, { enabled: 0 })` + `repos.installedPackages.update(id, { install_state: 'dismissed' })`
- confirm dialog: "Dismiss this employee? They won't appear in the office but their memories are preserved."

**文件：**
- `packages/ui-office/src/components/marketplace/InstalledList.tsx`
- 可能需要 `packages/install-core/src/` 新增 uninstall 方法

**验证：** 安装员工后在 Installed tab 点 Dismiss，员工从场景消失；重新 enable 后恢复（含记忆）

### T2-2: Studio Escape Dirty Check
**问题：** `StudioPage.tsx:392` — Escape 链条末尾不检查 dirty，直接退出丢数据  
**修复：** Escape 链条最后一步（无其他 focused 元素时）检查 `dirty`，弹 confirm

**文件：** `packages/ui-office/src/components/studio/StudioPage.tsx`  
**验证：** Studio 编辑后连按 Escape 到最后一层，弹出"Discard unsaved changes?"

### T2-3: First-Run Guidance Toasts
**问题：** 4 个循环但只有 1 个入口，SOP/Meeting/Memory/Market 不可发现  
**方案：** 基于事件的轻量引导 toast（非 tutorial，一次性，dismissible）

| 触发事件 | Toast 内容 | 引导到 |
|----------|-----------|--------|
| 第一次 delegate 完成 | "Repeating this task? Create a SOP to automate it" | SOP workspace |
| 第一条员工记忆生成 | "Alex learned something new — check Memories in their profile" | Employee inspector |
| 第 3 次发消息 | "Organize related work into a Project" | ProjectSelector |
| 首次进入 | "Browse the Market to hire specialized employees" | Market workspace |

**实现：**
- `localStorage` 存 `guidance_dismissed_${key}` 标志
- 订阅 EventBus 事件触发
- 用现有 `useNotifications()` + action button

**文件：**
- 新增 `packages/ui-office/src/hooks/useFirstRunGuidance.ts`
- `packages/ui-office/src/components/office/OfficeWorkspaceShell.tsx` — 挂载 hook

**决策（2026-04-12 锁定）：** 事件驱动引导，非线性。5 分钟限流，一次性 dismiss，5 秒自动消失。如果用户已自行访问过目标 workspace 则不触发。

**验证：** 新公司首次完成任务后看到 SOP 引导 toast

---

## Tier 3: 循环闭合 + Polish

### T3-1: HR 回复引导
**修复：** HR_SYSTEM_PROMPT 末尾加指引：当建议招人时，回复须包含 "To create this role, click + or say 'create a [role]'"  
**文件：** `packages/core/src/agents/hr-node.ts`

### T3-2: Meeting 单人警告
**修复：** `meetingStartNode` 在 participants.length === 1 时发 warning 事件，UI toast "Only 1 participant — consider inviting more"  
**文件：** `packages/core/src/graph/meeting-subgraph.ts`

### T3-3: Memory Pruning
**修复：** `MemoryService.createMemory()` 中加上限检查：超过 `maxFacts` 时删除 importance 最低的记忆  
**文件：** `packages/core/src/services/memory-service.ts`

### T3-4: @mention 无匹配反馈
**修复：** `extractMentionHints` 返回空时，ChatPanel 显示 inline warning "No employee matches '@xxx'"  
**文件：** `packages/ui-office/src/components/chat/ChatPanel.tsx`

---

## 不做（明确排除）

| 项 | 原因 |
|---|---|
| API key test connection | 各 provider 验证 endpoint 不统一，ROI 低 |
| LLM 500 降级方案 | 需要 fallback model 策略，超出 UX spec 范围 |
| 会议中 LLM 失败恢复 | 需要 checkpoint-based transcript 恢复，架构变更 |
| Install 超时 | 物化是本地 DB 操作，实际不会超时 |
| SOP debounce | 即时保存是 feature，并发 update 在 memory repo 下无真实 race |
| prefab 批量保存 | 性能优化，非 UX 阻塞 |

---

## 实施顺序

```
Session 1: T0-1 → T0-2 → T0-3 → T0-4          (CRITICAL fixes, ~30min)
Session 2: T1-1 → T1-2                          (Memories + Route labels, ~45min)
Session 3: T1-3 → T2-1                          (Action items + Uninstall, ~45min)
Session 4: T2-2 → T2-3                          (Dirty check + Guidance, ~30min)
Session 5: T3-1 → T3-2 → T3-3 → T3-4           (Polish, ~20min)
```

每个 session 结束后跑 `pnpm typecheck && pnpm test` 全量验证。

---

## Acceptance Criteria

- [ ] 4 CRITICAL 全修，双击/卡死/丢数据场景消除
- [ ] Employee Inspector 有 Memories 展示
- [ ] PipelineProgress 显示路由决策类型
- [ ] Meeting summary 后有 action items + Delegate 按钮
- [ ] InstalledList 有 Uninstall 按钮
- [ ] Studio Escape 检查 dirty
- [ ] 4 条 first-run guidance toast 工作
- [ ] 全量 typecheck + test 绿
- [ ] 浏览器 smoke test 通过（每个 Tier 完成后）
