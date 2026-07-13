# Offisim UI/UX 一致性专项 — 审计后执行计划

> 状态：COMPLETE — T01-T08 已完整交付
> 审计时间：2026-07-13 22:41 AEST（+10:00）
> 完成时间：2026-07-14 02:14 AEST（+10:00）
> 代码基线：a142000cf360
> 执行入口：[tasks.md](./tasks.md)
> 验收证据：[README](../../evidence/2026-07-13-ui-ux-consistency-pass/README.md)

## 1. 审计结论

Claude 给出的 15 张截图证据有效，但原计划和后续 tasks 把专项扩大成 Project/workspace 恢复、标题生成、Codex/Claude subscription engine、AI Accounts、模型 catalog、Loops、Personnel 与大规模文档重写。这些属于独立的 engine-neutral 架构与产品能力路线，不由本批截图证明，也不能混进一次 UI 一致性专项。

本包已收敛为：

- 1 个真实运行控制 bug：历史 approval 被错误投影成 active run，产生无响应 Stop。
- 6 类 UI/UX 规范问题：圆角角色、Office rails、run chrome、全局导航、Market toolbar、状态表达。
- 1 个 release 闭环任务：只认当前 worktree release Offisim.app 的真实交互证据。

不修改产品架构，不恢复旧 runtime lane，不重做 Accounts/Models，不借 UI 专项改业务流程。

## 2. 目标与非目标

### 目标

1. Stop 只出现在真实可控的当前会话 run 上；历史 stale/expired approval 不再制造幽灵运行态。
2. 让圆角、rail、导航、toolbar、run chrome、错误与 presence 状态按语义稳定，而不是按页面临时拼装。
3. 消除截图中 9 个现象，并加入足以阻止同类回归的窄门禁。
4. 在 1440×900 默认窗口与 1024×700 最小窗口完成 release App 验收。

### 非目标

- 不修改 engine-neutral 产品目标或 `DesktopAgentRuntime` 唯一 production gateway 合同。
- 不在本专项新增 Codex、Claude 或其他 runtime engine；当前 production 仍只装配 Pi，直到各 engine 的独立任务完整交付。
- 不实现 AI Accounts / Models / Usage / Cost、model catalog 或 Project/workspace 四层合同；它们保留在独立架构路线。
- 不重写 Project、workspace、conversation、Loops、Personnel、Market registry 等业务合同。
- 不新增 web/browser 产品，不把 localhost 或 dev webview 当验收。
- 不做全仓视觉重设计；只修本批截图证明的问题和它们的直接一致性门禁。

## 3. 证据与源码核验

