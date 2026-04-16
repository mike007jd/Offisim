## Context

**已有基础设施**（commit `f472060` 当时状态）：

- **Core 侧**：
  - `packages/core/src/agents/employee-deliverables.ts`（106 行）：`materializeFileDeliverableIfNeeded()` —— 从 LLM response 抽取 file content + fileName + mimeType
  - `packages/core/src/agents/infer-deliverable-file.ts`（162 行）：启发式推断任务是否要出 file 类产物 + 推 fileName 和 mime
  - `packages/core/src/agents/employee-node.ts` line 738-751 + 861-887：employee 节点调 `materializeFileDeliverableIfNeeded` 并 emit `deliverableCreated` 事件（带 `fileName` / `mimeType` / `artifactContent`）
  - `packages/shared-types/src/events.ts`：`DeliverableCreatedPayload` 已定义
- **UI 侧**：
  - `packages/ui-office/src/lib/deliverable-artifacts.ts`（247 行）：helper，负责把 artifact 内容转成可展示/下载
  - `packages/ui-office/src/hooks/useDeliverables.ts`（60 行）：React hook 订阅 deliverable 事件
  - `packages/ui-office/src/components/pitch/PitchHall.tsx`（457 行）：历史 pitch 展示页，接入 deliverable 流（但不是主要聊天路径）
  - `packages/ui-office/src/components/chat/` 各组件：**是否已消费 deliverableCreated 未知**，需要 Task 1 用 grep + live 采样确认

**Live 证据缺口**：

本 change propose 时没做 live pre-work（用户节奏要求先落 A/B/D proposal）。memory 里 2026-04-14 (late) 的 live 观察："Snake HTML 任务已确认：文件产物当成 chat text，不是真 artifact 面" 是旧证据。**Task 1 强制重跑一次，确认当前 main 上的行为仍是这样**。

**候选根因（待裁决）**：

1. **RC-1 Chat UI 根本不订阅 `deliverable.created`**，只订阅 chat message 事件；artifact event 流到 PitchHall / useDeliverables hook 但 hook 没被 ChatPanel 消费
2. **RC-2 Chat UI 订阅了，但没有 artifact 卡组件**——只能把 content 当 text 渲染
3. **RC-3 Event 被订阅且有卡组件，但 materializeFileDeliverableIfNeeded 的启发式没触发**，deliverable event 根本没 emit（LLM 返回的 response 没被识别为 file）
4. **RC-4 Event emit 了，UI 渲染了，但内容被当成 chat text message 插入而不是 artifact 卡**（MessageBubble 把 artifact field fallthrough 到 text slot）

## Goals / Non-Goals

**Goals:**

- 用户在 chat 发一个 "write a single-file HTML Snake game" 类任务后，最终收到：
  - 一条简短的 chat 完成消息（"I've prepared the game as a file."）
  - 一张 artifact 卡：文件名（`snake.html`）+ 类型（`text/html`）+ Open / Download / Copy 三按钮
  - 点 Open 在新 tab 渲染 HTML
  - 点 Download 浏览器落盘
  - 点 Copy 把 file 内容复制到剪贴板
- MD / CSV / JSON 等常见 mime 至少支持 Download + Copy（Open 对 HTML 做；其他格式 best-effort 或不显示 Open）
- artifact 卡**不是**把 HTML 源码贴到 chat 文本里（否则视觉塌）
- direct chat 和 team chat 一致行为
- 不回归 PitchHall：如果 PitchHall 当前还在被使用（比如 "process log" 里聚合 deliverable），继续工作

**Non-Goals:**

- 不改 core 的 `infer-deliverable-file.ts` 启发式（除非 Task 1 RC-3 确认这里是根因）
- 不做 multi-file artifact（本 change 只处理单文件）
- 不做 vault 自动落盘（desktop vault 是另一面，本 change 止于浏览器下载）
- 不做 share link / collaboration artifact（远期）
- 不改 provider adapter / LLM 响应 schema
- 不与 A（chat streaming UX）范围重叠：A 管文字流入气泡，B 管文件类产物的 artifact 卡

## Decisions

