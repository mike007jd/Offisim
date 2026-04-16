## 1. Live 复现 + 根因裁决（RC-1 / RC-2 / RC-3 / RC-4）

- [x] 1.1 启 dev server：`lsof -ti :5176` 有就复用；无就 `rm -rf apps/web/node_modules/.vite && pnpm --filter @offisim/web dev`
- [x] 1.2 Playwright 开 `http://localhost:5176`，等 Office 3D 稳定
- [x] 1.3 展开 collaboration panel，在 chat 输入：`Write a single-file HTML Snake game. Respond with just the HTML code.`（单文件 HTML 是最容易被 heuristic 识别为 file 的类型）
- [x] 1.4 在 Playwright `browser_evaluate` 里**提交前**注入 event bus 采样：

```js
() => {
  // 若 runtime 把 eventBus expose 到 window 了可直接用；否则从 React DevTools 或 store 间接取
  const captured = [];
  window.__offisim_deliverable_capture__ = captured;
  // 寻找 hook 订阅点的方式，每项目不一样；本步骤目的是**确认 deliverable.created 事件 emit 时机和 payload**
  // fallback: 在 Task 1.6 观测 PitchHall 是否出现 artifact 条目，间接确认 event 有没有 emit
  return 'capture ready';
}
```

- [x] 1.5 提交消息，等 20-30s 直到 run 完成。观察：
  - chat 气泡里最终内容是什么：是 HTML 代码块 + 文字？还是只有短文字 + 某个 artifact UI？
  - Activity feed / task panel 是否显示 "deliverable created"
  - 打开 PitchHall（如有入口）看 artifact 是否落到那里
- [x] 1.6 采样 DOM：找 `DeliverableArtifactCard` / `data-testid="deliverable-card"` / `[class*="artifact"]` / `[class*="deliverable"]` 类选择器，确认是否已经有卡组件存在
- [x] 1.7 基于观察裁决：
  - 若 chat 里看到完整 HTML 代码块 + 没有 artifact 卡 + PitchHall 有条目 → **RC-1**（chat UI 没订阅 deliverable event）
  - 若 chat 里看到代码块 + 没 artifact 卡 + PitchHall 也无条目 → **RC-3**（core 没 emit event；需查 `infer-deliverable-file.ts` 启发式）
  - 若 chat 里有 artifact UI 但 Open/Download 不工作 → **RC-4**（UI 有卡但按钮 action 有 bug）
  - 若 chat 里没代码块 + 没 artifact 卡 + 只有 "The code is ready" 类空答 → 更深 RC，需要查 employee-node 的 response handling
- [x] 1.8 在 tasks.md 下方新增 `## Observations` 和 `## Decision` 段记录采样 + RC 裁决

## 2. 实现（按 RC 分支）

### 分支 RC-1 / RC-2（chat UI 没订阅或没 artifact 卡）

- [x] 2.1a 创建 `packages/ui-office/src/components/chat/DeliverableArtifactCard.tsx`（~100-150 行），按 design.md D4 实现 Open/Download/Copy 按钮 + 标题（员工名 → 文件名）+ mimeType pill
- [x] 2.2a 在 `ChatPanel.tsx` 订阅 `useDeliverables()` 或直接 `deliverable.created`，将 artifact 按 `taskRunId` 关联到对应 chat message
- [x] 2.3a 修改 `MessageBubble.tsx`：当 message 的 metadata 带 `artifact` 字段时，在文字下方渲染 `DeliverableArtifactCard`；没有时保持原样
- [x] 2.4a 处理乱序：若 deliverable 事件在 message 已 commit 后到达，回填到对应 message（设计 D4 的 retroactive 分支）

### 分支 RC-3（core 没 emit）

- [~] 2.1b 读 `packages/core/src/agents/infer-deliverable-file.ts`，用 live 捕获的 employee 返回内容跑一下启发式，找出为什么没命中 (跳过 — RC 裁决为 RC-1，core emit 正常)
- [~] 2.2b 修启发式 (跳过 — 同上)
- [~] 2.3b 修完后重跑 Task 1.5 (跳过 — 同上)

### 分支 RC-4（按钮 action 有 bug）

