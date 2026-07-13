# Offisim UI/UX 一致性专项 — Tasks

> 对应计划：[plan.md](./plan.md)
> 状态：READY，0/8 completed
> 完成口径：T01-T07 真实实现，T08 release App 闭环；部分实现、仅编译通过或仅 dev 预览均不算完成。

## 任务总表

| ID | 结果 | Blocked by | 状态 |
|---|---|---|---|
| T01 | Stop 只控制真实 live run | — | [ ] |
| T02 | Semantic radius 与 UI hygiene 基线 | — | [ ] |
| T03 | Office rail toggle 归顶栏且折叠不留空轨 | T02 | [ ] |
| T04 | Usage/cost 单一表达与 run pill 稳定 | T01, T02 | [ ] |
| T05 | 全局 nav 可命名且选择不位移 | T02 | [ ] |
| T06 | Market toolbar 跨连接态不跳位 | T02 | [ ] |
| T07 | Error/presence 状态表达完整 | T02 | [ ] |
| T08 | 全门禁与 release App 两轮验收 | T01-T07 | [ ] |

## 全局执行规则

每个 task 开工前：

1. 确认真实时间并写入该 task evidence。
2. 对将修改的 function、class、method 逐个运行 GitNexus impact，先读 d=1 影响；HIGH/CRITICAL 必须先告知风险。
3. 只触达本 task 的文件与直接合同；发现跨 task 问题写回对应 task，不顺手扩成架构重做。
4. 使用仓库锁定 runner：npx --yes pnpm@10.15.1。
5. 保存用户已有 dirty work；本目录以外的无关改动不归入提交。

每个 task 完成前：

1. 运行该 task 的窄门禁。
2. 更新本文件 checkbox 和 evidence 链接。
3. 提交前运行 GitNexus detect_changes，compare base_ref main，确认 affected symbols/processes 与 task 一致。
4. 运行 git diff --check。
5. 任一 acceptance 未满足时保持未勾选。

---

## T01 — Stop 只控制真实 live run

**结果：** 历史 stale/expired approval 仍可追溯，但不会进入 global activeRuns、显示全局 run pill 或产生无响应 Stop；真实当前 session run 仍可幂等停止。

**风险：** ConversationRunController 的 GitNexus 上游风险为 MEDIUM（22 个影响、11 个直接依赖）。先改 oracle，再改投影，禁止按钮层 workaround。

### 源码证据

- apps/desktop/renderer/src/assistant/runtime/conversation-run-controller.ts:468-470：activeRuns miss 时 stopAndWait 静默返回。
- 同文件:575-612：hydrateStaleApprovals 将 DB approval 写成 awaiting-approval snapshot。
- 同文件:633-642：getGlobalSnapshot 仅按 phase 生成 activeRuns。
- apps/desktop/renderer/src/assistant/parts/RunPipelinePill.tsx:23-35、96-102：从 global activeRuns 选 run 并渲染 Stop。
- scripts/harness-conversation-run-controller.mts:1077-1114：当前测试把 stale-thread 放入 activeRuns，锁住了错误真值。
- 视觉证据：[13-stop-no-response.png](./screenshots/13-stop-no-response.png)。

### 实施决定

- global activeRuns 只由 controller 实际拥有且可控制的 ActiveRun 生成，不再由 snapshot phase 推断。
- stale/expired approval 保留在 runs 和 pendingApprovals，供 thread 内历史/撤销展示；不得伪装成 live。
- 不让 Stop 承担 dismiss stale approval；历史清理继续走 approval 的明确 dismiss 行为。
- 不改当前 live run 的 stopAndWait 清理、abort、interrupted checkpoint、retry 语义。
- 不删除或绕过 DesktopPiAgentRuntime 的 reattachLiveRuns/abort 路径；通过 Pi host harness 做负向回归。

### 预期触达

- apps/desktop/renderer/src/assistant/runtime/conversation-run-controller.ts
- scripts/harness-conversation-run-controller.mts
- scripts/harness-pi-agent-host.mjs 仅在缺少 reattach/abort 防回归断言时补充；否则只运行
- RunPipelinePill.tsx 原则上不改；projection 修正后 UI 应自然消失

### Acceptance criteria

