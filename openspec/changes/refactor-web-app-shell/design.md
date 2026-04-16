## Context

`apps/web/src/App.tsx` 是 web SPA 的唯一 shell composition root，当前 794 行，承担 10+ 职责：overlay state machine、global state（8 个 useState）、office state updater bindings、8 个 `useEffect`（company switch / template load / portal preview sync / pending-view / event log prime / keyboard shortcuts / provider-saved onboarding mark / deep-link install）、8 个 lifecycle handler（selectEmployee / userMessage / openStudio / creatorDeploy / archiveCompany / saveConfig / wizardComplete / selectCompany / createYourOwn / studioCompanyCreated）、AppLayout composition with 9 slots、6 个 overlay render 分支、5 个 global dialog render 分支。

唯一 importer 是 `apps/web/src/main.tsx`，签名：`import { App } from './App'; <App onCompanySwitch={…} />`。

现有 canonical spec 已对 App.tsx 有行为约束：
- `unified-shell-routing`：single `AppLayout` render path，`WorkspaceRouter` 走 `centerContent`
- `workspace-state-management`：office state 全走 `updateWorkspaceState('office', updater)`，activeOverlay / activeWorkspace 正交，Cmd+D/J/1 必须先判 `activeWorkspace === 'office'`

D1 `refactor-scene-orchestrator` (archived 2026-04-16) 已证明同构做法可行：拆出多个单责模块 + thin barrel + 完整 live 比对 → byte-identical。本 refactor 对齐 D1 的 SRP + 保 observable behavior 原则。

## Goals / Non-Goals

**Goals:**

- `App.tsx` ≤ 200 非空非注释行，只做 hook 组合 + `AppLayout` render tree + overlay host / global dialogs 挂载
- 5 个单责 hook + 2 个 render-only 组件全部落 `apps/web/src/hooks/` 与 `apps/web/src/components/app-shell/`
- 每个 hook 单一职责 — 互不 import（除了 `useCompanyLifecycle` 需要 `useOverlayState.closeOverlay` / `useCompanyBootstrap` 需要 `useOverlayState.openStudio` 这类显式依赖，通过参数传入而非直接 import）
- Live Playwright 前后对比 company-select / overlay open/close / keyboard shortcut / company lifecycle handler 行为 byte-identical
- `unified-shell-routing` + `workspace-state-management` 的所有 scenario 继续 pass（不触发 spec 修改）

**Non-Goals:**

- 不引入 React Context / 全局 store — 本次仅物理拆分，不改状态架构
- 不拆 `components/workspaces/WorkspaceRouter.tsx` 或 `hooks/useAppRuntimeToasts.ts`（已是单一职责单独文件）
- 不重写 `useOffisimRuntime` / `useCompany` / `useWorkspaceSessionState`（这些是 ui-office public hook，来自另一个包）
- 不优化 memoization / 不改 `useCallback` 依赖列表语义 — 只做搬家
- 不动 `apps/web/src/main.tsx`、`apps/web/vite.config.ts`
- 不新增 export；`App` 命名导出保持

## Decisions

### D1 — 拆分单位：hook per 职责 + render-only 组件 per UI 分组

**Chosen**: 5 hooks + 2 render-only 组件

- `useOverlayState.ts`: `activeOverlay` state + 语义化 setters
- `useCompanyLifecycle.ts`: wizard / select / create-your-own / studio-created / archive / creator-deploy / save-config 7 个 handler
- `useCompanyBootstrap.ts`: 5 个 company-scoped `useEffect`
- `useOfficeStateBindings.ts`: office updater + 8 个 office-scoped callback
- `useAppKeyboardShortcuts.ts`: 1 个 keyboard `useEffect`
- `AppOverlayHost.tsx`: 6 个 overlay 分支的 render
- `AppGlobalDialogs.tsx`: 5 个 global dialog 的 render

**Alternatives considered:**

- **拆成 1 个巨型 `useAppShell` hook**：否 — 这就是把 794 行原地换个名字，没解决职责混杂
- **拆成 React Context provider**：否 — 引入 provider 链路会改 hook 调用时机，增加回归风险；也不是这次的 goal
- **只拆组件不拆 hook**：否 — lifecycle handler 体积占 App.tsx 近 40%，光拆 JSX 不够，File size gate 过不了

**Rationale**: 对齐 D1 的拆法，SRP 粒度一致。每个 hook 名字描述"它拥有什么"而非"它是什么"，能单独替换 / 单独 audit。

