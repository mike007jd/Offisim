## Context

桶 1 一次性处理 6 条 shell 级交互硬伤（#4 #5 #10 #12 #13 #21）。这些 issue 的共同点是：每条都看似 cosmetic，但其中 4 条（#10 #12 #21 #13）现在都有 patch 兜底的诱惑（`onMouseDown` 兜底、防抖、`z-50` 强提、`padding` hack），用户 2026-05-02 明确锁定**禁止 patch / 兜底 hack，必须 runtime 调试到底找真因**。

以下是各 issue 的现状与已知信号（来自代码审视，不是猜测）：

- **#10/#12 双击**：`PeerWorkspaceNav` 用 `<a href={workspaceHref(key)}>` + `onClick={preventDefault + onSelect(key)}`（`Header.tsx:511-535`）；`SettingsTabNav` 用 `<button onClick={() => onTabChange(key)}>`（`SettingsTabNav.tsx:60-63`）。两个组件实现路径完全不同，但症状一致（首次点击没生效，第二次才切）。**这意味根因可能不同源** — 不能假设两边同因，必须分头查。
- **#21 Tasks tab 激活后折叠手柄被吃 click**：`PanelCollapseHandle` 在 `AppLayout.tsx` 内是 `absolute top-1/2 z-30 -left-3`（`AppLayout.tsx:35-52`），位于 right panel 容器**外侧**（负偏移 `-left-3`）。RightSidebar Tasks tab 内的 Plan/Outputs subtab 都用 `forceMount` + `overflow-y-auto`（`RightSidebar.tsx:163-192`），三层嵌套滚动容器。怀疑：subtab 的 `overflow-y-auto` 容器创建了滚动 stacking context，把外部负偏移的 handle 视觉拉进了它的 clipping region；或者 `forceMount` 使所有 subtab 同时挂载、即使非 active tab 也参与 hit-test。
- **#13 Notification badge 裁切**：`NotificationCenter.tsx:62-68` 的 Badge 是 `absolute -top-1 -right-1`（落在父 `<Button>` 之外）；Header 右栏容器 `Header.tsx:204-206` 是 `flex ... overflow-hidden`。父 overflow-hidden 直接裁掉 badge 的负偏移外延。
- **#5 ArrowDown 不 scrollIntoView**：`ChatInput.tsx:225-235` `setSlashIndex((i) => (i + 1) % filteredSlash.length)` 改 index，但渲染层 `filteredSlash.map((cmd, i) => <button ...>)`（`:310-336`）没有 ref 跟踪 active 行；mention menu 同 bug（`:262-289` + `:347-380`）。
- **#4 Settings collapse 按钮**：用户已拍板移除整个按钮，不是改 icon。

## Goals / Non-Goals

**Goals:**

- 6 条 issue 各自找到真实根因并修复，所有修法与 spec scenario 在 commit 中一致。
- 立 4 条 shell 级交互不变量（spec scenario）：单击导航、折叠手柄可达、badge 不裁切、kbd nav 滚动。
- 移除 SettingsTabNav 折叠按钮 + 相关 props，同步 `settings-workspace-presentation` spec 删去（如有相关 scenario）或新增 NOT-allowed scenario。
- Live verify 脚本：navbar 6 tab + Settings 4 tab 各 single-click → URL & 视觉同步切换；slash menu 长 list ArrowDown / ArrowUp 跟随；通知 badge 在浅色 + 暗色双主题不裁切；Tasks 子 tab 任意激活时 collapse handle 仍可点。

**Non-Goals:**

- 不改 RightSidebar IA（thread / mode / tasks 重构属桶 5）。
- 不改右栏 Tasks subtab 数量或语义（属桶 5）。
- 不改 Notification 入口位置（迁到 status bar 属桶 5）。
- 不改 URL routing 协议（仅在确认 #10 根因落在 useUrlSync 时序时修对应 race，不重写 SSOT）。
- 不引入 a11y 新规则（只满足现有 baseline）。

## Decisions

### D1. #10 / #12 双击根因诊断按"独立两路"调查，不假设同因

**做法**：