- [ ] hydrate recent stale approval 后，runs 保留该 thread，pendingApprovals 含 state=stale，activeRuns 不含该 thread。
- [ ] hydrate expired approval 后同样不进入 activeRuns，且仍是 dismiss-only。
- [ ] stale/expired approval 不显示全局 run pill、progress 或 Stop。
- [ ] 当前 session 正在 preparing/running/awaiting live approval 的 run 仍进入 activeRuns。
- [ ] 对 live run 连续点击 Stop 只 abort 一次，最终 phase=interrupted，partial assistant checkpoint 正确持久化。
- [ ] 不存在 controller-owned run 时，UI 不提供 Stop；不靠 silent no-op 掩盖错误投影。
- [ ] Pi host reattach、stream 与 explicit abort 既有合同没有回归。
- [ ] interrupted、failed、completed 与 employee work-state projection 没有回归。

### Oracles

- npx --yes pnpm@10.15.1 harness:conversation-run-controller
- npx --yes pnpm@10.15.1 harness:pi-agent-host
- npx --yes pnpm@10.15.1 --filter @offisim/desktop-renderer typecheck

### Negative controls

- 临时把 global activeRuns 恢复为按 phase filter，stale approval oracle 必须失败。
- 临时让 live run 从 activeRuns 消失，live Stop/idempotency oracle 必须失败。

### Evidence / stop

- 记录 stale、expired、live、stopped 四类 snapshot JSON 摘要。
- 若真实 live run 也失去 Stop，或 Pi reattach/abort gate 变红，T01 不得完成。

---

## T02 — Semantic radius 与 UI hygiene 基线

**结果：** 圆角按 control/container/overlay/status/round 角色稳定；四处裸 CSS 圆角归类；现有 UI hygiene gate 恢复为 green。

### 源码证据

- apps/desktop/renderer/src/styles/tokens.css:35-41：数值 token 已存在，问题不是 token 缺失。
- Docs/design/.v3-dna-brief.md:69-85、101-108、114-124：已有 container、card、status 视觉语法，但未形成全局角色映射。
- 四处裸 CSS radius：
  - apps/desktop/renderer/src/surfaces/office/office.css:1903 — 2px
  - apps/desktop/renderer/src/surfaces/office/stage-browser/browser-session.css:39 — 6px
  - 同文件:66 — 7px
  - apps/desktop/renderer/src/surfaces/office/stage-terminal/terminal-session.css:42 — 999px
- 视觉证据：[01-radius-mismatch-stage-toolbar.png](./screenshots/01-radius-mismatch-stage-toolbar.png)。
- 当前 check:ui-hygiene 还报告 stage browser motion/z-index、terminal palette、Canvas raw color 等 baseline debt。

### 实施决定

- 在 tokens.css 建立 semantic aliases，全部引用现有数值 token：
  - radius-control → off-r-sm
  - radius-container → off-r-md
  - radius-overlay → off-r-lg
  - radius-status → off-r-pill
  - radius-round → off-r-round
- 在 Docs/design/.v3-dna-brief.md 和 Docs/UI_FRAMEWORK_STACK.md 写入角色表与选择规则。
- 本批触达组件必须消费 semantic alias；不机械迁移未触达全仓。
- CSS 裸 radius gate 检查任意非零 px/% 值，不只匹配 4px/50%/999px；允许 0、inherit、由 token 组合的分角。
- 普通 motion、z-index、color 进入现有 token。
- terminal API theme 或 Canvas compositing 若不能消费 CSS var，只允许 checker 中的精确文件+用途豁免，并在相邻注释说明外部 API/绘制语义；禁止排除整个目录或通配所有颜色。

### 预期触达

- apps/desktop/renderer/src/styles/tokens.css
- apps/desktop/renderer/src/design-system/grammar/grammar.css
- apps/desktop/renderer/src/surfaces/office/office.css
- apps/desktop/renderer/src/surfaces/office/stage-browser/browser-session.css
- apps/desktop/renderer/src/surfaces/office/stage-terminal/terminal-session.css
- 与现有 hygiene failures 对应的最小源文件
- scripts/check-ui-framework-hygiene.mjs
- scripts/check-ui-ux-drift.mjs
- Docs/design/.v3-dna-brief.md
- Docs/UI_FRAMEWORK_STACK.md

### Acceptance criteria

