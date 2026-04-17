## Why

H1 + H1-followup 把 deliverable 持久化（SQLite + IDB + bulk list API）闭环后，展示层三条副作用暴露：

- **三表面叙事割裂**：chat bubble `DeliverableArtifactCard`（Copy/Open/Download，emerald accent）/ Kanban 里 "Deliverables" 列（纯预览无 action）/ PitchHall `DeliverableCard`（全套 doc-engine 导出 + SOP 保存 + Tauri 本地保存）三处视觉语言、字段密度、交互能力各不相同 — 同一条 deliverable 三种长相三种意思。
- **文件态信息单薄**：没有 filetype icon（mimeType→lucide 的共享映射不存在）、没有 byte size 格式化展示、chat bubble 无 timeAgo、contributor 只写 `employeeLabel` 字符串而不是 avatar。 玩家看到 "snake.html" 不知道是 HTML 还是文档，不知道多大，不知道谁做的。
- **Tasks tab IA 拥挤**：`RightSidebar.tsx:107-146` Tasks tab 内部堆了 4 个 section（External Departments / Activity Rail / TaskDashboard / Deliverables section 包 PitchHall）。Deliverables 被压在最底，首屏看不到；同时 KanbanBoard（步骤 + Deliverables 列混合）又在底部重复一次产出信息。

## What Changes

- **NEW** shared `DeliverableCard` primitive（`packages/ui-office/src/components/deliverable/DeliverableCard.tsx`）— 三表面复用的单一组件，actions slot 按 variant 裁剪：
  - `variant='compact'`（chat bubble）：Copy / Open (if previewable) / Download，小 accent、单行 metadata
  - `variant='full'`（Outputs sub-tab / future Kanban 替代视图）：Copy / Download / Preview / Export (doc-engine 6 格式 dropdown) / Save as SOP / Save locally + Open folder (Tauri)
- **NEW** shared helpers（`packages/ui-office/src/lib/deliverable-presentation.ts`）：
  - `mimeTypeToIcon(mimeType: string | null): LucideIcon` — HTML/JS/TS/JSON/MD/CSS/CSV/YAML/XML/图像/代码 → lucide 映射（FileCode / FileText / FileJson / FileImage 等）
  - `formatDeliverableBytes(bytes: number): string` — `0B / 512B / 1.2KB / 1.8MB` 归一
  - `formatTimeAgo(ts: number): string` — 抽出 PitchHall `timeAgo` 成 SSOT
- **MODIFIED** `packages/ui-office/src/hooks/useDeliverables.ts` `Deliverable` 接口加 `contentSize: number` 字段（从 `artifact.content.length` 或 hook row 带上），供 Card 展示免重算
- **MODIFIED** `DicebearAvatar` 复用：每条 deliverable header 的 contributing employees 渲染成小 avatar stack（size=20）+ name tooltip，替换现有的 purple text badge
- **MODIFIED** `RightSidebar.tsx` Tasks tab 内部 IA 改造：
  - Tasks tab 之下新加**子 tab** `Activity | Plan | Outputs`（横排 pill 样式，对齐现有 Tabs primitive）
  - Activity 子 tab = 现 `ActivityRail variant="full"` 内容
  - Plan 子 tab = 现 `TaskDashboard`（保留 External Departments section 作为 Plan 子 tab 顶部 context）
  - Outputs 子 tab = shared `DeliverableCard` 列表（full variant），取代 Deliverables section 里的 PitchHall