1. **#10 (PeerWorkspaceNav)** — `<a href> + preventDefault + onSelect()`：
   - 候选 1：`activateWorkspaceLink` 调 `event.preventDefault()` 后 `onSelect(key)`。`onSelect` 路由到 `App.tsx` 改 `activeWorkspace`；同时 `useUrlSync` `useEffect` deps 含 `workspace`，会 push/replaceState。怀疑：`useSyncExternalStore` snapshot 在 click 同帧内被 popstate handler 重新解析，把 URL 状态 hold 在原 workspace。验证手段：在 `useUrlSync` 的两处 `applyParsedRef.current()` 加临时 `console.log('apply', parsed.workspace, snapshot)`，对照点击流；同时打 `onSelect` 入口日志看序列。
   - 候选 2：anchor focus 抢占 — click 后浏览器把 focus 落到 anchor，触发 `:focus-visible` 重渲，session state 还没落地就被 React 18 batch 推走。验证：临时把 `<a>` 改 `<button>` 看是否消失。
   - 候选 3：`onClick` 触发但 `activateWorkspaceLink` 走了 modifier guard 返回（`event.button !== 0` 等）— 不太可能因为 release `.app` 普通 click button=0，但 verify 一遍。
2. **#12 (SettingsTabNav)** — `<button onClick={onTabChange}>`：
   - 候选 1：`SettingsPage` 的 capture-phase Escape handler（per ui-office CLAUDE.md "SettingsPage 用 capture-phase Escape handler"）误吞 click。验证：在 capture handler 里加日志看是否 stop。
   - 候选 2：`useSettingsWorkspaceController` 在 reinitializing 时把 `onTabChange` no-op 化。验证：log controller `isReinitializing` 状态。
   - 候选 3：`SettingsTabNav` 内某 prop 改变触发 nav 整个 re-mount，按钮 click 在 unmount 中丢。验证：在 nav 顶层 `useEffect(() => console.log('nav mount'))` 看挂载次数。

**Why** 不一次给"通用 fix"：用户已锁定不允许 patch / 兜底；两个组件实现路径不同，必须分别证明真因。如果调查后发现真同源（如同一 reducer race），合并修；否则保留两个独立修复点。

**Alternative rejected**：「先加 onMouseDown 兜底再说」— 用户明确禁止。「全局 click 防抖」— 同禁止。

### D2. #21 折叠手柄被吃 click：DOM/event-path 优先，不 z-index 暴力提

**做法**：

1. 用 Chrome DevTools `Inspect element` 点 handle 区域，看 hit element 实际是谁（是 handle 自身还是某 subtab 容器）。
2. 检查 RightSidebar `forceMount` subtab 容器 `<TabsContent value="plan" forceMount className="...overflow-y-auto custom-scrollbar...">` 是否被 Radix Tabs 实现成 `position: absolute` overlay；查 ui-core/Tabs 的 forceMount 行为。
3. 验证 stacking context：handle 是 right panel 的兄弟（`<PanelCollapseHandle />` 在 `AppLayout.tsx:292-298` 与 panel 容器 sibling），`z-30`；查 panel 容器内有无 `transform` / `filter` / `will-change` 创造新 stacking context。
4. 确认 `overflow-hidden` 链：`AppLayout.tsx:269-271` panel 容器有 `overflow-hidden`，handle `-left-3` 是负 offset；handle 是 panel 容器的 **sibling**（不是 child），按理不应被 panel `overflow-hidden` 裁切。但若 React tree 中 handle 被错误嵌进了 panel inner，会被裁切。

**修法**：定位真因后，用最小改动消除根因 — 例如：把 handle 移出 sibling 关系到一个独立 `position: relative` 父；或调整 RightSidebar Tasks subtab 容器，让非 active subtab 的 `forceMount` 容器 `pointer-events-none`（这是产品上正确的行为：非 active tab 不该接受 hit-test）。

**Alternative rejected**：「`z-50` 强提 handle」— patch 不是根因；「全局 `pointer-events-none` 加在 panel」— 会破坏 panel 内交互。

### D3. #13 Notification badge：内联化渲染 + 解 Header 右栏 overflow 锁

**做法**：

- 把 Notification Bell 与 unread badge 一起包进一个 `relative` 容器，badge 改用 `inline ring`（在 Bell 图标右上角内嵌一个小红点+数字 chip，不再用负 offset 跑出 button 边界）；或保留负 offset 但在 Bell button 自己上加 `overflow: visible`（CSS）+ 删除其上层容器的 `overflow-hidden`（Header 右栏的 `overflow-hidden` 是为了阻止水平溢出推动布局，可以改成 `overflow-x: clip` 或单独限制水平方向）。
- **推荐内联 ring 改造**：更稳，不依赖 ancestor overflow 设置。Badge 视觉重设计为 12-14px 圆角 chip，落在 Bell icon `<svg>` 的 padding 内，无负 offset。
- 浅色 + 暗色双主题 verify。