- [ ] semantic radius 五角色有唯一文档定义且 alias 不复制数值。
- [ ] Game View/segmented control 使用 control；run pipeline shell 使用 container；Stop 使用 control；badge/status capsule 才能使用 status。
- [ ] 四处裸 CSS radius 全部归入正确角色。
- [ ] renderer CSS 中不存在非零裸 px/% border-radius；0、inherit、token 分角不误报。
- [ ] checker 能阻止新的 6px、7px、999px 等任意裸 radius。
- [ ] 当前 check:ui-hygiene 报告的 baseline 项全部被 token 化或精确、可解释地豁免。
- [ ] 没有目录级、文件后缀级或宽泛正则豁免。
- [ ] 视觉没有因 alias 建立而发生全仓无关变化。

### Oracles

- npx --yes pnpm@10.15.1 check:ui-hygiene
- npx --yes pnpm@10.15.1 check:ui-ux-drift
- npx --yes pnpm@10.15.1 --filter @offisim/desktop-renderer typecheck
- npx --yes pnpm@10.15.1 --filter @offisim/desktop-renderer build

### Negative controls

- 在临时 CSS fixture 写 border-radius: 6px，hygiene gate 必须失败。
- 把 Stop 改回 radius-status，UI drift gate 必须失败。

### Evidence / stop

- 保存 raw-radius 搜索为零的输出、alias 表和 hygiene 通过日志。
- 若只能靠宽泛 allowlist 让 gate 变绿，T02 不得完成。

---

## T03 — Office rail toggle 归顶栏且折叠不留空轨

**结果：** 左右 rail toggle 对称地位于 Office topbar；折叠后 rail 真正消失，Stage 接管空间；所有历史补偿空块被删除。

### 源码证据

- WorkspacePanel.tsx:1223-1232 与 ChatRail.tsx:140-246 重复渲染 absolute collapse control。
- office.css:1-47 折叠后保留 56px rail。
- collapse 补偿：
  - office.css:145 — +32px
  - office.css:3730、3853 — +34px
  - connect.css:138、161 — +34px
  - TeamDock.tsx:613 — pr-12
- 视觉证据：
  - [02-collapse-buttons-asymmetric.png](./screenshots/02-collapse-buttons-asymmetric.png)
  - [03-codex-ref-sidebar-toggle.png](./screenshots/03-codex-ref-sidebar-toggle.png)
  - [04-codex-ref-right-panel-toggle.png](./screenshots/04-codex-ref-right-panel-toggle.png)
  - [05-codex-ref-collapsed.png](./screenshots/05-codex-ref-collapsed.png)
  - [12-company-channels-dead-block.png](./screenshots/12-company-channels-dead-block.png)

### 实施决定

- AppFrame 在 surface=office 时渲染一对固定 rail controls，直接消费现有 ui-state。
- 左右 control 尺寸、radius、icon grammar、tooltip、focus ring 完全一致。
- expanded rail 使用原宽；collapsed grid column 为 0，不保留 56px launcher rail。
- WorkspacePanel 与 ChatRail 不再渲染任何 collapse-edge button 或 collapsed mini content。
- 删除所有由旧 absolute button 造成的补偿 padding，包括当前搜索到的全部 32px、34px 和 pr-12。
- 不新增 shell 外圈 padding，不改变非 Office surface 的 topbar。

### 预期触达

- apps/desktop/renderer/src/design-system/shell/AppFrame.tsx
- apps/desktop/renderer/src/design-system/shell/shell.css
- apps/desktop/renderer/src/surfaces/office/OfficeSurface.tsx
- apps/desktop/renderer/src/surfaces/office/WorkspacePanel.tsx
- apps/desktop/renderer/src/surfaces/office/ChatRail.tsx
- apps/desktop/renderer/src/surfaces/office/TeamDock.tsx
- apps/desktop/renderer/src/surfaces/office/office.css
- apps/desktop/renderer/src/surfaces/office/rail/connect/connect.css
- 对应 UI drift gate

### Acceptance criteria

- [ ] Office topbar 始终有且只有一个左 rail toggle 和一个右 rail toggle。
- [ ] 两个 toggle 的位置、hit area、radius、hover/focus、icon 状态对称。
- [ ] aria-label 能表达展开/折叠目标，aria-expanded 与实际状态一致，键盘可操作。
- [ ] 左/右 rail 可独立折叠和恢复，现有 Zustand session-state 语义不变；不伪造持久化合同。
- [ ] 任一 rail 折叠后 grid 不保留 56px mini rail，Stage 宽度立即接管。
- [ ] WorkspacePanel、ChatRail、Company channels、thread detail、TeamDock header 不再保留 collapse-edge 空位。
- [ ] repo 搜索不再出现 off-rail-collapse-edge、+32px/+34px collapse compensation 或该用途的 pr-12。
- [ ] 1440×900 和 1024×700 下四种 rail 组合都无覆盖、跳位、死区和黑色外框。

