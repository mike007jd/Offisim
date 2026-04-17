## Context

`deliverable-persistence` capability（H1 + H1-followup 闭环）已把 deliverable 从事件流喂到三条持久化路径（SQLite / IDB / memory repo）并暴露统一的 `useDeliverables()` hook。展示层存在三条独立演进路径：

- `DeliverableArtifactCard.tsx`（chat bubble，lite）— `fix-deliverable-artifact-handoff` 引入，对应 spec `deliverable-artifact-handoff`
- `KanbanBoard.tsx:201-234` Deliverables 列 — 随 TaskDashboard 早期演进塞进来的次要产出展示，无 action
- `PitchHall.tsx` `DeliverableCard`（full）— PRD v1.6 Pitch Hall export 的主展示，带 doc-engine 6 格式导出 + SOP conversion + Tauri local save

三者字段、样式、action 各自实现；同时 Tasks tab 的 Deliverables section 被压在 RightSidebar.tsx:138-145 最底（scroll 到底才能看到），视觉上"产出成就"隐身。

本 change 是 H 拆分的 H2，吃 H1 + H1-followup 的 repo/hook 产出做展示层收敛。场景化包裹交付（员工 pathfind 到老板桌放 parcel）是独立产品形态，属 H3 `scene-deliverable-delivery`，不在本 change。

**约束：**
- `useDeliverables` hook 合约不破坏（订阅 + dedup + `listRecentDeliverables` 调用）
- PitchHall 导出路径（doc-engine `exportDocument` / Save as SOP / Tauri local save）byte-identical
- `deliverable-artifact-handoff` capability 契约（chat bubble 卡片 action = Copy / Open / Download）延续，只换实现来源
- Kanban 删列是本 change 唯一 BREAKING 点；其余 modifier 都是替换实现不换产物
- `AppLayout` 9 slot 和 Workspace IA 不动（Tasks tab 是 RightSidebar 内部 tab，和 top-level Workspace 正交）

## Goals / Non-Goals

**Goals:**
- 三表面统一 visual grammar：同一条 deliverable 在 chat bubble / Outputs 子 tab 看见的字段密度和 filetype icon 字节对齐
- 文件态标准化：filetype icon (lucide by mimeType) + byte size (formatBytes) + createdAt (timeAgo) + contributor avatar stack
- Tasks tab IA 升级：Deliverables 从底部 section 升格为子 tab `Outputs`（横排 pill 和 Activity / Plan 并列），首屏可切
- 职责边界清晰：Kanban 只讲 plan step，不讲 deliverables；PitchHall（Outputs）只讲产出，不讲 step

**Non-Goals:**
- 场景化包裹 / 员工交付动画（H3）
- PitchHall 导出管道改造（doc-engine / SOP conversion 不动）
- `useDeliverables` hook 语义变更（只补 `contentSize` 字段）
- Workspace 级 IA（Office/SOPs/Market/Activity Log/Settings peer-level 不动）
- Tasks tab 外部（Chat tab）的任何改动
- 成就感 celebration 效果（toast / confetti — 后续 feedback 层 change 再做）
- Deliverable starred / milestone 分级（H 之后独立 change）
- 员工视角"我这个月产出了什么"反查（`EmployeeInspector` 改造 — 另起 change）

## Decisions

### D1: 共享 primitive 的落盘位置 —— 新建 `components/deliverable/` 目录 vs 复用现 `components/pitch/`

**选择：** 新建 `packages/ui-office/src/components/deliverable/DeliverableCard.tsx` 单文件 primitive。

**理由：**
- `components/pitch/` 语义是 "Pitch Hall" 专属 —— 把跨消费端 primitive 放在里面语义倒置
- chat bubble / Kanban / Outputs 子 tab 三个消费端无共同父目录，放一个新的 neutral 位置（`components/deliverable/`）是 Barrel 风格的自然位置
- 未来 H3 场景 parcel 渲染也消费同一卡片（作为 tooltip / popover 弹出 full detail），此目录是长期归宿
- 80-200 NBNC 单文件目标，不拆多子模块