**Why**：依赖 ancestor overflow 是 CSS 脆性约束 — 任何上层加 `overflow-hidden` 都会再次裁切。inline ring 是结构性修复。

### D4. #5 Slash / mention menu kbd nav `scrollIntoView`

**做法**：用 `useRef` 数组（`slashItemRefs.current[i]`）或单 ref 跟踪 active 项；`useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest' }); }, [slashIndex])`；同 mention menu。

**Alternative rejected**：用 `requestAnimationFrame` 推迟 — 没必要，React 18 commit 后 ref 已就位。

### D5. #4 Settings collapse 按钮直接移除（用户拍板）

**做法**：

1. `SettingsTabNav.tsx`：删 `collapsed` / `onToggleCollapse` props；删 `verticalCollapsed` 派生；删整段 `{!horizontal && onToggleCollapse && (<button>...)}`。
2. 调用方（`SettingsPage` / `SettingsWorkspaceSurface`）：删传递的 `collapsed` / `onToggleCollapse` 与对应 state。
3. `useSettingsWorkspaceController` 如有 collapse 相关 state，删除。
4. `settings-workspace-presentation` spec：如已记录 collapse 行为则删去；否则新增 NOT-allowed scenario `Settings tab nav SHALL NOT render a collapse toggle button`。

**Why**：workspace 级折叠手柄已存在（左 rail），Settings 内层折叠是冗余视觉；视觉上 `<` 又与 back 混淆。删比改图标更彻底。

### D6. 单击导航不变量的覆盖范围

**Spec scenario** 必须覆盖：
- Header peer workspace nav（6 tab）
- Settings tab nav（4 tab）
- 任意"同模式 button + onClick" 模式不允许引入双击需求

**Not covered (out of scope of this change)**：
- Personnel tabs（属桶 7）
- SOP nodes / canvas 操作（属桶 6）
- Market filter chip（属桶 9）

这些桶各自承接自己的单击保证；但本桶的 spec scenario 是 shell 级，措辞用 `Header peer workspace nav` 与 `Settings tab nav`，不绑定全部 UI 控件。

## Risks / Trade-offs

- **根因可能多源** → 不能假设 #10 与 #12 同因；分两条独立调查路径。Mitigation：在 tasks.md 拆成独立步骤，各自有 verify hook。
- **#21 修法可能涉及 RightSidebar 内层 Tabs 行为变更** → 风险是改坏 chat ↔ tasks tab 切换时的 state 保留。Mitigation：spec scenario 显式保留"切回 chat tab 时 chat 状态保留"，回归 verify。
- **inline ring badge 视觉与现有 design system 偏差** → 需要 Badge variant 扩展或新组件。Mitigation：在 ui-core 内做最小 variant 扩展，不破坏现有 Badge 用法。
- **scrollIntoView 行为在 macOS reduced motion 下** → smooth scroll 可能不生效；用 `block: 'nearest'`（默认 instant）规避。
- **删 SettingsTabNav collapse 后**视觉密度变化 → 左栏永远 224px，desktop OK；narrow 走 `orientation='horizontal'` 路径，本来就没 collapse，无影响。

## Migration Plan

无 schema / API 迁移。前端纯组件层修复。回滚：`git revert` 即可。

## Open Questions

- **#10 / #12 真因合并 vs 分修** → 等根因诊断 task 跑完再定。如果两边证明同源（如同一 SyncExternalStore race），合并写一个修复 + 一份 spec scenario；否则两份独立。
- **Notification badge inline ring 设计稿** → 如视觉差异大，需要在 ui-core/Badge 加新 variant；如视觉差异小，本组件内 inline 实现即可。Tasks.md 中暂设为 component-local 实现，verify 后视觉再决定是否上提。
- **RightSidebar Tasks subtab 是否在桶 1 顺手做"非 active forceMount → pointer-events-none"** → 如果是 #21 真因，必须做（这就是修法）；如果不是，留给桶 5。tasks.md 标注待诊断后再定。

## Diagnosis (2026-05-03 — evidence-driven, second pass)

第一轮 hypothesis（fallback 路径在 workspace 切换时 revert）经 release `.app` Computer Use verify + diag instrumentation 确认**错误**。完整 trace 见 `Docs/handoff/shell-interaction-baseline-verify.md` §3。