### Oracles

- npx --yes pnpm@10.15.1 check:ui-hygiene
- npx --yes pnpm@10.15.1 check:ui-ux-drift
- npx --yes pnpm@10.15.1 --filter @offisim/desktop-renderer typecheck
- npx --yes pnpm@10.15.1 --filter @offisim/desktop-renderer build

### Negative controls

- 临时恢复任一 off-rail-collapse-edge 或 +34px 补偿，UI drift gate 必须失败。
- collapsed column 恢复为 56px，rail geometry gate 必须失败。

### Evidence / stop

- 保存四种 rail 组合在两种窗口尺寸下的 release 截图坐标。
- 任一内容 header 仍因 toggle 留出不可解释空块，T03 不得完成。

---

## T04 — Usage/cost 单一表达与 run pill 稳定

**结果：** token/cost 只在 Office Stage 表达一次；全局预算告警仍工作；run pill 在完整与 compact 宽度都保留可读状态，不再出现无名 dots 和空洞。

### 源码证据

- AppFrame.tsx:23、60-72 与 OfficeStage.tsx:88、115-119 同时读 useRunCost。
- run-cost.ts:209-216 的 monthlyTokens 直接等于 tokens，截图不是不同统计周期。
- RunPipelinePill.tsx:20-103 组合 pipeline 与 Stop。
- office.css:5391-5402 在 1500px 以下隐藏 stage label、task 与 progress。
- 视觉证据：
  - [06-duplicate-token-cost.png](./screenshots/06-duplicate-token-cost.png)
  - [07-run-pill-void-space.png](./screenshots/07-run-pill-void-space.png)

### 实施决定

- 删除 AppFrame 可见 cost output 与其专用 CSS，但保留 useRunCost alert 查询、去重和 sonner toast。
- Office Stage 是唯一可见 tokens/cost readout；不新增 Settings/Accounts 汇总页。
- 完整 pipeline：阶段名、当前任务、进度、Stop。
- compact pipeline：当前阶段名、完成数/总数或等价确定性进度、Stop；不显示四个无名 dots。
- pipeline 不设置造成空洞的固定最小宽度；内容宽度由实际语义决定。
- run pill 使用 T02 的 container/control/round 角色。

### 预期触达

- apps/desktop/renderer/src/design-system/shell/AppFrame.tsx
- apps/desktop/renderer/src/design-system/shell/shell.css
- apps/desktop/renderer/src/assistant/parts/RunPipelinePill.tsx
- apps/desktop/renderer/src/surfaces/office/stage-viewer/StageViewer.tsx
- apps/desktop/renderer/src/surfaces/office/office.css
- 对应 run-cost / UI drift harness

### Acceptance criteria

- [ ] 任意 surface 的全局 topbar 不再出现 tokens/cost output。
- [ ] Office Stage 只有一处 tokens/cost readout，值与 useRunCost 真值一致。
- [ ] warning/critical budget toast 仍按原阈值、去重与 Settings action 触发。
- [ ] 无 active run 时 pipeline 完全不占位。
- [ ] active run 在 1440、1280、1024 宽度都显示当前阶段的文字语义与 Stop。
- [ ] compact mode 不再只剩 dots；selected thread run 的选择逻辑不变。
- [ ] active→completed/failed/interrupted 后 pipeline 正确退出，不留空壳。
- [ ] Stop control 的 hit area、focus ring 与 radius 符合 control role。

### Oracles

- npx --yes pnpm@10.15.1 harness:run-cost-scope
- npx --yes pnpm@10.15.1 harness:conversation-run-controller
- npx --yes pnpm@10.15.1 check:ui-ux-drift
- npx --yes pnpm@10.15.1 --filter @offisim/desktop-renderer typecheck
- npx --yes pnpm@10.15.1 --filter @offisim/desktop-renderer build

### Negative controls

- 临时恢复 AppFrame visible cost output，duplicate ownership gate 必须失败。
- compact CSS 隐藏阶段文字，run pill gate 必须失败。

