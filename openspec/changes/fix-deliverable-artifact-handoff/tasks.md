## 1. Live 复现 + 根因裁决（RC-1 / RC-2 / RC-3 / RC-4）

- [ ] 1.1 启 dev server：`lsof -ti :5176` 有就复用；无就 `rm -rf apps/web/node_modules/.vite && pnpm --filter @offisim/web dev`
- [ ] 1.2 Playwright 开 `http://localhost:5176`，等 Office 3D 稳定
- [ ] 1.3 展开 collaboration panel，在 chat 输入：`Write a single-file HTML Snake game. Respond with just the HTML code.`（单文件 HTML 是最容易被 heuristic 识别为 file 的类型）
- [ ] 1.4 在 Playwright `browser_evaluate` 里**提交前**注入 event bus 采样：

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

- [ ] 1.5 提交消息，等 20-30s 直到 run 完成。观察：
  - chat 气泡里最终内容是什么：是 HTML 代码块 + 文字？还是只有短文字 + 某个 artifact UI？
  - Activity feed / task panel 是否显示 "deliverable created"
  - 打开 PitchHall（如有入口）看 artifact 是否落到那里
- [ ] 1.6 采样 DOM：找 `DeliverableArtifactCard` / `data-testid="deliverable-card"` / `[class*="artifact"]` / `[class*="deliverable"]` 类选择器，确认是否已经有卡组件存在
- [ ] 1.7 基于观察裁决：
  - 若 chat 里看到完整 HTML 代码块 + 没有 artifact 卡 + PitchHall 有条目 → **RC-1**（chat UI 没订阅 deliverable event）
  - 若 chat 里看到代码块 + 没 artifact 卡 + PitchHall 也无条目 → **RC-3**（core 没 emit event；需查 `infer-deliverable-file.ts` 启发式）
  - 若 chat 里有 artifact UI 但 Open/Download 不工作 → **RC-4**（UI 有卡但按钮 action 有 bug）
  - 若 chat 里没代码块 + 没 artifact 卡 + 只有 "The code is ready" 类空答 → 更深 RC，需要查 employee-node 的 response handling
- [ ] 1.8 在 tasks.md 下方新增 `## Observations` 和 `## Decision` 段记录采样 + RC 裁决

## 2. 实现（按 RC 分支）

### 分支 RC-1 / RC-2（chat UI 没订阅或没 artifact 卡）

- [ ] 2.1a 创建 `packages/ui-office/src/components/chat/DeliverableArtifactCard.tsx`（~100-150 行），按 design.md D4 实现 Open/Download/Copy 按钮 + 标题（员工名 → 文件名）+ mimeType pill
- [ ] 2.2a 在 `ChatPanel.tsx` 订阅 `useDeliverables()` 或直接 `deliverable.created`，将 artifact 按 `taskRunId` 关联到对应 chat message
- [ ] 2.3a 修改 `MessageBubble.tsx`：当 message 的 metadata 带 `artifact` 字段时，在文字下方渲染 `DeliverableArtifactCard`；没有时保持原样
- [ ] 2.4a 处理乱序：若 deliverable 事件在 message 已 commit 后到达，回填到对应 message（设计 D4 的 retroactive 分支）

### 分支 RC-3（core 没 emit）

- [ ] 2.1b 读 `packages/core/src/agents/infer-deliverable-file.ts`，用 live 捕获的 employee 返回内容跑一下启发式，找出为什么没命中
- [ ] 2.2b 修启发式（如 HTML fence 识别、mime 推断），或在 `employee-deliverables.ts` 的 `materializeFileDeliverableIfNeeded` 调用条件放宽
- [ ] 2.3b 修完后重跑 Task 1.5 确认 event emit，然后回到分支 RC-1/2

### 分支 RC-4（按钮 action 有 bug）

- [ ] 2.1c 定位 Open / Download / Copy 按钮实现位置（可能在 `deliverable-artifacts.ts` 或 PitchHall）
- [ ] 2.2c 按 design D4 标准化实现

### 公共（所有分支后都跑）

- [ ] 2.10 `pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web typecheck` 绿
- [ ] 2.11 `pnpm lint` 绿

## 3. Live 验证

- [ ] 3.1 重启 dev server（清 vite 缓存）
- [ ] 3.2 重新发 `Write a single-file HTML Snake game` 任务，等完成
- [ ] 3.3 验证 chat 气泡：
  - 气泡文本是简短完成语，不是 HTML 代码块
  - 气泡下方有 `DeliverableArtifactCard`：显示文件名 `*.html`、mime `text/html`、三按钮
- [ ] 3.4 点 `Open` → 新 tab 打开渲染 Snake game（能运行，不是源码显示）
- [ ] 3.5 点 `Download` → 浏览器下载 `.html` 文件；用 `diff` 或 hash 比对下载内容与 LLM 原始响应等价
- [ ] 3.6 点 `Copy` → 粘贴到编辑器，内容完整
- [ ] 3.7 发第二个任务 `Write a 3-paragraph markdown report about coffee` —— 验证 MD artifact：卡出现、Open 隐藏/禁用、Download + Copy 可用
- [ ] 3.8 Direct chat 也测一次：选员工进 direct chat → 发 HTML 任务 → 确认 artifact 卡行为一致
- [ ] 3.9 乱序测试：观察 artifact 卡是否在 final message 出现后才显示，或在中途闪出（不应在中途闪）
- [ ] 3.10 PitchHall 不回归：若有 PitchHall 入口，确认它仍然列出新 artifact

## 4. Commit + 收尾

- [ ] 4.1 `git status --short` — 改动集中在 chat/ + deliverable-artifacts.ts + useDeliverables.ts
- [ ] 4.2 `git diff` review：不改 provider / scene / SOP
- [ ] 4.3 清理 Playwright 截图（`rm -f verify-*.png`）
- [ ] 4.4 commit message 建议：`feat(ui-office): render file deliverables as artifact cards in chat`，body 引用 RC 编号 + 新 `DeliverableArtifactCard` 的 Open/Download/Copy 实现
- [ ] 4.5 `/opsx:archive fix-deliverable-artifact-handoff` 选 Sync now 落 `openspec/specs/deliverable-artifact-handoff/spec.md`

## Observations

(留给 Task 1 填)

## Decision

(留给 Task 1.8 填 RC 裁决)