### D1: Task 1 强制先 live 裁决 RC，后续修复按分支

**选择**：Tasks.md 第 1 组是完整 live 复现 + DOM 采样 + event 采样，之后才进入具体修改。不预设根因。

**理由**：4 个 RC 要改的位置截然不同：RC-1/2 改 chat UI、RC-3 改 core、RC-4 改 UI bubble 分支。没数据就无法定位。

### D2: 复用既有 `deliverable-artifacts.ts` + `useDeliverables.ts`，不造新 hook

**选择**：这两个 module 已经存在、有测试过的 event 订阅和 artifact 抽象。本 change 扩它们的输出表面（artifact 卡组件 + mime-aware preview），不替换。

**理由**：避免双 hook 订阅同事件、避免引入新抽象。

### D3: artifact 卡是独立组件 `DeliverableArtifactCard.tsx`，嵌入 MessageBubble

**选择**：新建 `packages/ui-office/src/components/chat/DeliverableArtifactCard.tsx`（预计 100-150 行）。接受 `{ fileName, mimeType, content, createdAt }` props。MessageBubble 在消息 payload 带 artifact 字段时渲染此卡 + 简短文本；没有 artifact 时沿用现有 text-only 渲染。

**备选**：把 artifact 直接拼进 MessageBubble。否决：MessageBubble 已 171 行，artifact 视觉明显不同，单独组件边界更清晰。

### D4: Open / Download / Copy 三按钮实现

**选择**：
- **Download**：`Blob` + `URL.createObjectURL` + `<a download>` 点击（标准）
- **Copy**：`navigator.clipboard.writeText(content)`（HTTPS/localhost 可用）
- **Open**：仅 `text/html` 显示。实现用 Blob URL + `window.open(url, '_blank', 'noopener')`；也可用 `data:` URL 做 inline preview。优先 Blob URL（不受 data-url 长度限制）

**理由**：全标准 API，Tauri 端也通吃（Tauri webview 兼容）。

### D5: artifact 与 chat streaming（change A）解耦

**选择**：artifact 卡不在 StreamingBubble 里渲染，只在 **committed** final message（MessageBubble）里渲染。流式阶段气泡显示 "preparing artifact..." 或普通 streaming 文字；deliverable event 到达后，final commit 时 artifact 卡才出现。

**理由**：
- streaming 过程本来文字就在变，artifact 卡若同步显示 partial file 会误导
- deliverable event 一般在 employee 完成后 emit（employee-node line 861-887）——commit 时机对
- 减少与 change A 的耦合

## Risks / Trade-offs

- **[风险] `deliverable.created` event 实际是在 chat 收到 final 消息之后才 emit，顺序不对** → Mitigation：Task 1 采样 event 时序（event bus emit timestamps），若顺序颠倒，MessageBubble 要在 artifact event 到后 **回填**（已 commit 消息补挂 artifact）
- **[风险] 大文件（> 1MB HTML）Blob URL 导致内存驻留** → Mitigation：Download 后 `URL.revokeObjectURL`；Open 后由用户 tab 接管，父页面 5s 后 revoke；文件大小做 soft limit（> 5MB 警告但不阻止）
- **[风险] Copy 的 `navigator.clipboard` 在非 HTTPS 环境失效** → Mitigation：localhost + Tauri 都 OK；记入 Non-Goals 不处理纯 HTTP 生产
- **[风险] 与 PitchHall 重复展示** → Mitigation：Task 1 确认 PitchHall 入口；若 PitchHall 也挂了同 hook，chat artifact 卡仅新增，PitchHall 保留
- **[风险] core 侧 `materializeFileDeliverableIfNeeded` 的 mime 推断不准** → Mitigation：Task 1 live 跑完确认 `deliverableCreated.mimeType` 是不是合理值；若不准，列 follow-up 而不是扩本 change scope

## Open Questions

- **Markdown artifact 的 Open 按钮要不要内联渲染（不打开新 tab）？** → 暂不做，保持 MD 只 Download + Copy；未来再加 inline preview component
- **artifact 卡是否带任务名/员工名作为 title？** → 建议"员工名 → 文件名"格式，Task 阶段确认
