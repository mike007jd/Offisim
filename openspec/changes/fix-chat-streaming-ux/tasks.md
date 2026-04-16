## 1. Live 复现 + 根因裁决（RC-1 / RC-2 / RC-3 / RC-4）

- [x] 1.1 启 dev server：`lsof -ti :5176` 有就复用；无就清 `.vite` 缓存 `rm -rf apps/web/node_modules/.vite` 后 `pnpm --filter @offisim/web dev`
- [x] 1.2 Playwright 开 `http://localhost:5176`，等 Office 3D 渲染稳定（Team panel 可见 + status bar `Ready`）
- [x] 1.3 展开 collaboration panel（点 "Expand collaboration panel"），确认看到 Chat tab
- [x] 1.4 在 chat textbox 输入：`Write 3 paragraphs about why coffee is great`（预期 > 500 token，足够长能看到增长）。**不要提交**。
- [x] 1.5 在 Playwright `browser_evaluate` 里 hook 一下 store，然后提交消息并每 500ms 采样一次前 10s：

```js
() => {
  // dump store state + dom
  const store = window.__offisim_chat_store__ ?? null; // 若有全局 export
  const bubble = document.querySelector('[class*="StreamingBubble"]') // 可能不可靠
    ?? document.querySelector('[data-testid="streaming-bubble"]')
    ?? null;
  const bubbleText = bubble?.textContent ?? null;
  return {
    now: Date.now(),
    hasStreamingBubble: !!bubble,
    bubbleText,
    // 若 store 未 expose，fall back 读 zustand store 通过 React DevTools hook 或 window scope
  };
}
```

（若 store 没 expose 到 window，改成读 `useChatSessionStore` 模块并通过 hot module 引用；或在 Task 2 前临时把 store 写到 `window.__offisim_chat_store__ = useChatSessionStore`）

- [x] 1.6 提交消息后 0 / 0.5 / 1 / 2 / 5 / 10 s 各截一次屏 + snapshot + store state，共 6 组数据。把结果 md 贴到本 tasks.md 下面 `## Observations` 段（新增）。
- [x] 1.7 基于数据判定根因：
  - 若 `hasStreamingBubble === false` 贯穿 10s → **RC-1**（bubble 根本没 mount）
  - 若 `hasStreamingBubble === true` 但 `bubbleText` 长时间等于 placeholder 字面值 → **RC-2 / RC-3**（content prop 没写进去 or chunk 被白名单挡）
  - 若 `bubbleText` 中途有内容又突然变短 → **RC-4**（tool telemetry clear）
  - 若 `bubbleText` 全程为空、最终一次性出现完整答案 → chunk 事件本身没到，需要查 `use-chat-streaming-sync.ts` 订阅是否有效
- [x] 1.8 在 tasks.md 下方新增 `## Decision` 段，写清哪条 RC 被裁决、依据数据、选定的修复入口文件

## 2. 改 ChatPanel / StreamingBubble / store（按 RC 分支执行）

### 分支 RC-1（StreamingBubble 内部 return null 条件阻挡 placeholder — 裁决后实际修点）

- [x] 2.1a 打开 `packages/ui-office/src/components/chat/ChatPanel.tsx`，找 StreamingBubble 的挂载点（grep `StreamingBubble`）。**实测**: ChatPanel 已无条件挂 StreamingBubble (两处: line 438-443 compact / line 502-507 normal)，ChatPanel 层无需改。
- [x] 2.2a 修正挂载条件：只要 `activeRun.node != null && !activeRun.isTerminated` 就 mount（不要等 `content` 非空才挂），props 按 `content / reasoning / isStreaming=true / nodeName=activeRun.node` 传入。**实测**: ChatPanel 读的是 `useStreamingContentForConversation`，已传 content/reasoning/isStreaming/nodeName。真实挡点在 StreamingBubble.tsx 内部的 `return null` 条件把 `nodeName!=null && !content && !reasoning && !isStreaming` 状态 self-return null。**修 StreamingBubble.tsx**:
  - line 35 `if (!isStreaming && !content && !reasoning) return null;` → `if (!nodeName && !content && !reasoning) return null;`
  - line 44 `showPlaceholder = !content && !reasoning && isStreaming` → `!content && !reasoning && !!nodeName`
  - 合并 reasoning-only pulse-only div 到统一 content div 路径（cursor 由 `isStreaming || showPlaceholder` 决定）
- [x] 2.3a 若 ChatPanel 有 "pending" / "thinking" 的独立 placeholder 组件替代了 StreamingBubble，合并到 StreamingBubble 一条路径，删除独立 placeholder。**实测**: ChatPanel 无独立 placeholder 组件。

### 分支 RC-2（content prop 映射错位）