**备选：** 放 `lib/` 下作 hook + render 混合。放弃 — `lib/` 约定无 JSX，保持边界。

### D2: Variant 策略 —— 单组件 prop 分叉 vs 两个组件

**选择：** 单组件 `DeliverableCard`，`variant: 'compact' | 'full'` prop 分叉 actions slot 和 metadata 密度；共享 header（filetype icon + title + size + timeAgo + contributors avatar stack）。

**理由：**
- 两 variant 的 header / metadata 完全一致，只是 action 列差异；一个组件避免命名分裂（`DeliverableCompactCard` vs `DeliverableFullCard`）
- actions slot 以 `compact` 和 `full` 内嵌分支实现（而不是 render prop / children 外注入）—— spec scenario 能锚到 variant 枚举清楚断言 "variant=compact 必有 Copy / Open (conditional) / Download 3 按钮"
- Tauri-only action（Save locally / Open folder）只在 `full` 分支判 `isTauri()`，和今天 PitchHall 逻辑等价
- 未来加 `variant='medium'`（例如 Kanban 未来复活但不是 deliverable column 的情况）能无痛扩

**备选：** `actions` 作 children prop 外注入。放弃 — spec scenario 无法锚"chat bubble 必有 Download 按钮"；且三表面 action 组合是有限集（3 枚 + 7 枚），枚举 variant 比 children 注入更清晰。

### D3: 文件态 icon 映射 —— 共享 `mimeTypeToIcon` vs 每表面 switch