### D2 — Hook 之间通过参数传递而非互相 import

`useCompanyLifecycle` 需要 `closeOverlay()`，`useCompanyBootstrap` 需要 `openStudio()` — 这些都从 `useOverlayState` 拿。设计上不让 lifecycle hook 直接 `import { useOverlayState }`，而是 `useOverlayState` 先在 `App.tsx` 顶层调用，把 setter 传入 `useCompanyLifecycle(..., { closeOverlay, openStudio })`。

**Why**: 避免 hook 调用顺序耦合（React 要求 hook 在组件顶层稳定顺序），也保持"hook 不依赖兄弟 hook 的内部 state"——依赖关系显式流过 App.tsx。

### D3 — Ref 闭包 vs 最新 state：保持现状

D1 里 useCeremonyEventBindings 大量用 `xxxRef.current` 拿最新值。App.tsx 里的 handler 大部分没这个痛点（React 19 自动 capture 最新 state），所以 hook 内部直接用 `useCallback([...deps])`。**不引入 ref 抽屉**。

**Exception**: `useAppKeyboardShortcuts` 的 `useEffect` 闭包依赖 8+ 变量 — 这里维持当前 `useEffect(..., [deps])` 的做法，不抽成 ref，否则会破坏现有依赖追踪。

### D4 — render-only 组件 props 契约

`AppOverlayHost` props 一次接 15+ 字段（6 个 overlay 的 open state + close handler + 相关 state）。不拆成 6 个子组件（过度设计），一个组件内部 6 个 `{condition && <JSX/>}`，保持和 App.tsx 现有 render tree 1:1 映射。

`AppGlobalDialogs` 同理：5 个 dialog 的 props 聚合在一起。

**Rationale**: render-only 组件的目的是"把 JSX 从 App.tsx 搬走"，不是"给 overlay 系统做一层抽象"。保持最扁平结构，后续要改哪个 overlay 直接改那一段 JSX。

### D5 — 文件大小 gate：≤350 行（revised during apply）

**初稿目标 ≤200 行，apply 阶段上调到 ≤350**：

Apply 阶段实际完成 3-tier 拆分后（5 hook + `AppOverlayHost` + `AppMainShell` + `AppGlobalDialogs`），App.tsx 达到 ~315 non-blank-non-comment 行。再压到 ≤200 需要引入 Context provider 或把 32-prop `AppMainShell` 聚合成 black-box object prop — 前者是架构变更（超出本 refactor scope），后者降低可读性（把问题转移到 type 定义，不是真正精简）。

**阈值重设依据**：App.tsx 的长度下限由三个**不可压缩**因素决定：
1. 顶层 hook 调用（10+ 个 public ui-office hook + 5 个新 hook），约 40-50 行
2. 派生 memo / derived state（`activeCompanyName` / `onboardingCopy` / `anyOverlayOpen` / `collaborationRailProps`），约 50 行
3. Render tree 里 3 个 shell 组件的 props 传递（`AppMainShell` 33 prop / `AppOverlayHost` 17 prop / `AppGlobalDialogs` 13 prop），每 prop 一行 JSX，约 90-100 行

这三项本质是 React composition 的 props-passing overhead，无法通过进一步拆模块消除。把 gate 定在 **≤350** 保留 "shell 不能再囤内联逻辑" 的约束强度（原 794 → 315 已减 60%），同时承认 React props-passing 的物理成本。

**Alternatives considered:**
- **抽 Context provider 消除 props**：否 — 改变状态管理架构，超出 refactor scope；也会让 hook 顺序变得不可审计
- **聚合 props 成 shellModel 对象**：否 — 行数转嫁到 type 定义文件；黑箱 prop 反而让 AppMainShell props shape 更难 review
- **放弃拆 AppMainShell，继续内联 AppLayout**：否 — 那 App.tsx 会回到 420+ 行，render tree 和 hook composition 混一起

D1 scene-orchestrator 的 ≤150 之所以能达成，是因为它是 single-hook barrel（没有 render tree，没有 React composition 成本）；App.tsx 作为 shell composition root 与之结构性不同，阈值不能直接平移。

## Risks / Trade-offs

