## Why

Offisim 的交付物当前是"假交付"——用户让员工写一个 HTML 游戏 / 生成一份文档，最终答复被当成 chat 文本回来，**没有可下载、可双击打开的真 artifact**。memory 里 2026-04-14 (late) live audit 记录："Snake HTML 任务已确认：文件产物当成 chat text，不是真 artifact 面"。

基础设施分散但不完整：
- `packages/core/src/agents/employee-deliverables.ts`（106 行）+ `infer-deliverable-file.ts`（162 行）——core 侧已经在 materialize file deliverables
- `packages/shared-types/src/events.ts` 已定义 `DeliverableCreatedPayload`
- `packages/ui-office/src/lib/deliverable-artifacts.ts`（247 行）+ `useDeliverables.ts`（60 行）——UI 侧有 artifact 抽象
- `packages/ui-office/src/components/pitch/PitchHall.tsx`（457 行）——历史 "pitch hall" 展示页

但 live 用户视角里 artifact 的**交付时刻**仍不 surface：
- 做完一个 HTML 生成任务，chat 里看到的是代码块形式的文本，没有"Download" / "Open" 按钮
- 做完一份 Markdown 报告，没有 file artifact 卡片说"这是一个 .md 文件"
- PitchHall 存在但不是所有 deliverable 都流到那里

这个 change 要把 "employee 生成的 file 类产物" 的端到端 handoff 做出来：core 标注 → event 带足信息 → UI 在 chat 附近渲染可 open/download 的 artifact 卡 → （可选）落盘到 vault。

⚠️ **本 change 在 propose 阶段没有做 live 复现 pre-work**（用户要求先把 A/B/D 都落 proposal；B 的 live 复现并入 tasks.md Task 1）。因此 proposal 的根因是基于代码 audit + memory 既有 live 证据，而非本轮采样。**这是承认的质量弱点**，在 design 里会显式标注、tasks 第一步强制先跑 live。

## What Changes

- 确认当前 chat 里 employee 生成文件类产物时，从 `deliverable.created` 事件到用户可见 UI 的实际链路（任务 1 live 采样）
- 让 chat 气泡 / task panel 在 `deliverable.created` 事件到来时，显式渲染一个 artifact 卡（含 `fileName` / `mimeType` / Open / Download / Copy 操作）
- artifact 卡与 chat 文本气泡**视觉分离**——不是把 HTML 源码当作文本贴出
- 单文件 artifact（HTML / MD / CSV / JSON 等）在浏览器里：Open 打开新 tab 渲染、Download 触发浏览器下载
- 保持已有的 PitchHall 入口可用（若它本来就被某些路径用到），不回归
- 修改范围：
  - `packages/ui-office/src/components/chat/`（ChatPanel / MessageBubble 的 artifact slot）
  - `packages/ui-office/src/lib/deliverable-artifacts.ts`（可能扩）
  - `packages/ui-office/src/hooks/useDeliverables.ts`（可能扩）
  - 必要时 `packages/core/src/agents/employee-deliverables.ts` 的 event payload 补字段
- **不触**：provider 层、scene 层、SOP 路径、deliverable-artifacts 里已用于 PitchHall 的展示路径（扩而不改）

## Capabilities

### New Capabilities
- `deliverable-artifact-handoff`: 员工 file 类产物从 core 生成 → event 发出 → chat UI 渲染 artifact 卡 → 用户 Open/Download 可操作的端到端契约

### Modified Capabilities
(无 — 不改任何已有 canonical spec)

## Impact

- `packages/ui-office/src/components/chat/MessageBubble.tsx`（171 行）— 可能加 artifact slot 条件渲染
- `packages/ui-office/src/components/chat/ChatPanel.tsx`（568 行）— 消费 `deliverableCreated` 事件的挂接点
- `packages/ui-office/src/lib/deliverable-artifacts.ts`（247 行）— artifact builder 可能扩 mime-aware preview / download helper
- `packages/ui-office/src/hooks/useDeliverables.ts`（60 行）— event 订阅
- `packages/core/src/agents/employee-deliverables.ts`（106 行）— 仅在 Task 1 确认 payload 少字段时扩（优先不改）
- `packages/core/src/agents/infer-deliverable-file.ts`（162 行）— 只读不改
- 验证：live Playwright 发一个明确 file 类任务（"Write a single-file HTML Snake game"），观察 chat 里是否出现 artifact 卡、点 Download 是否落盘、点 Open 是否新 tab 渲染
- 参考 working note：memory 里 2026-04-14 (late) 的 live 观察笔记（无专属 spec 文件）