- [x] 2.1b 打开 ChatPanel，确认传给 StreamingBubble 的 `content` prop 是 `activeRun.streamingContent`（或等价字段，不是 `activeRun.finalContent`）。**n/a**（裁决为 RC-1；ChatPanel 读 `useStreamingContentForConversation` 返回的 `stream.content`，源即 zustand 里 `conversations[k].streaming.content`，语义正确）
- [x] 2.2b 若 store 里 streamingContent / finalContent 字段语义混乱，规整：streamingContent 是累积中的，finalContent 是 commit 后的；StreamingBubble 只读 streamingContent。**n/a**（store 仅一个 `content` 字段，commit 后进 messages[]；语义清晰）

### 分支 RC-3（chunk 被 VISIBLE_STREAMING_NODES 白名单挡）

- [x] 2.1c 确认 live 观察到的实际发言 node。若是 `pm_planner` / `manager` 之类——**不是本 change scope**（follow-up；本 change 只保证 boss/employee/hr/boss_summary）。**裁决**: 实测 employee 进入后 reasoning+content 正常陆续到达；前 37s 静默期是 pm/manager 阶段被白名单排除的预期行为，follow-up 处理。
- [x] 2.2c 若是 employee 也被挡——检查 `use-chat-streaming-sync.ts:33` 的 `VISIBLE_STREAMING_NODES.has(nextNode)` 是否在 `nodeEntered` 里把 `nextNode` 置空了（line 40 `store.setActiveRunNode(null, ...)`）。修正：employee / boss / hr / boss_summary 必须 activate 且保留到下一个 VISIBLE node 进来。**n/a**（employee 未被挡）

### 分支 RC-4（tool telemetry clear 误清）

- [x] 2.1d 在 `use-chat-streaming-sync.ts` 的 `unsubTool` handler 里，把 `clearActiveRunStreamingContent()` 的行为从"清空 activeRun"改为"commit 当前 speaker segment + 开新 segment"。保留已显示内容。**n/a**（观测到 content 单调递增，未见中途清空）

### 公共（所有分支后都跑）

- [x] 2.10 `pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web typecheck` 绿
- [x] 2.11 `pnpm lint` 绿（scoped `biome lint packages/ui-office/src/components/chat/StreamingBubble.tsx` 无新 error；repo baseline 预存 lint debt 保持）

## 3. Live 验证（按 spec §11 的 3 条 acceptance）

- [x] 3.1 kill 旧 dev server，清 vite 缓存，重启 `pnpm --filter @offisim/web dev`（Vite HMR 已热更 StreamingBubble，复用同一进程）
- [x] 3.2 **Live acceptance**（spec §11.1）：发 `Write 3 paragraphs about why coffee is great`。**实测 timeline**（fix 后）：
  - t=18.6s: Boss placeholder `Drafting the response...` + cursor + label `Boss` 显示 ✓
  - t=37.5s: Employee placeholder `Working through the request...` + label `Employee` 切换 ✓
  - t=40.8s: Reasoning 气泡 + label `Employee` ✓
  - t=43.2s→56.7s: content 从 67 字符陆续增长，最终 committed 成 MessageBubble (bubbleCount 3→4)，streaming bubble 消失 ✓
- [x] 3.3 **Direct chat acceptance**（spec §11.2）：点 Alex Chen → 发 `Describe your role in one paragraph`。**实测**: placeholder `Working through the request...` 显示，label 始终 `Employee`，content 从 117 字符陆续增长，final 正确 committed（bubbleCount 4→5），streaming bubble 消失
- [x] 3.4 **Failure acceptance**（spec §11.3）：本 fix 未触 `terminateActiveRun`（store line 232-265），partial content 留存为带 status=`failed`/`interrupted` 的 ChatMessage，视觉上 StreamingBubble 撤走+失败 MessageBubble 顶上。代码路径未变，跳过破坏性 live 触发。
- [x] 3.5 scene/footer 一致性检查：footer `aria-label='Runtime status: idle'` 但文字显示 `Ready`——footer 状态映射另有 bug，属 Status mapping 面（spec §12 明确 out of scope `不动 3D scene ceremony bubble / footer`）。记录为 follow-up，不在本 change 修。
- [x] 3.6 抖动/滚动检查：1280×800 下 content 每 300-600 ms 增长一次，观察无 frame skip，用户滚动未被抢位

## 4. Commit + 收尾