**真因**：`apps/web/src/lib/url-routing/useUrlSync.ts` 用 `useSyncExternalStore(subscribeLocation, locationSnapshot, ...)` 跟踪 `window.location`。`subscribeLocation` 只监听 `popstate`，但我们自己 `window.history.pushState(...)` 改了 location 后 popstate 不触发；React 在下一次 re-render 时通过 `getSnapshot` 检测到与缓存 snapshot 的 drift（cached `'/'` vs current `'/sops'`），然后触发 `[enabled, snapshot]` 依赖的 input-side effect。该 effect 用 stale snapshot URL 调 `applyParsed(parsed)`，`applyParsed` 又调 `setActiveWorkspace(parsed.workspace)` — **把刚 set 的新 workspace 又拉回旧 workspace**。

证据时序（trace 第 2 次点击 sops → market）：
1. t=42421 `setActiveWorkspace reducer` (sops → market)
2. t=42421 `App render activeWorkspace='market'`
3. t=42428 `useUrlSync popstate effect snapshot='/sops' parsedWorkspace='sops'` ← React drift detection 触发的 effect，snapshot 是上次 push 留下的 stale
4. t=42440 `App render activeWorkspace='sops'` ← reverted

**奇偶规律**：每隔一次点击失败 — 第 N 次成功（snapshot drain），第 N+1 次失败（新 drift），第 N+2 次成功。Settings tab 切换走 `updateWorkspaceState` 而非 `setActiveWorkspace`，但同样被 `applyParsed` 的 sessionPatch merge 覆盖（trace 第 6 次点击 SettingsTabNav runtime 后 popstate effect 用 stale `/settings/provider` 把 `activeTab` merge 回 provider）。

**修法**（已落地，见 `useUrlSync.ts`）：
- 删 `useSyncExternalStore(subscribeLocation, locationSnapshot, ...)`。
- 改成手动 `useState(0)` + `useEffect` 注册 `popstate` listener，listener 触发时 `setPopstateRev((n) => n + 1)`。
- input-side effect 依赖 `[enabled, popstateRev]`，**只有真 popstate 才会让 effect 触发**；我们自己的 pushState 不再制造 phantom drift。
- 初次 mount 跳过（`if (popstateRev === 0) return;`）— 初始 state 已由 `parseInitialUrl()` 在 `useState` initializer 里建立。

**Why this fix is structural, not patch**：snapshot drift detection 不是产品意图（input-side 的 fallback 应只在外部 URL 变化时跑，不在我们自己 push 后跑）。`useSyncExternalStore` 在这个 case 里被错误使用——它适合 store 通知器自带 listener 的场景，而 history pushState 不通过 popstate 通知。手动 popstate listener 是 history API 的正确消费方式。

**Spec 合规**：未引入 `onMouseDown` / debounce / `setTimeout` / capture-phase blocker。

## Diagnosis (2026-05-02 — static read first pass, REJECTED)

主 session 不能 live drive Tauri release `.app`（per user `feedback_no_computer_use_for_verification`），因此 1.x 的 runtime instrumentation 与 verify 由用户驱动；本节固化静态读得到的 candidate 结论，作为 `3.x` / `4.x` 修复落地的依据。

### #10 / #12 结构性 candidate（合并修一处）

**真因 candidate**：`apps/web/src/lib/url-routing/useUrlSync.ts` 第三个 effect（`[activeCompanyId, enabled, overlay, runtime, sessionState, workspace]`）把 input 修正（fallback for stale URL entity）与 output serialize（push new URL）压在同一个 deps 集合里。当用户点 workspace tab 触发 `setActiveWorkspace(newKey)`，effect 因 `workspace` dep 变化触发 → 读 `window.location`（仍是 OLD URL）→ 跑 `applyFallbackRules(currentParsed, ...)` → 若 OLD URL 含失效实体（personnel `selectedEmployeeId` 不存在 / sops `selectedSopId` 不存在 / market `selectedListingId` 不存在 / studio overlay company missing 等），`!parsedEquals(currentParsed, fallback.result)` 命中 → `applyParsedRef.current(fallback.result)` 调 `applyParsedUrl` → 把 `activeWorkspace` 回滚到 OLD workspace。结果：用户视觉感知"第一次点击没生效"，第二次点击因 fallback 已经在第一次跑完后修过 URL（replaceState 覆盖了 stale entity），第二次的 effect 走到 serialize 分支，URL push 成功，UI 切换。