### Evidence / stop

- 保存 idle、full active、compact active、terminal 四态截图。
- 预算 toast 被误删或 Stage/Topbar 仍重复表达，T04 不得完成。

---

## T05 — 全局 nav 可命名且选择不位移

**结果：** 六个 surface 在支持的最小窗口都可直接读出名称，选择任一项不会改变 nav cluster 的宽度或中心位置。

### 源码证据

- WorkspaceNav.tsx:36 只给 active utility 渲染 label。
- shell.css:230-234 为 active utility 改 padding。
- shell.css:245-253 在 1280px 以下隐藏所有 nav label。
- Tauri 最小窗口为 1024×700。
- 视觉证据：
  - [08-nav-icons-only.png](./screenshots/08-nav-icons-only.png)
  - [09-nav-shifts-on-select.png](./screenshots/09-nav-shifts-on-select.png)

### 实施决定

- NAV_ENTRIES 六项都始终渲染 icon+label。
- primary/utility 可以保留 divider，但不能使用 active 才展开的结构。
- 每个 button 使用稳定尺寸；active 只改视觉状态。
- 取消 1280px 图标化规则；窄窗口优先压缩 ScopeBar max-width、ellipsis company/project name。
- nav 继续绝对居中，不因左右 topbar chrome 或 surface 选择偏移。

### 预期触达

- apps/desktop/renderer/src/design-system/shell/WorkspaceNav.tsx
- apps/desktop/renderer/src/design-system/shell/ScopeBar.tsx
- apps/desktop/renderer/src/design-system/shell/shell.css
- scripts/check-ui-ux-drift.mjs

### Acceptance criteria

- [ ] Office、Loops、Personnel、Market、Studio、Settings 在 1440 与 1024 宽度都显示文字 label。
- [ ] utility 选中前后 DOM label 均存在，button width/padding 不变。
- [ ] 逐个切换六个 surface，nav 外框 left/width/center 坐标不变。
- [ ] active、hover、focus、aria-current 与 tooltip 语义完整。
- [ ] 1024px 下 ScopeBar 可截断但 nav 不与 wordmark、scope 或 rail toggle 重叠。
- [ ] keyboard tab 顺序与 NAV_ENTRIES 顺序一致。

### Oracles

- npx --yes pnpm@10.15.1 check:ui-hygiene
- npx --yes pnpm@10.15.1 check:ui-ux-drift
- npx --yes pnpm@10.15.1 --filter @offisim/desktop-renderer typecheck
- npx --yes pnpm@10.15.1 --filter @offisim/desktop-renderer build

### Negative controls

- 临时恢复 active-only utility label，nav stability gate 必须失败。
- 临时添加 max-width:1280 的 label display:none，gate 必须失败。

### Evidence / stop

- 保存六项切换前后的 nav bounds 表和 1024px release 截图。
- 任一 surface 只能靠猜 icon 或 tooltip 识别，T05 不得完成。

---

## T06 — Market toolbar 跨连接态不跳位

**结果：** Market 在 registry connected/disconnected、Browse/Installed 之间保持同一 toolbar 主轴；不再用透明搜索框制造空白。

### 源码证据

- MarketSurface.tsx:303-305 判断 registryNotConnected。
- 同文件:311-313 在 disconnected 时注入 off-mkt-search-placeholder。
- 同文件:321-378 条件渲染 mode、filters、sort 与 actions。
- market.css:35-67 让 placeholder 保留搜索区域高度/宽度。
- 视觉证据：
  - [10-market-empty-state-layout.png](./screenshots/10-market-empty-state-layout.png)
  - [11-market-toolbar-full.png](./screenshots/11-market-toolbar-full.png)

### 实施决定

- Browse/Installed segmented control 固定为 toolbar 第一组。
- registry connected 时 search 是中间弹性内容；disconnected 时完全不渲染 placeholder。
- manage filters 与右侧 sort/action 按 mode 条件出现，但不改变主控起点。
- disconnected empty state 保留真实连接提示与已有 action；不改 registry 后端或产品文案范围。

### 预期触达

- apps/desktop/renderer/src/surfaces/market/MarketSurface.tsx
- apps/desktop/renderer/src/surfaces/market/market.css
- scripts/check-ui-ux-drift.mjs

### Acceptance criteria