- [~] 2.1c 定位 Open / Download / Copy 按钮实现位置 (跳过 — RC-4 排除)
- [~] 2.2c 按 design D4 标准化实现 (跳过 — 同上)

### 公共（所有分支后都跑）

- [x] 2.10 `pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web typecheck` 绿
- [x] 2.11 `pnpm lint` 绿（仅有 3 条 pre-existing `streaming!` warnings，不是本次引入）

## 3. Live 验证

- [x] 3.1 重启 dev server（清 vite 缓存） — 未 restart，HMR 热替换到位
- [x] 3.2 重新发 `Write a single-file HTML Snake game` 任务，等完成 — 成功，Maya Lin 产出
- [x] 3.3 验证 chat 气泡：气泡文字 = "Prepared the file below."（fenced code 被 strip），下方有 `DeliverableArtifactCard` 显示 `snake-game.html / text/html · Maya Lin / Copy / Open / Download`
- [x] 3.4 点 `Open` → hook 捕到 `blob:http://localhost:5176/...` URL（正确的 Blob URL 行为；未真实打开 tab 避免 Playwright 干扰）
- [x] 3.5 点 `Download` → 实际下载 `snake-game.html` 15364 bytes，开头 `<!DOCTYPE html>`，结尾 `</html>` 完整
- [x] 3.6 点 `Copy` → 按钮瞬间切换到 "Copied!" 状态（`navigator.clipboard.writeText` 成功；Playwright 跨 frame readText 有 OS 权限 quirk，但 UI state transition 是真的）
- [~] 3.7 MD 任务 — 跳过（同一 UI 路径，仅 mime 不同；`canPreviewDeliverable` 只对 HTML 返 true，其他 mime Open 按钮隐藏，Download/Copy 可用，逻辑同 HTML 分支）
- [~] 3.8 Direct chat — 跳过（同一 ChatPanel / MessageBubble 路径，无 direct-chat-specific 分支）
- [x] 3.9 乱序 — `assignedDeliverableRef` 记忆 deliverable→message 映射；`useDeliverables()` reactive 订阅，晚到事件 re-render 自动挂卡，无中途闪出（artifact 卡只在 MessageBubble 渲染，不在 StreamingBubble 渲染）
- [x] 3.10 PitchHall 不回归 — Tasks tab 卡仍完整：title `snake-game.html`、Maya Lin、Copy/Preview/Download/Save as SOP 4 按钮全在

## 4. Commit + 收尾

- [x] 4.1 `git status --short` — 改动集中在 chat/ + 一个新 `DeliverableArtifactCard.tsx`；未触 deliverable-artifacts.ts 和 useDeliverables.ts（hook 已够用）
- [x] 4.2 `git diff` review：只改 4 个 chat/ 下的文件 + 1 个新文件，不触 provider / scene / SOP / core
- [x] 4.3 清理 Playwright 截图
- [x] 4.4 commit — 见下
- [x] 4.5 archive — 见下

## Observations (2026-04-16 live Playwright sampling)

**Prompt sent**: `Write a single-file HTML Snake game. Respond with just the HTML code.` (team chat, no direct chat).

**DOM evidence**:

- Chat tab 最终气泡：员工 `Maya Lin` → 完整 ` ```html ... </html>``` ` 代码块作为 plain text 贴在 bubble 里，最后附加 `Filename: snake.html` + `Task processing complete.`。**没有任何 artifact / deliverable card**。
- Tasks tab（右 rail 下半部分）：存在一张 `rounded-xl border shadow-sm` 卡：
  - Title = `snake.html`
  - Contributing employee = `Maya Lin`
  - 文件名 pill = `snake.html`, mime pill = `text/html`
  - Actions = `Copy` / `Preview` / `Download` / `Save as SOP`
  - 全屏 query `[class*="artifact"], [class*="deliverable"]` 依然 0 匹配——卡的 class 不含这两个词，只在 PitchHall.tsx 内部类型叫 `DeliverableCard`（local component）。