| 现象 | 审计判断 | 源码真值 | 执行决定 |
|---|---|---|---|
| Stop 点击无响应 | TRUE，真实 bug | conversation-run-controller.ts:468-470 对 activeRuns miss 静默返回；575-612 将 DB approval hydrate 成 awaiting-approval；633-642 又按 phase 填入 global activeRuns。RunPipelinePill.tsx:23-35、96-102 因而渲染 Stop | 在投影边界分离历史 approval 与 live controllable run；不在按钮层做清脏 workaround |
| stale approval 的现有测试 | TRUE，当前 harness 锁住了错误行为 | harness-conversation-run-controller.mts:1077-1114 当前 evidence 把 stale-thread 放进 activeRuns | 先改 oracle：历史仍可追溯，但 global activeRuns 必须为空 |
| 圆角是 token 漂移 | FALSE | tokens.css:35-41 已有完整数值 token；DNA brief:69-85 已有 container grammar | 问题是角色定义缺失，不做全仓数值扫平 |
| 只有 4 处裸 CSS 圆角 | TRUE | office.css:1903 为 2px；browser-session.css:39、66 为 6px/7px；terminal-session.css:42 为 999px | 建立 semantic radius roles，并把 4 处归类到角色；0、inherit 和组合边角不是裸像素债 |
| 左右 rail 折叠控件不对称 | TRUE | WorkspacePanel.tsx:1223-1232 与 ChatRail.tsx:140-246 在内容区重复 absolute toggle；office.css:1-47 折叠后仍保留 56px mini rail | toggle 归 AppFrame 顶栏 chrome；collapsed rail 宽度归零，内容区不再自带折叠按钮 |
| Company channels 右侧空块 | TRUE | connect.css:138 的 +34px padding 为 absolute toggle 预留，但 toggle 位于另一层；同类补偿还在 office.css:145、3730、3853，connect.css:161 与 TeamDock.tsx:613 | 删除所有 collapse-button 补偿，而不是只删截图中的一处 |
| token/cost 重复 | TRUE | AppFrame.tsx:23、60-72 与 OfficeStage.tsx:88、115-119 同时读 useRunCost；run-cost.ts:209-216 的 monthlyTokens 就是 tokens | 可见 usage/cost 只留 Office Stage 的 diegetic readout；AppFrame 只保留预算 toast 协调 |
| run pill 缩窄后出现空洞 | TRUE | office.css:5391-5402 在 1500px 以下隐藏 label、task、progress，只剩四个无名 dot 与 Stop | compact mode 必须保留当前阶段语义和 Stop，不能靠隐藏内容缩窄 |
| nav 图标化且选择时位移 | TRUE | WorkspaceNav.tsx:36 只给 active utility 渲染 label；shell.css:230-253 改 active padding，并在 1280px 以下隐藏全部 label | 六个 surface 始终可命名；active/inactive 尺寸一致；优先压缩 ScopeBar 而不是抹掉 nav 语义 |
| Market disconnected 留空占位 | TRUE | MarketSurface.tsx:311-313 注入不可见 search placeholder；market.css:35-67 仍让它占 toolbar 空间 | mode switch 固定左侧，search 仅在可用时出现，右侧次要控制不跳位 |
| error banner 贴 rail 边 | TRUE | OfficeThread.tsx:351-378 把 ChatErrorBanner 放在 off-messages 外；office.css:3879-3887 有 message inset，5599-5604 的 banner 没有水平 inset | banner 与 message column 使用同一内容 inset |
| idle/offline 无法区分 | TRUE | TeamDock.tsx:57-71 已生成五类 class；office.css:3645-3669 只实现默认与 is-running | 保留数据合同，补全可读的五态视觉语法；不能只靠动画或颜色 |
| subscription engines / AI Accounts / model catalog | FALSE / 越界 | 截图无此证据；这些是 engine-neutral 架构路线的独立完整能力 | 从本专项移除，不否定目标架构 |

## 4. 当前基线门禁

审计时实际运行：

- npx --yes pnpm@10.15.1 check:ui-ux-drift：PASS。
- npx --yes pnpm@10.15.1 harness:conversation-run-controller：PASS 22/22，但其中 stale approval 场景的 activeRuns 预期是错误 oracle，不能据此宣称 bug 不存在。
- npx --yes pnpm@10.15.1 check:ui-hygiene：FAIL。除 999px 裸圆角外，还报告 stage browser 的 raw motion/z-index、terminal palette、Canvas 颜色等现存 hygiene debt。

因此本专项的完成口径不是“维持当前 green”。T02 必须让 UI hygiene gate 恢复为 green：普通视觉值进入 token；确属 terminal API、Canvas compositing 等协议值时，只允许精确、带理由的窄豁免，禁止目录级放行。

GitNexus 审计结果：

- stopAndWait：LOW，2 个上游影响、1 个直接调用者。
- ConversationRunController：MEDIUM，22 个上游影响、11 个直接依赖；运行态改动必须先锁 oracle 再改代码。
- AppFrame、WorkspaceNav、WorkspacePanel、ChatRail、MarketSurface、presenceFor：当前均为 LOW。

实现者仍须在每次改具体 symbol 前重跑 impact；若索引变化后变为 HIGH/CRITICAL，先告知风险再继续。

## 5. 已拍板的设计合同

### 5.1 Live run 与历史 approval

- global activeRuns 的含义是当前 renderer 能实际控制的 run，不是 phase 看起来活跃的任意 snapshot。
- stale/expired approval 只进入对应 conversation 的历史/待处理投影；它不是全局 running，也不显示 Stop 或 progress。
- Stop 不负责清理历史脏状态；按钮能出现就必须有真实 controller ownership。
- 当前 session 的 live run 继续支持幂等 Stop、partial assistant checkpoint 与 retry。
- 官方 Pi host reattach/abort 路径必须保持通过；本专项不把 provider lane 或第二 runtime 引回 controller。

### 5.2 Semantic radius roles

数值 token 不变，新增角色映射：

| 角色 | 语义 | 数值来源 |
|---|---|---|
| control | button、input、segmented item、Stop 等可交互控制 | off-r-sm |
| container | toolbar group、card、run pipeline shell | off-r-md |
| overlay | dialog、popover、floating panel | off-r-lg |
| status | 非交互 badge、tag、compact status capsule | off-r-pill |
| round | avatar、dot、icon circle | off-r-round |

