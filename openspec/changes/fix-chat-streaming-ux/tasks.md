## 1. Live 复现 + 根因裁决（RC-1 / RC-2 / RC-3 / RC-4）

- [ ] 1.1 启 dev server：`lsof -ti :5176` 有就复用；无就清 `.vite` 缓存 `rm -rf apps/web/node_modules/.vite` 后 `pnpm --filter @offisim/web dev`
- [ ] 1.2 Playwright 开 `http://localhost:5176`，等 Office 3D 渲染稳定（Team panel 可见 + status bar `Ready`）
- [ ] 1.3 展开 collaboration panel（点 "Expand collaboration panel"），确认看到 Chat tab
- [ ] 1.4 在 chat textbox 输入：`Write 3 paragraphs about why coffee is great`（预期 > 500 token，足够长能看到增长）。**不要提交**。
- [ ] 1.5 在 Playwright `browser_evaluate` 里 hook 一下 store，然后提交消息并每 500ms 采样一次前 10s：

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

- [ ] 1.6 提交消息后 0 / 0.5 / 1 / 2 / 5 / 10 s 各截一次屏 + snapshot + store state，共 6 组数据。把结果 md 贴到本 tasks.md 下面 `## Observations` 段（新增）。
- [ ] 1.7 基于数据判定根因：
  - 若 `hasStreamingBubble === false` 贯穿 10s → **RC-1**（bubble 根本没 mount）
  - 若 `hasStreamingBubble === true` 但 `bubbleText` 长时间等于 placeholder 字面值 → **RC-2 / RC-3**（content prop 没写进去 or chunk 被白名单挡）
  - 若 `bubbleText` 中途有内容又突然变短 → **RC-4**（tool telemetry clear）
  - 若 `bubbleText` 全程为空、最终一次性出现完整答案 → chunk 事件本身没到，需要查 `use-chat-streaming-sync.ts` 订阅是否有效
- [ ] 1.8 在 tasks.md 下方新增 `## Decision` 段，写清哪条 RC 被裁决、依据数据、选定的修复入口文件

## 2. 改 ChatPanel / StreamingBubble / store（按 RC 分支执行）

### 分支 RC-1（ChatPanel 没 mount StreamingBubble）

- [ ] 2.1a 打开 `packages/ui-office/src/components/chat/ChatPanel.tsx`，找 StreamingBubble 的挂载点（grep `StreamingBubble`）
- [ ] 2.2a 修正挂载条件：只要 `activeRun.node != null && !activeRun.isTerminated` 就 mount（不要等 `content` 非空才挂），props 按 `content / reasoning / isStreaming=true / nodeName=activeRun.node` 传入
- [ ] 2.3a 若 ChatPanel 有 "pending" / "thinking" 的独立 placeholder 组件替代了 StreamingBubble，合并到 StreamingBubble 一条路径，删除独立 placeholder

### 分支 RC-2（content prop 映射错位）

- [ ] 2.1b 打开 ChatPanel，确认传给 StreamingBubble 的 `content` prop 是 `activeRun.streamingContent`（或等价字段，不是 `activeRun.finalContent`）
- [ ] 2.2b 若 store 里 streamingContent / finalContent 字段语义混乱，规整：streamingContent 是累积中的，finalContent 是 commit 后的；StreamingBubble 只读 streamingContent

### 分支 RC-3（chunk 被 VISIBLE_STREAMING_NODES 白名单挡）

- [ ] 2.1c 确认 live 观察到的实际发言 node。若是 `pm_planner` / `manager` 之类——**不是本 change scope**（follow-up；本 change 只保证 boss/employee/hr/boss_summary）
- [ ] 2.2c 若是 employee 也被挡——检查 `use-chat-streaming-sync.ts:33` 的 `VISIBLE_STREAMING_NODES.has(nextNode)` 是否在 `nodeEntered` 里把 `nextNode` 置空了（line 40 `store.setActiveRunNode(null, ...)`）。修正：employee / boss / hr / boss_summary 必须 activate 且保留到下一个 VISIBLE node 进来

### 分支 RC-4（tool telemetry clear 误清）

- [ ] 2.1d 在 `use-chat-streaming-sync.ts` 的 `unsubTool` handler 里，把 `clearActiveRunStreamingContent()` 的行为从"清空 activeRun"改为"commit 当前 speaker segment + 开新 segment"。保留已显示内容。

### 公共（所有分支后都跑）

- [ ] 2.10 `pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web typecheck` 绿
- [ ] 2.11 `pnpm lint` 绿

## 3. Live 验证（按 spec §11 的 3 条 acceptance）

- [ ] 3.1 kill 旧 dev server，清 vite 缓存，重启 `pnpm --filter @offisim/web dev`
- [ ] 3.2 **Live acceptance**（spec §11.1）：发 `Write 3 paragraphs about why coffee is great`。观察：
  - 气泡带 speaker label（Boss / Employee）
  - 文字在完成前可见增长（截图 3 张间隔 2s，应显著不同）
  - placeholder 在第一个 chunk 到来后消失
  - 完成时同一气泡延续为 final message（无闪烁）
- [ ] 3.3 **Direct chat acceptance**（spec §11.2）：
  - 点击一个员工（如 Alex Chen）进入 direct chat
  - 发 `Describe your role in one paragraph`
  - 观察：streaming 过程 bubble label 始终是员工名，不 snap 回 team feel；final 正确归属
- [ ] 3.4 **Failure acceptance**（spec §11.3）：触发一次故障（临时改 provider key 错误 or Ctrl+C 中断后再发），确认：
  - 已显示的 partial 留在屏上
  - 错误明确可见
  - 不塌成通用 placeholder loop
- [ ] 3.5 scene/footer 一致性检查：streaming 进行时 footer 不显示 `idle`，scene 里执行员工是 `executing` 态
- [ ] 3.6 抖动/滚动检查：在 1280×800 窗口下长文本流入时，不与用户滚动抢位

## 4. Commit + 收尾

- [ ] 4.1 `git status --short` 确认改动集中在 chat/ 目录 + openspec change 目录
- [ ] 4.2 `git diff` review：变更集中在 StreamingBubble / ChatPanel / 可能 chat-session-store；**不** 碰 use-chat-streaming-sync（除非 RC-4 分支），**不** 碰 provider adapter
- [ ] 4.3 清理 Playwright 截图（`rm -f verify-*.png`）
- [ ] 4.4 commit message 建议：`fix(ui-office): stream real content into chat bubble`，body 引用本 change 裁决的 RC 编号 + 根因 + 修改位置
- [ ] 4.5 `/opsx:archive fix-chat-streaming-ux` 选 Sync now 让 canonical spec `openspec/specs/chat-streaming-ux/spec.md` 落地

## Observations

(留给 Task 1.6 填 live 采样结果)

## Decision

(留给 Task 1.8 填 RC 裁决结果)