**选择：** `packages/ui-office/src/lib/deliverable-presentation.ts` 导出 `mimeTypeToIcon(mime: string | null): LucideIcon`，switch 覆盖 HTML / JS / TS / TSX / JSX / JSON / MD / CSS / CSV / YAML / XML / image/* / plain / null → `FileCode / FileJson / FileText / FileImage / FileSpreadsheet / File`。

**理由：**
- 现状无任何 mimeType→icon 映射存在（搜遍 `grep -rn 'mimeTypeToIcon\|mimeToIcon'` 零命中）
- `deliverable-artifacts.ts` 有 `defaultFileNameForMime` / `mimeFromExtension`（mime ↔ ext），但没 icon；复用目录保持 lib 纯粹（无 JSX/React dep），icon 映射返回 `LucideIcon` component reference 不进 `deliverable-artifacts`（它是 types + string utilities）
- lucide-react 已是 `ui-core` 依赖；映射返回组件，消费端 JSX 里直接 `<Icon className=".." />`
- `mimeTypeToIcon(null) → File`（generic 文件图标），和 `kind='document'` 场景一致

**备选：** 把映射放 `deliverable-artifacts.ts`。放弃 — `lib/deliverable-artifacts.ts` 是 byte-level / string 工具，不宜拉 React/JSX 依赖。

### D4: Tasks tab 子 tab 实现 —— 嵌套 Tabs component vs 内联 useState

**选择：** 内联 `useState<'activity' | 'plan' | 'outputs'>` + 简单 TabsList/TabsContent（复用 `@offisim/ui-core` Tabs primitive）— 同文件 `RightSidebar.tsx` TasksContent 内部。

**理由：**
- Tasks tab 的 chat/tasks 顶级已用 Tabs primitive，再嵌一层等价，不引额外 primitive
- 三子 tab 固定、无 dynamic 添加、无持久化（每次 mount 默认 Plan，session 内记忆通过组件 `useState` 持有）
- External Departments section 迁到 **Plan 子 tab 顶部**（作为 context 带给 TaskDashboard），不独立子 tab
- RightSidebar Tasks tab body 仍然包一层 `overflow-y-auto`，但子 tab 切换时 scroll position 允许重置（默认行为）

**备选：** 把子 tab 抽独立 `TasksTabSubtabs.tsx` 文件。放弃 —— 单 ~60 行 JSX，抽出去反而分散上下文；`RightSidebar.tsx` 当前 152 行，扩到 ~200 仍在 gate 内。

### D5: `Deliverable.contentSize` 字段来源 —— hook 填 vs repo 带

**选择：** `useDeliverables` 返回的 `Deliverable` 接口加 `contentSize: number`，hook 内 `artifact.content.length`（UTF-16 code units）计算填入；repo row 虽有 `content_size: number`（UTF-8 bytes）但不同计量单位。

**理由：**
- UI 层的 "120 KB / 5 MB" 展示对"精确 UTF-8 字节数 vs JS string length"两者差异玩家不敏感（~几字节差异）
- 避免 hook 依赖具体 repo 后端提供字段（memory vs drizzle vs tauri），`artifact.content.length` 是 hook 自带的稳定源
- 未来如果要精确字节，`byteLength(artifact.content)` 可替换实现，不破坏签名
- `formatDeliverableBytes` 单位用 "B / KB / MB"（1024 进制），对齐典型 OS 文件管理器

**备选：** 复用 `byteLength` from `@offisim/core/browser` utility（准确 UTF-8）。放弃 —— 引 core util 进 UI 模块是 over-kill；本 scope 下 length-approximation 足够。

### D6: Kanban 删 Deliverables 列 —— 保 read-only 剪完列 vs 提供替代

**选择：** 物理删除（`KanbanBoard.tsx:201-234`），不提供 Kanban 内替代视图。`useDeliverables` import 和 `deliverables` 变量同 commit 清掉。

**理由：**
- Kanban 的产品语义是 "plan step 进度看板"（dashboard.steps 映射），Deliverables 是单独维度产物，不应该占一列的物理空间
- 消费点只有 `KanbanOverlay`（单点引用），删除不扩散
- Outputs 子 tab 在同 RightSidebar 里 1-click 可切，delivering 信息 0 丢失
- 删除而非 "feature-flag 隐藏" —— H2 是 UI 清理目的，不保留路径
- Kanban 现"Deliverables"列现状 0 action（只是预览），玩家从未用它触发过 Copy/Download/Export，损失的仅是"看见"效果，Outputs 子 tab 完全接住

**备选：** 保留但改成 action-bar（加 Copy/Open/Download）。放弃 —— Kanban 列宽 260px 塞不下 full actions；且 Outputs 子 tab 是 full variant 的主阵地，Kanban 塞 medium variant 是冗余。

### D7: Chat bubble `DeliverableArtifactCard.tsx` —— 保 wrapper vs 物理删除

**选择：** 物理删除 `DeliverableArtifactCard.tsx`，消费点（预计 `ChatPanel` / `MessageBubble`）改 import `DeliverableCard` + `variant='compact'`。

**理由：**
- Wrapper 徒增一层无收益（variant prop 已覆盖语义）
- Repo policy 不保留 deprecation wrapper，删除是干净做法
- `deliverable-artifact-handoff` spec 的 scenarios（Copy 按钮存在 / Open 条件 / Download 存在）在新 primitive 的 compact variant 下逐条成立

**备选：** 保 wrapper 作 backward compat。放弃 —— 本 change 是"整洁优雅"目标，不留 legacy 路径。

## Risks / Trade-offs

**[R1] Tasks tab 子 tab 层级增加玩家首次迷失**
→ 从"scroll 到底看 Deliverables"改为"点 Outputs 子 tab"。mental model 变了。
→ Mitigation：Plan 作为默认子 tab 保持 70% 老玩家 familiarity（Tasks tab 主要用途就是看进度）；"Outputs" 子 tab 加 badge count（新 deliverable 数）视觉提示。真正用过的玩家点一次就知道在哪。如果子 tab 无 count 指示，未来 H 迭代加未读 unseen count。

**[R2] shared primitive 未覆盖 PitchHall 所有 action（Save locally / Open folder 是 Tauri-only）**
→ 如果 Tauri 判断失败或 primitive 分支遗漏，导致 desktop 功能回归。
→ Mitigation：`isTauri()` 判断和 `desktopVaultRoot` prop 透传保留；primitive full variant 里 action row 对 Tauri-only 三件做 conditional render（今天 PitchHall 已有此逻辑，迁入 primitive byte-identical）。Live verify 在 web + Tauri 各跑一遍。

**[R3] `artifact.content.length` UTF-16 vs repo `content_size` UTF-8 的数字差**
→ 一条 CJK 内容的 deliverable，UI 显示 "3.2 KB" 但磁盘真实 "6 KB"。玩家不会注意但严格来说不精确。
→ Mitigation：可接受。UI 单位上下文（"300 KB" vs "600 KB"）不改变玩家判断；真要精确可 Follow-up 用 `byteLength` util。

**[R4] Kanban 删列后玩家打开 Kanban 找不到 Deliverables**
→ 某些玩家可能习惯在 KanbanOverlay 看 deliverables。
→ Mitigation：KanbanOverlay 顶栏加 "Open Outputs →" 快捷入口跳子 tab（小成本加 ~4 行）；或 README/onboarding 里讲"Deliverables live in the Outputs sub-tab"（暂不做，等用户反馈）。本 change 先不加快捷按钮，如 live verify 发现 friction 再补。

**[R5] filetype icon mapping 对未知 mimeType 降级行为**
→ mimeType='application/x-custom' 未枚举到，返回 `File` 通用 icon。
→ Mitigation：`mimeTypeToIcon(null) → File` 是默认降级。未知也走 default。spec scenario 覆盖 "unknown mime → generic `File` icon"。

**[R6] contributor avatar stack 超过 N 个员工**
→ 5+ 员工 avatar 水平堆叠会挤占宽度。
→ Mitigation：stack 上限 3 个，第 4+ 折叠成 `+N` badge，对齐典型 UI 约定（Figma / Slack）。

## Migration Plan

1. **Primitive + helpers 先落**：`components/deliverable/DeliverableCard.tsx` + `lib/deliverable-presentation.ts`；独立可 typecheck，不改消费者
2. **Chat bubble 切过去**：消费点改 import shared primitive，删 `DeliverableArtifactCard.tsx`；web live verify chat 气泡 3 action 全通
3. **PitchHall 内部 Card 替换**：`PitchHall.tsx` 的 `DeliverableCard` 函数体替换成 shared primitive 调用，timeAgo helper 抽去 `lib/deliverable-presentation.ts`
4. **Kanban 删列**：`KanbanBoard.tsx:201-234` 删除 + `useDeliverables` import 清
5. **RightSidebar Tasks tab 子 tab 改造**：`TabsContent[value='tasks']` 内部 `useState<'activity' | 'plan' | 'outputs'>` + 内嵌 Tabs；Plan 默认
6. **Hook 补字段**：`useDeliverables.ts` `Deliverable` 接口 + `contentSize`
7. **Spec 同步**：NEW `deliverable-card-presentation/spec.md`；MODIFY `deliverable-artifact-handoff/spec.md` 改 chat bubble scenario 引 shared primitive
8. **Live verify**（Chrome DevTools MCP @ 5176）：
   - a. 生成一条 file deliverable（html）→ chat 气泡显示 compact card（filetype icon / 3 action / contributor avatar）
   - b. Tasks tab → Outputs 子 tab 显示 full card（所有 action / export dropdown / Save as SOP）
   - c. Kanban 看不到 Deliverables 列
   - d. Mobile / narrow tier 下子 tab pill 不炸
9. **typecheck + serial build 5 包** → archive

**回滚策略：**
- Primitive + helpers 是新文件，revert 删除即回滚
- Chat bubble 消费切换是单点修改（消费点 import），revert 3 行
- Kanban 删列 revert 恢复 33 行
- RightSidebar sub-tab 整块 revert 即回 Deliverables section
- Spec delta 随 archive 回滚

## Open Questions

- **OQ1**：Outputs 子 tab 需要 count badge（未读 deliverable 数）吗？本 change 先不做，等 H3 feedback 层集成时一并加（因为"未读"状态机是 H3 物品实体化的一部分）
- **OQ2**：KanbanOverlay 需要快捷 "Open Outputs" 按钮吗？先 ship 看 live verify 反馈，不提前造
- **OQ3**：contributor avatar 点击行为 —— 跳员工档案 or 只是 tooltip？本 change 保持 tooltip only（对齐 PitchHall 现状），点击跳跳转是独立 navigation 语义留后做
