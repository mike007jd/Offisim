## Why

`apps/web/src/App.tsx` 现在 794 行，把 10+ 职责塞在一个组件里：overlay 状态机、office state bindings、keyboard shortcuts、company lifecycle（create / archive / switch / wizard / studio / deploy）、deep-link install、onboarding copy 解析、toast 组合、9 个 lazy overlay 的 render、5 个 global dialog 的 render、AppLayout 主干组合。这是 D 系列"屎山重构"里剩下的第二块（D1 `useSceneOrchestrator` 已 archived）。

单文件 794 行 = 一 surface 里 13 个 `useState` + 9 个 `useEffect` + 20+ handler；对应的风险：(1) 任何一个 handler 新增依赖都在同一份 `useCallback` 依赖列表里改动，回归面很大；(2) overlay/company lifecycle/keyboard 这些职责没有物理边界，下次加 workspace 或 overlay 只会往里塞；(3) AppLayout render tree 被一堆控制流打碎在同文件里，读一遍要 5 分钟。符合 CLAUDE.md "警惕屎山热点：超长文件、双状态源、跨层事件拼装、巨型组件/服务默认视为风险面"。

## What Changes

- 把 `App.tsx` 变成 thin composition shell：只做 hook/子组件组装 + `AppLayout` render tree；**目标 ≤200 非空非注释行**
- 新增 5 个单职责 hook（不改 observable behavior，只重新分组现有逻辑）：
  - `hooks/useOverlayState.ts` — `activeOverlay` state + overlay open/close helpers
  - `hooks/useCompanyLifecycle.ts` — wizard completion / selectCompany / createYourOwn / studioCompanyCreated / archiveCompany / creatorDeploy / saveConfig 等 company-scoped handler 全搬进来
  - `hooks/useCompanyBootstrap.ts` — company switch → overlay reset / template load / portal preview sync / `PENDING_VIEW_KEY` studio-edit 引导 / event log prime 这几个耦合 `activeCompanyId` 的 `useEffect`
  - `hooks/useOfficeStateBindings.ts` — `updateOfficeState` + `onViewModeChange` + `onSceneFallbackTo2D` + `handleToggleDashboard/Kanban` + `onLayoutMetricsChange` + `handleSelectEmployee` + `handleUserMessage`
  - `hooks/useAppKeyboardShortcuts.ts` — L270-333 键盘快捷键 `useEffect`（Cmd+D / Cmd+J / Cmd+1 / Cmd+E / Cmd+/ / Escape unwind）
- 新增 2 个 render-only 组件，抽走重复的 overlay/dialog render：
  - `components/app-shell/AppOverlayHost.tsx` — 6 个 overlay 分支（employee-creator / office-editor / company-select / studio / dashboard / kanban / marketplace detail）
  - `components/app-shell/AppGlobalDialogs.tsx` — install dialog / company editor / employee editor / keyboard shortcuts / CompanyCreationWizard（populate-existing + create-new 两路）
- 不引入 provider context、不引入全局 store、不拆 public 导出；`App` 组件仍是 `apps/web/src/main.tsx` 唯一 importer，签名 `(props: AppProps) => JSX.Element` 保持一致
- 不改 observable behavior：`unified-shell-routing` 和 `workspace-state-management` 已约束的所有 scenario 必须继续 pass；本次新增 spec 只补 **结构边界**

## Capabilities

### New Capabilities

- `web-app-shell-boundaries`: App.tsx 作为 web SPA shell composition root 的职责边界 — 文件大小 ≤ 200 行、不持有与 overlay/company-lifecycle/keyboard/office-state 相关的内联逻辑、拆出去的每个 hook 单一职责且不互相 import、overlay/dialog render 集中在 2 个 render-only 组件

### Modified Capabilities

（无 — `unified-shell-routing` 和 `workspace-state-management` 的 requirement 保持不变，本次重构必须在不触发 spec diff 的前提下完成结构拆分）

## Impact

- **代码**: `apps/web/src/App.tsx`（794 → ≤200 行），新增 5 个 hook 文件 + 2 个 render-only 组件
- **不影响**: `apps/web/src/main.tsx`（唯一 importer）、`packages/ui-office/*`、`packages/core/*` 全链路 API
- **构建/依赖**: 无新依赖；`apps/web/vite.config.ts` 无须动
- **回归面**: 由于 `useOffisimRuntime` / `useCompany` / `useWorkspaceSessionState` 等 public hook 继续在 App 组件顶层调用，hook 调用顺序必须 **byte-identical** 保持，避免 React 报错。新 hook 内部 `useState` / `useEffect` 顺序与 pre-refactor 一一对齐
- **验证**: live Playwright 跑同 prompt 对比 pre/post 的（a）keyboard shortcuts（Cmd+D / Cmd+J / Cmd+1 / Escape unwind），（b）company-select → enter / create-new / archive / studio-edit flow，（c）overlay open/close，（d）上 `/opsx:apply` 后 workspace 切换（Office ↔ Settings ↔ Market）无 remount 异常