- [ ] connected/disconnected 两态下 Browse/Installed 的左侧起点一致。
- [ ] DOM/CSS 不再存在 off-mkt-search-placeholder 或等价透明占位。
- [ ] connected Browse 显示可用 search；disconnected 不出现不可操作的空 search 区。
- [ ] Browse/Installed 切换时 segmented control 不跳位。
- [ ] filters、sort、actions 在适用状态出现，toolbar 不溢出或产生不可解释大空洞。
- [ ] 1440×900 与 1024×700 下 toolbar、empty state、package grid 对齐。
- [ ] registry 查询、安装、更新、发布行为合同未被改写。

### Oracles

- npx --yes pnpm@10.15.1 check:ui-ux-drift
- npx --yes pnpm@10.15.1 check:ui-hygiene
- npx --yes pnpm@10.15.1 --filter @offisim/desktop-renderer typecheck
- npx --yes pnpm@10.15.1 --filter @offisim/desktop-renderer build

### Negative controls

- 临时恢复不可见 placeholder，Market layout gate 必须失败。
- 让 mode switch 随 connected 状态改变首列位置，geometry oracle 必须失败。

### Evidence / stop

- 保存 connected/disconnected × Browse/Installed 四态 bounds 与截图。
- 若靠固定大宽度空块维持对齐，T06 不得完成。

---

## T07 — Error/presence 状态表达完整

**结果：** chat error 与消息列对齐；working/idle/blocked/failed/offline 五态不依赖猜测、颜色或动画即可区分。

### 源码证据

- OfficeThread.tsx:351-378：ChatErrorBanner 是 off-messages 的 sibling。
- office.css:3879-3887：messages 有水平 inset；5599-5604：error banner margin 没有同等水平 inset。
- TeamDock.tsx:57-71 已生成 is-running/is-idle/is-blocked/is-failed/is-offline class。
- office.css:3645-3669 只给默认 dot 与 is-running 特殊样式。
- 视觉证据：
  - [14-error-banner-no-padding.png](./screenshots/14-error-banner-no-padding.png)
  - [15-presence-idle-vs-offline.png](./screenshots/15-presence-idle-vs-offline.png)

### 实施决定

- message list 与 error banner 共用内容 inset contract，不以单次 magic margin 修截图。
- error summary、details、Dismiss/Retry 等 action 都在同一内容列。
- presence 保留现有数据推导，只补五态 label/tone/shape/surface。
- working 可使用 motion；reduced motion、截图和色觉差异场景仍由文字/形状辨识。
- failed 与 blocked 必须不同；idle 与 offline 必须不同。

### 预期触达

- apps/desktop/renderer/src/assistant/OfficeThread.tsx
- apps/desktop/renderer/src/assistant/parts/ChatErrorBanner.tsx
- apps/desktop/renderer/src/surfaces/office/TeamDock.tsx
- apps/desktop/renderer/src/surfaces/office/office.css
- scripts/check-ui-ux-drift.mjs

### Acceptance criteria

- [ ] error banner 左右边界与 message content column 一致，不贴 rail 边。
- [ ] error details 展开/收起、action、长文本、窄 rail 都不破坏 inset。
- [ ] working、idle、blocked、failed、offline 五态都有明确可见文字。
- [ ] idle 与 offline、blocked 与 failed 在静态灰度截图中仍可区分。
- [ ] prefers-reduced-motion 下没有信息损失。
- [ ] screen reader 可获得等价 presence/error 状态，不只读到装饰 dot。
- [ ] presence 数据源、employee assignment 与 runtime projection 没有改动。

### Oracles

- npx --yes pnpm@10.15.1 harness:office-projection
- npx --yes pnpm@10.15.1 harness:office-visual-language-p4
- npx --yes pnpm@10.15.1 check:ui-ux-drift
- npx --yes pnpm@10.15.1 --filter @offisim/desktop-renderer typecheck
- npx --yes pnpm@10.15.1 --filter @offisim/desktop-renderer build

### Negative controls

- 临时移除 offline 专属 label/shape，presence gate 必须失败。
- 将 error banner horizontal inset 设为 0，layout gate 必须失败。

### Evidence / stop

- 保存 error collapsed/expanded 与五态 normal/reduced-motion 截图。
- 任两态只能通过动画或细微颜色差识别，T07 不得完成。

---

## T08 — 全门禁与 release App 两轮验收