- **MODIFIED** `packages/ui-office/src/components/pitch/PitchHall.tsx` — 内部 `DeliverableCard` 换成 shared primitive（full variant），文件壳保留（title/empty state/filter activeThreadId 逻辑继续）；doc-engine 导出 / Save as SOP / Tauri local save 路径 byte-identical 迁进 shared card 的 actions
- **MODIFIED** `packages/ui-office/src/components/chat/DeliverableArtifactCard.tsx` — 整 componet 实际被 shared primitive 取代，剩一个薄 wrapper 消费 artifact 并用 `variant='compact'`；或直接删除文件在消费点（ChatPanel / MessageBubble）改引 shared primitive
- **BREAKING** Kanban `Deliverables` column 删除（`KanbanBoard.tsx:201-234`）— 职责归 Outputs 子 tab，看板只留 plan step 列，解决"同屏同条 deliverable 出现两次"的认知重复
- **不动**：PitchHall `activeThreadId` 过滤合约；doc-engine `exportDocument` 调用；`useDeliverables` hook 订阅 + dedup；`deliverable.created` event 形状；持久化层（SQLite + IDB + bulk API）
- **不在 scope**：场景化包裹交付（员工走到老板桌放 parcel 的仪式感）留给后续独立 change H3 `scene-deliverable-delivery`

## Capabilities

### New Capabilities
- `deliverable-card-presentation`: 统一 deliverable 卡片展示的 contract — shared primitive 结构、variant 策略（compact / full）、文件态标准化（icon / size / timeAgo / contributor avatar）、Tasks tab 子 tab IA（Activity | Plan | Outputs）、Kanban 职责边界（plan step only，无 deliverables column）

### Modified Capabilities
- `deliverable-artifact-handoff`: chat bubble 的 artifact card 现 scenario 描述 emerald accent + 三个独立 handcrafted button；改为 "chat bubble MUST render via shared `DeliverableCard` primitive with `variant='compact'`"，actions 合约不变但实现来源统一

## Impact

**代码：**
- NEW `packages/ui-office/src/components/deliverable/DeliverableCard.tsx` — shared primitive（~200 NBNC）
- NEW `packages/ui-office/src/lib/deliverable-presentation.ts` — `mimeTypeToIcon` / `formatDeliverableBytes` / `formatTimeAgo`（~80 NBNC）
- NEW `packages/ui-office/src/components/layout/TasksTabSubtabs.tsx` 或把子 tab 内联进 `RightSidebar.tsx` Tasks `TabsContent`（取决于 review，两种都 ≤ 200 gate 范围）
- MODIFY `packages/ui-office/src/components/chat/DeliverableArtifactCard.tsx` — 收缩成 wrapper 或删除（调用点改 import shared primitive）
- MODIFY `packages/ui-office/src/components/pitch/PitchHall.tsx` — 内部 `DeliverableCard` 删，替换成 shared primitive import；timeAgo helper 从文件内抽出到 `lib/deliverable-presentation.ts`
- MODIFY `packages/ui-office/src/components/kanban/KanbanBoard.tsx` — 删除 Deliverables column 块（行 201-234）+ 清掉 `useDeliverables` import 和 `deliverables` 变量
- MODIFY `packages/ui-office/src/components/layout/RightSidebar.tsx` — Tasks tab `TabsContent` 重写为内部 sub-tabs（`useState<'activity' | 'plan' | 'outputs'>`）
- MODIFY `packages/ui-office/src/hooks/useDeliverables.ts` — `Deliverable` 接口加 `contentSize: number`，hydrate 时 `artifact.content.length` 填充

**不影响：**
- Persistence: SQLite 表 / IDB `deliverable_content` store / 三后端 repo / `DeliverablePersistenceService` 全部不动
- Hook 订阅 + dedup 语义 / `deliverable.created` event shape
- doc-engine 导出 pipeline / SOP conversion / Tauri vault save
- Office 3D/2D scene 层（H3 才动）

**风险：**
- Kanban 删列是轻度 BREAKING — 但 Kanban 是 TaskDashboard 内部视图，消费点单点（`KanbanOverlay`），且 Deliverables 在 Outputs 子 tab 直接呈现，无价值损失
- 子 tab 加一层导航：Tasks tab → Activity/Plan/Outputs — 玩家从原本"scroll 到底"改为"点一下 Outputs"，首屏可见性显著提升；Plan 作为默认子 tab（当前 Tasks tab 最主要用途）保持 familiarity
- PitchHall "Deliverables" 标题 label 随子 tab 改名成 "Outputs"，spec 叙事要同步（PitchHall 内部仍叫 PitchHall 即可，外围 label 统一 "Outputs"）