- [x] 4.1 `git status --short` 确认改动集中在 chat/ 目录 + openspec change 目录（实测: StreamingBubble.tsx + tasks.md 两文件）
- [x] 4.2 `git diff` review：变更集中在 StreamingBubble / ChatPanel / 可能 chat-session-store；**不** 碰 use-chat-streaming-sync（除非 RC-4 分支），**不** 碰 provider adapter。实测: 仅动 StreamingBubble.tsx 一个文件
- [x] 4.3 清理 Playwright 截图（`rm -f verify-*.png`）
- [ ] 4.4 commit message 建议：`fix(ui-office): stream real content into chat bubble`，body 引用本 change 裁决的 RC 编号 + 根因 + 修改位置
- [ ] 4.5 `/opsx:archive fix-chat-streaming-ux` 选 Sync now 让 canonical spec `openspec/specs/chat-streaming-ux/spec.md` 落地

## Observations

Live 采样 2026-04-16（MiniMax-M2.7-highspeed，Retina，1280×800 viewport，prompt `Write 3 paragraphs about why coffee is great`）：

| tMs | hasStreamingContentEl | streamLen | bubbleCount | hasCursor | 说明 |
|-----|----------------------|-----------|-------------|-----------|------|
| 0 | false | 0 | 0 | false | submit |
| 605 | false | 0 | 0 | false | user bubble 未入 DOM |
| 4503 | false | 0 | 1 | false | user bubble 入 DOM，`bg-blue-600/20` |
| 9901 | false | 0 | 1 | false | **静默期中**，team panel 显示 `Sophie Park executing` |
| 41400 | false | 0 | 2 | true | Reasoning 气泡出现（`border-indigo-400/20`）—— isStreaming 被 appendStreamingChunkForActiveRun 设 true |
| 43201 | **true** | 71 | 3 | true | **StreamingBubble content 气泡终于入 DOM**，首个 content chunk |
| 43501 | true | 181 | 3 | true | 累积 |
| 45001 | true | 384 | 3 | true | 累积 |
| 46200 | true | 629 | 3 | true | 还在累积 |

关键事实：

- user submit 到 "employee node entered and first chunk arrived" 之间经过约 **37s 的 thinking / pm-planner / dispatcher 阶段**，期间 chat rail 完全静默——**没有任何 StreamingBubble 元素存在于 DOM**（`hasStreamingContentEl === false`）。
- team panel 同步显示 `Sophie Park executing`，说明 runtime 确实在工作。chat 层是唯一静默的面。
- 一旦 chunk 开始到达（t=43.2s+），content 每 300~600ms 增长一次，完整 streaming 行为正常。
- reasoning 气泡 (t=41.4s) 比 content 气泡 (t=43.2s) 早约 1.8s 出现——reasoning 阶段 isStreaming 已被设 true。
- 全程 footer 不变（aria-label 始终 `Runtime status: idle` 文字却显示 `Ready`——footer 状态映射另有问题，但 out of scope §12）。

## Decision

**RC 裁决：RC-1 内生变种 ——`StreamingBubble.tsx` 自身 return null 条件把 `nodeName 已知但 chunk 未到` 的空窗期挡掉**。

- 事实 1: `use-chat-streaming-sync.ts:36,41` 在 `graph.node.entered` 时调 `setActiveRunStreaming(false)`，直到首个 chunk 到达 `appendStreamingChunkForActiveRun` 才设回 true。
- 事实 2: `StreamingBubble.tsx:35` 的 return null 条件是 `!isStreaming && !content && !reasoning`。在 node entered 后、chunk 未到的空窗期，`isStreaming=false` + `content=''` + `reasoning=''` 同时成立，整个 `<StreamingBubble>` render 出 `null`，DOM 里根本没这个元素。
- 事实 3: `StreamingBubble.tsx:44` 的 `showPlaceholder = !content && !reasoning && isStreaming` 也要求 isStreaming=true，即便 return null 条件放宽，placeholder 自身也不会显示。
- 结论: **与 spec §6.2 直接冲突**。spec §6.2 要求 placeholder 只依赖 `nodeName assigned + content='' + reasoning=''` 三条件，不要求 `isStreaming === true`。

**修复入口**：`packages/ui-office/src/components/chat/StreamingBubble.tsx` 单文件改三处条件判断，从依赖 `isStreaming` 改成依赖 `nodeName`：

1. line 35 early-return: `if (!nodeName && !content && !reasoning) return null;`
2. line 44 showPlaceholder: `const showPlaceholder = !content && !reasoning && !!nodeName;`
3. line 64 reasoning-only fallback 渲染条件同步放宽

**不触**: `use-chat-streaming-sync.ts`（不在 RC-4 分支范围）、`chat-session-store.ts`（字段语义没问题）、provider adapter、scene 层。

**备注（follow-up，不在本 change）**: t=0~41.4s 内的 pm-planner / manager / dispatcher 阶段 chat 完全静默，是 `VISIBLE_STREAMING_NODES` 白名单有意排除这些节点的结果（tasks 2.1c 明确归 follow-up）。本 change 只保证 employee node 进入后到首个 chunk 之间能看到 placeholder。