**结果：** 当前 worktree release Offisim.app 在默认与最小窗口完成两轮连续验收，15 张原始截图对应 finding 全部关闭，没有用 dev/localhost 证据冒充桌面交付。

### Blocked by

T01-T07 全部完成且各自窄门禁 green。

### 构建与静态门禁

- [ ] npx --yes pnpm@10.15.1 check:ui-hygiene
- [ ] npx --yes pnpm@10.15.1 check:ui-ux-drift
- [ ] npx --yes pnpm@10.15.1 harness:conversation-run-controller
- [ ] npx --yes pnpm@10.15.1 harness:pi-agent-host
- [ ] npx --yes pnpm@10.15.1 harness:run-cost-scope
- [ ] npx --yes pnpm@10.15.1 harness:office-projection
- [ ] npx --yes pnpm@10.15.1 validate
- [ ] npx --yes pnpm@10.15.1 lint
- [ ] npx --yes pnpm@10.15.1 --filter @offisim/desktop-renderer typecheck
- [ ] npx --yes pnpm@10.15.1 --filter @offisim/desktop-renderer build
- [ ] npx --yes pnpm@10.15.1 --filter @offisim/desktop build
- [ ] git diff --check

### Release artifact

- 精确路径：apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app
- [ ] 记录 build checkedAt、HEAD SHA、App bundle SHA 与 codesign verify 结果。
- [ ] 只启动上述当前 worktree 路径；禁止 open -b com.offisim.desktop。
- [ ] 使用 Computer Use 前先枚举窗口并匹配 path/pid/title/bounds/content；记录 windowId 或 CGWindowNumber。
- [ ] 不使用 osascript、盲切前台或按 App 名猜窗口。

### 两轮 live 矩阵

每轮都在 release App 本体执行；第一轮修完任何 finding 后必须重建，第二轮从干净窗口状态重跑。

| 场景 | 必验结果 | 原始证据 |
|---|---|---|
| Office 默认 1440×900 | 圆角角色统一；usage/cost 只出现一次；pipeline 无空洞 | 01、06、07 |
| Rails 四组合 | 顶栏 toggle 对称；折叠列归零；Company channels 无死块 | 02-05、12 |
| Stop live run | 真实 run 可停止，pill 退出，状态为 interrupted | 13 |
| Stop stale approval | 历史可见但无全局 pill/Stop | 13 |
| 六项 nav | 始终有 label，逐项选择 bounds 不变 | 08、09 |
| Market 四态 | connected/disconnected × Browse/Installed 主控不跳位 | 10、11 |
| Chat error | summary/details/actions 与 message column 对齐 | 14 |
| Presence 五态 | normal 与 reduced-motion 都可辨 | 15 |
| 最小窗口 1024×700 | 上述 chrome 无重叠、溢出、黑框或不可达 control | 01-15 |

### Live acceptance criteria

- [ ] 第一轮覆盖矩阵全部执行，finding 已回到对应 T01-T07 修根因。
- [ ] 修复后重新运行所有受影响窄门禁与 release build。
- [ ] 第二轮从新启动的精确 release App 重跑，连续零 finding。
- [ ] 若执行真实 Pi run 会产生付费调用，动手前按项目规则一句话预告；缺凭证则明确 BLOCKER，package 保持未完成。
- [ ] release App 没有黑屏、不可附着、点击无响应或误附着旧 bundle。
- [ ] screenshots 只保留最终有判定价值的 before/after 与状态矩阵。
- [ ] transient profile、测试 Project、副本、日志和无价值截图已清理。

### Evidence 目录

建立 Docs/evidence/2026-07-13-ui-ux-consistency-pass/，至少包含：

- README.md：checkedAt、commit SHA、artifact path、window identity、测试步骤、PASS/BLOCKER。
- gate 日志或结构化摘要。
- release artifact SHA/codesign evidence。
- 1440 与 1024 两轮截图矩阵。
- 原始 15 张截图到最终 evidence 的 closure map。

### 最终关闭

- [ ] GitNexus detect_changes compare main 已运行，影响只覆盖本专项 symbols/processes。
- [ ] plan.md 状态改为 COMPLETE，并附 evidence 链接。
- [ ] 本文件状态改为 COMPLETE，8/8 completed。
- [ ] 任一 gate、live 场景或 cleanup 未完成时，不得勾选本 task。