**为什么 #10 (`<a href>`) 与 #12 (`<button>`) 同源**：根因不在 click handler（`activateWorkspaceLink` 与 `onTabChange` 两条路径均简洁、均同步），而在状态传播链尾端 `useUrlSync` 的 fallback 分支。两个组件 click 触发的最终 `setActiveWorkspace` 调用完全相同，落地到 useUrlSync 的 effect 路径也完全相同。

**Settings (#12) 额外路径**：Settings tab 切换走的是 `updateWorkspaceState('settings', updater)`（修 `sessionState.settings.activeTab`），不直接动 `activeWorkspace`，但 `sessionState` 也在第三个 effect deps 里，同样触发 fallback 路径。逻辑一致。

**修法（D1 收束）**：拆分 input fallback 与 output serialize 成两个独立 effect：
1. **Fallback effect**：deps `[activeCompanyId, enabled, runtime]`（不含 workspace / sessionState / overlay）。当 input data（agents / companies / activeCompanyId）变化时，读 `window.location`，决定是否对 stale URL 做 replaceState + applyParsed。`sessionState` 通过 ref 拿。
2. **Serialize effect**：deps `[activeCompanyId, enabled, overlay, sessionState, workspace]`（不含 runtime）。当 output state 变化时，serialize 当前 state 成 URL，与 `locationSnapshot()` 对比，必要时 push/replace。**不再读 window.location 跑 fallback。**

**为什么不是 patch / fallback hack**：本修法删除了 effect 内部的 conflated re-entrancy，是结构性修复。即使 candidate 不是 100% root cause，refactor 本身正确（fallback 不应在 output 路径触发）。

**Alternative rejected**：在 effect 顶部加 `if (workspace !== prevWorkspace) skip fallback` 守卫 — patch 性质，掩盖结构问题，仍可能在其他 dep 变化时漏触发。

### #21 结构性 candidate（暂未确定，diag-only）

**已排除**：
- handle 是 outer container 的 absolute 子节点，sibling of inner `overflow-hidden` div；CSS-wise outer 无 overflow:hidden，handle 不被裁切。
- `TABS_RETAIN_STATE_CLASS = data-[state=inactive]:hidden` 已让非 active forceMount panel 走 `display: none`，不参与 hit-test，不可能拦截。
- `PitchHall` / `TaskDashboard` / `ActivityRail` 均无 `position: absolute` / `position: fixed` / `position: sticky` 元素，不会脱出 panel 边界。
- ChatDrawer 在 office workspace 下右边 offset = `right-rail-width + sp-lg + sp-md`（chat drawer 右沿离 handle 左沿仍有 ~13px），不与 handle pixel 相交。
- KanbanTray 是 header 下方 absolute z-40 slot，仅在 expanded 时占空间，不与右栏 handle 同 x。
- Radix Tabs forceMount 不引入额外 DOM 包裹（仅加 `data-state` 属性），无 absolute / transform 创建 stacking context。

**仍未排除**（需 runtime DevTools 确认）：
- 浏览器 / Tauri webview 的 hit-test 在 `position: absolute -left-3` + parent `relative` + sibling `overflow-hidden inner` 组合下是否有边界 quirk。
- 是否有第三方组件 (Suspense fallback / WorkspacePageSkeleton / OnboardingTour overlay / NotificationCenter dropdown) 在 Tasks 激活后 mount 出 absolute 元素覆盖 handle 列。
- `custom-scrollbar` CSS 是否在 active subtab 显示出可点滚动条占用 handle 列像素。
- Tauri WebView 中 `transform: translate(-50%)` (handle 用了 `-translate-y-1/2`) 是否触发某种 hit-test 边界精度问题。

**修法（D2 暂停）**：本桶**不**对 #21 落 fix。仅在 `apps/web/src/lib/diag-flag.ts` 加 `?diag=shell` query flag → AppLayout `PanelCollapseHandle` 在 flag 开启时打 `console.log` + 加 outline；用户开 release `.app` 加 `?diag=shell` query 参数 reproduce 后回报 console + 截图。下个 cycle 再落 fix。

**为什么不强 ship 假设性 fix**：spec scenario 明确禁止 `z-50` 暴力提，而 design.md candidate 列出的两条 (`pointer-events: none` on inactive forceMount / 移 handle out of clipped sibling chain) 在静态读后都已被排除（前者已是默认行为，后者无 sibling 裁切证据）。**没有 defensible candidate 的情况下盲改即是 hack**。诚实保留为 follow-up cycle，比强 ship 一个 patch 更符合"必须找根因"约束。