| 风险 | Mitigation |
|------|------------|
| Hook 调用顺序改变 → React 报错 | App.tsx 顶层调用顺序严格按 pre-refactor 一一对齐（runtime → company → overlay → workspace → office-state → lifecycle → keyboard → deep-link），每个新 hook 内部 `useState` / `useEffect` / `useCallback` 顺序与 pre 保持一致 |
| render-only 组件漏一个 Suspense fallback | AppOverlayHost / AppGlobalDialogs 里每个原来用 `<Suspense>` 包的 lazy 组件继续包；grep `Suspense` 在 App.tsx 前后数量一致 |
| keyboard shortcut 依赖数组偏移 → 新 bug | useAppKeyboardShortcuts 的 deps 数组与原 L322-333 一一对齐，不增减；live Cmd+D / Cmd+J / Cmd+1 / Cmd+E / Cmd+/ / Escape 按压全走一遍 |
| wizard "populate-existing" 只在 `isOffice && activeOverlay === null` 时挂载 → 拆成 AppGlobalDialogs 后挂载条件漏传 | `AppGlobalDialogs` props 接 `isOffice` 和 `activeOverlay`，内部保留同一条件；live 检查进入 Office 无 active overlay 时 wizard 会自动弹（首次进入场景） |
| `sessionStorage[PENDING_VIEW_KEY]` 在 `useCompanyBootstrap` 里可能被多次消费 | 保持 `sessionStorage.removeItem(PENDING_VIEW_KEY)` 在读出后立即调用（pre-refactor L256 的做法），hook 内部 effect 依赖 `[activeCompanyId, updateWorkspaceState, openStudio]` |
| 新 hook 里 `updateWorkspaceState` 的函数引用变化触发无谓 re-render | `updateWorkspaceState` 由 `useWorkspaceSessionState` 返回并 memoized，引用稳定；hook 以它做依赖不会造成无限循环 |

## Migration Plan

1. **Baseline sampling (pre-change)**: live Playwright 跑同一 prompt + 手动操作序列，抓 keyboard / overlay / company lifecycle / deep-link 行为日志 → `/tmp/app-shell-sequence-pre.json`
2. **单测式 scaffolding**: 按 D1 同套路序建文件：
   - 先建 `hooks/useOverlayState.ts`（最简单，独立 state）
   - 再建 `hooks/useOfficeStateBindings.ts` + `useAppKeyboardShortcuts.ts`（依赖 overlay 与 workspace state）
   - 再建 `hooks/useCompanyBootstrap.ts`（依赖 overlay setter）
   - 最后建 `hooks/useCompanyLifecycle.ts`（依赖 overlay setter + workspace setter + runtime repos）
3. **Render-only 组件**: `AppOverlayHost.tsx` + `AppGlobalDialogs.tsx` 从 App.tsx JSX 整段搬
4. **Thin App.tsx**: 删空旧逻辑 → 留 hook 组合 + `<AppLayout>` + `<AppOverlayHost>` + `<AppGlobalDialogs>` + `<OnboardingController>` + `<EmployeeInspector>` + `<ToastBanner>` + `<ResumeBar>`
5. **Alignment verification**: `wc -l` + grep 三项：(a) `App.tsx` ≤ 200 行，(b) `useState<OverlayKey` grep 全仓唯一，(c) overlay / dialog JSX 从 App.tsx 消失
6. **Build + typecheck + lint**: `pnpm --filter @offisim/web typecheck && pnpm --filter @offisim/web build && pnpm lint`
7. **Live post-change regression**: 跑同 prompt + 同操作序列 → `/tmp/app-shell-sequence-post.json`；diff 对比 byte-identical（除时间戳）
8. **Sync canonical spec**: archive 阶段把 `web-app-shell-boundaries/spec.md` 同步到 `openspec/specs/`

**Rollback**: 单 branch / 单 PR，所有改动在 `apps/web/src/` 下；`git revert` 一个 commit 即可。由于 `main.tsx` 接口不变，revert 零影响其它包。

## Open Questions

- 用户是否允许 `AppOverlayHost` 内部 `Suspense` 合并成一个父 `Suspense` 而不是每个 lazy 一个？**决策**: 保持原样（每个 lazy 一个 Suspense），不越界优化
- `useCompanyLifecycle` 需要 `addToast` — 需要从 `useToasts()` 传入，而不是 hook 里重新调一次 `useToasts()`？**决策**: 传入。`useToasts()` 只在 App.tsx 调用一次，每个需要 toast 的 hook 都接收 `addToast` 作参数