角色 alias 只引用现有 token，不复制数值。先落到 design-system grammar、本批触达组件和四处裸 CSS 圆角；不做机械全仓重命名。

### 5.3 Office rails

- 左右 rail toggle 各只有一个，位于 Office 激活时的 AppFrame topbar chrome。
- 展开时 rail 是完整 panel；折叠时 rail 从 grid 消失，Stage 接管释放的空间。
- 删除内容 header 里的 absolute toggle、56px mini rail 和所有由其产生的 32px/34px/pr-12 补偿。
- 维持 aria-label、expanded 状态、keyboard focus 与现有 Zustand session-state 语义；本专项不新增持久化合同。
- WebView root 仍贴齐可绘制区域，不新增外圈 margin/gutter。

### 5.4 Run chrome

- 全局 topbar 不重复展示 usage/cost；预算告警 toast 仍由 AppFrame 触发。
- Office Stage 保留唯一 diegetic tokens/cost readout。
- run pipeline 完整态展示阶段、当前任务、进度与 Stop；compact 态至少展示当前阶段名称、确定性进度和 Stop。
- Stop 是 control radius；status dot 是 round；pipeline shell 是 container。不能把整个交互组都做成 pill。

### 5.5 App navigation

- Office、Loops、Personnel、Market、Studio、Settings 六项始终有文字名称。
- active/inactive 只改变颜色、surface、weight，不改变 button 宽度、padding 或 label 存在性。
- nav cluster 始终以窗口中心为锚；1024px 时先缩 ScopeBar 的可用宽度并 ellipsis，不隐藏 nav label。

### 5.6 Market toolbar

- Browse/Installed segmented control 是固定第一组。
- Search 在 registry 可用时占中间弹性区；不可用时不渲染透明占位。
- filter/sort/action 属于右侧次要控制；mode、连接态变化不改变主控起点。
- 不改 registry 连接合同、安装/发布业务或空状态文案范围。

### 5.7 State presentation

- Chat error banner 与 message content 共用水平 inset，详情和 action 也在同一列。
- presence 五态为 working、idle、blocked、failed、offline。
- 每态至少由文字加色调/形状/表面中的一项区分；reduced motion 下仍完整可辨。
- 不修改 TeamDock 的 presence 数据推导，只补表现与可访问语义。

## 6. 执行顺序

1. T01 先修 Stop 真 bug并锁运行态 oracle。
2. T02 建立 semantic radius 与可通过的 hygiene 基线。
3. T03、T04 基于前两项收敛 Office rails 和 run chrome。
4. T05、T06、T07 分别收敛 nav、Market toolbar、状态表达。
5. T08 跑全门禁、构建 release App、Computer Use 两轮验收与 evidence 清理。

依赖关系：

- T01 与 T02 可独立实施。
- T03 依赖 T02。
- T04 依赖 T01、T02。
- T05、T06、T07 依赖 T02 的角色合同，但彼此独立。
- T08 依赖 T01-T07 全部完成。

## 7. 反过度工程边界

- 不为历史 approval 新建 migration、compat 或 fallback；项目未上线，直接修当前投影。
- 不为 rail toggle 搭建通用 slot framework；AppFrame 已依赖 ui-state，做 Office 条件 chrome 即可。
- 不新建共享视觉 package；所有 UI ownership 留在 apps/desktop/renderer。
- 不为四处裸圆角做全仓 CSS 重写；定义角色、改触达点、加精确 gate。
- 不用 Playwright 代替 release App 验收；Browser/dev server 仅可排障。
- 不把 baseline hygiene 失败通过宽泛 exclude 掩盖。
- 不在 packages/core/src 下增加 product test；运行不变量留在现有 harness。

## 8. 完成定义

只有以下全部成立，package 才能从 READY 改为 COMPLETE：

1. tasks.md 的 T01-T08 与全部 acceptance criteria 已勾选。
2. npx --yes pnpm@10.15.1 check:ui-hygiene、check:ui-ux-drift、harness:conversation-run-controller、harness:pi-agent-host、validate 全绿。
3. renderer typecheck/build 与 desktop release build 全绿。
4. 当前 worktree 精确路径 apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app 已通过 Computer Use 验收。
5. evidence 记录 checkedAt、commit SHA、App SHA、windowId、pid、title、bounds、测试矩阵和截图。
6. 1440×900 与 1024×700 两轮连续无本专项 finding；发现问题必须回到对应 task 修根因、重建、重测。
7. GitNexus detect_changes 在提交前证明影响范围与专项一致。