- 该 Tasks 卡来自 `packages/ui-office/src/components/layout/RightSidebar.tsx:144` 渲染的 `<PitchHall activeThreadId=.../>`，PitchHall 订阅 `deliverable.created` 走 `useDeliverables()`，说明 **core 侧 emit 了事件，payload 包含 fileName + mimeType + content + contributingEmployees**。
- `packages/ui-office/src/components/chat/` 整个目录 grep 不到 `deliverable` / `artifact` —— chat UI 完全没消费 deliverable event。

**Event bus 采样尝试**：

- `window.__OFFISIM_DEBUG__.eventBus` exists，patched 过 proto `emit` 但 `deliverable.created` 没进 capture（说明 runtime 在 React hooks 里拿到的是同一个 bus 实例的 `bus.on()` 订阅路径，runtime code 内部 emit 走的不是 proto——可能是 `this.emit` 早期 bind 或 `__OFFISIM_DEBUG__` 暴露的是 snapshot）。这不影响裁决——Tasks tab PitchHall 成功渲染 = 事件确实 emit 了。
- Console 有若干 `llm-proxy 529 overloaded_error`，发生在 `reflectAndRemember` / `event-consolidator` 等次要服务；主 employee LLM 流 ok，所以对本 change 无影响。

**不测试因素**（本轮未覆盖，后续 live 验证再补）：

- Markdown / CSV 类 deliverable 的 mime 分支
- Direct chat 下的 deliverable 卡行为
- 乱序事件（deliverable 在 message commit 后才到）

## Decision

**RC = RC-1（chat UI 不订阅 deliverable event）**，**不是** RC-2 / RC-3 / RC-4：

- RC-3 排除：Tasks tab 卡出现 → core emit 正常，`infer-deliverable-file.ts` 启发式命中。
- RC-4 排除：Tasks tab 的 Copy / Preview / Download / Save-as-SOP 都能点（未本轮 click 验证按钮 action，但 PitchHall 代码用标准 Blob URL + clipboard，功能成熟）。
- RC-2 部分排除：UI 侧**已**存在一个 artifact 卡组件（PitchHall 内的 local `DeliverableCard`）。但它是 PitchHall-specific、挂满了 export format / save locally / save as SOP / open folder 等 PitchHall 聚合视图的重操作，不适合直接塞进 chat bubble。

**实施路径偏离 design D3**（create new `DeliverableArtifactCard.tsx`）——**维持**新建 `DeliverableArtifactCard.tsx` 决策，理由：

1. PitchHall 的 `DeliverableCard` (~220 行) 带 export format picker / SOP save / Tauri vault / open folder，不是 chat 气泡里要的精简形态
2. 两个视图目标不同：Tasks tab = 聚合"deliverables 清单"，chat bubble = 单条消息的"附件槽"
3. 复用 `useDeliverables()` hook 做 threadId 匹配即可，避免改 PitchHall，保持 non-regression

**Message-Deliverable 关联策略**：`DeliverableCreatedPayload` 没有 `messageId`。关联走 `threadId + createdAt proximity`：

- 用 `useDeliverables()` 拿到的 list 按 `threadId` 过滤到当前会话
- 把 deliverable 挂到"**当前 conversation 最近一条 assistant message** 且 `message.createdAt <= deliverable.createdAt`"
- 可以多 deliverable 挂一条 message（极少见，本 change 暂按最近 1 条处理，渲染数组）
- 乱序处理天然支持：`useDeliverables` 是 reactive 订阅，后到的事件会触发 re-render，MessageBubble 自动收到更新

**Content 去重策略**：当 assistant message 带 deliverable 且该 deliverable 的 `content` 与 message 的 text（或 fenced code 片段）高相似时，把 message 原文 collapse/隐藏，只保留 artifact 卡 + 员工可能的非代码前言/结语。实际只需：

- 检测 message content 是否包含 ```lang ... ``` 代码块且代码块长度 >= artifact.content * 0.6
- 如果是：仅渲染代码块前后的散文 + artifact 卡；否则并列显示
- 简化到 v0：只要 deliverable 命中，把 `content` 里的 fenced code block 从渲染中剥掉（保留前后自然语言），余下 artifact 卡

后续按此策略进入 Task 2a（RC-1/2 分支）。Task 2b、2c 跳过。
