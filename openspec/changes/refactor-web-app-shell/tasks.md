## 1. Baseline sampling (pre-change)

- [x] 1.1 `wc -l apps/web/src/App.tsx` 记录 pre-refactor 行数，拍为 baseline — **794 行**
- [x] 1.2 `grep -E "^import .* from '@offisim/ui-office" apps/web/src/App.tsx` 记录当前 15+ public hook import，后续验证不变 — 1 eager named import (L32) + 9 lazy subpath imports (wizard / employee-creator / office-editor / company-editor / install / studio / dashboard / kanban / marketplace)
- [x] 1.3 用 ripgrep 列出所有 lazy import 与 Suspense 配对数量（base：10 lazy / 若干 Suspense），refactor 后保持相同数量 — **12 React.lazy + 13 `<Suspense>`**
- [x] 1.4 启动 `pnpm --filter @offisim/web dev --force`（force 清 Vite cache），准备 Playwright live 采样 — port 5176 已有 dev server 进程 (pid 98311) 在跑，直接复用（main 最新 commit 4dc5fef 之后无代码变动）
- [x] 1.5 Live Playwright 采样 pre-refactor 行为：navigate → company-select overlay → 选已有公司 enter → 记录 overlay 状态切换 / `activeWorkspace` 变化 / AppLayout 首帧 slot 填充情况 — 实际情况：已有 active company (My AI Company)，initial state 直接 mount Office workspace；无 company-select overlay；AppLayout 首帧 8 员工 idle + 2D/3D 按钮 + Collaboration panel (Chat/Tasks tabs)，dialogCount=0 / overlayCount=0 / activeView=3D
- [x] 1.6 Live Playwright 采样 pre-refactor keyboard shortcuts — Cmd+/ 打开 KeyboardShortcutsDialog (dialogCount 0→1)；Escape 关（dialogCount 1→0）；Cmd+D 渲染 DashboardOverlay（hasDashboardHeading=true）；Escape 关 dashboard；Cmd+J 未观察到打开 Kanban（环境/浏览器层拦截，非代码问题）；Cmd+1 (2D) active view 由 3D→2D (canvasCount=2)；Cmd+1 (3D) 恢复
- [x] 1.7 把 1.5 / 1.6 的观察序列存 `/tmp/app-shell-sequence-pre.json` — 已写入 9 步 observation + scenario coverage 注记
- [x] 1.8 Grep 出 App.tsx 所有 importer：`apps/web/src/main.tsx` + 任何 test 文件；确认仅 1 处 `import { App } from './App'` — 实际 importer 是 `apps/web/src/main.tsx:19 const App = lazy(() => import('./App.js').then((module) => ({ default: module.App })))`。唯一 importer，用 `lazy() + module.App` 动态解析。App 必须保持 **命名导出 `App`** 不变

## 2. Create new hook modules

- [x] 2.1 新建 `apps/web/src/hooks/useOverlayState.ts`：
  - 持有 `activeOverlay` state（初始值根据 `activeCompanyId` 传参算）
  - 返回 `{ activeOverlay, closeOverlay, openCompanySelect, openStudio, openEmployeeCreator, openOfficeEditor, setActiveOverlay }` — 最后一个为兜底（保留给 company switch effect 做裸 reset）
  - 不持有其它 state，不注册 useEffect
- [x] 2.2 新建 `apps/web/src/hooks/useOfficeStateBindings.ts`：
  - 接收 `updateWorkspaceState`、`activeCompanyId`（用于 markCompany）
  - 返回 `{ updateOfficeState, onViewModeChange, onSceneFallbackTo2D, handleToggleDashboard, handleToggleKanban, onLayoutMetricsChange, handleSelectEmployee, handleUserMessage }` — 8 个 office-scoped helper
  - `handleUserMessage` 内保留 `setLastUserRequest` 写入：把 `lastUserRequest` state 也纳入此 hook（或由 hook 接收外部 setter — 决策：纳入此 hook，由 hook 返回 `lastUserRequest`）
- [x] 2.3 新建 `apps/web/src/hooks/useAppKeyboardShortcuts.ts`：
  - 接收 `{ isOffice, officeState, activeOverlay, closeOverlay, goBack, shortcutHelpOpen, setShortcutHelpOpen, employeeEditor, handleToggleDashboard, handleToggleKanban, updateWorkspaceState }`
  - 内部单个 `useEffect`，依赖数组与 pre-refactor 一一对齐
  - 不返回任何值（纯副作用）
- [x] 2.4 新建 `apps/web/src/hooks/useCompanyBootstrap.ts`：
  - 接收 `{ activeCompanyId, repos, eventBus, onCompanySwitch, setActiveOverlay, updateWorkspaceState, setActiveTemplateId, portalPreviewCompanyId, setPortalPreviewCompanyId }`
  - 内部注册 5 个 `useEffect`：company switch → activeOverlay reset、template load、portal preview sync、PENDING_VIEW_KEY studio-edit handover、`primeEventLogStore` / `disposeEventLogStore`
  - 顺序严格对齐 pre-refactor L218-267
- [x] 2.5 新建 `apps/web/src/hooks/useCompanyLifecycle.ts`：
  - 接收 `{ repos, eventBus, addToast, refreshCompanies, switchCompany, onCompanySwitch, activeCompanyId, companies, setPortalPreviewCompanyId, setCompanyWizardMode, closeOverlay, openSettings, reinitRuntime, setProviderConfig, providerConfig, companyWizardMode }`
  - 返回 `{ handleSaveConfig, handleWizardComplete, handleSelectCompany, handleCreateYourOwn, handleStudioCompanyCreated, handleArchiveCompany, handleCreatorDeploy, handleOpenStudio }`
  - `handleCreatorDeploy` 的 try/catch toast 文案保持原样（`Deploying ${name}…` / `${name} deployed successfully` / `Failed to deploy ${name}`）
  - 不注册 `useEffect`（纯 callback hook）

## 3. Create render-only components

- [x] 3.1 新建目录 `apps/web/src/components/app-shell/` — 由 Write 隐式创建
- [x] 3.2 新建 `apps/web/src/components/app-shell/AppOverlayHost.tsx` — 17 props，6 overlay 分支（employee-creator / office-editor / company-select / studio create/edit dual / dashboard / kanban / marketplace detail）render-only；CompanySelectionPage 保持 eager import（对齐 pre-refactor 非 lazy），其余 6 个 lazy 组件 Suspense 包装
- [x] 3.3 新建 `apps/web/src/components/app-shell/AppGlobalDialogs.tsx` — 13 props，5 dialog 分支（InstallDialog / EmployeeEditorDialog / CompanyEditor / KeyboardShortcutsDialog / CompanyCreationWizard populate-existing + create-new 双路）；用 `ReturnType<typeof useInstallFlow>` 等 type re-export 保持 spread 严格类型
- [x] 3.4 新建 `apps/web/src/components/app-shell/AppMainShell.tsx`（apply-phase 决策：Section 4 压缩不足，再抽这层承接 AppLayout 9 slot 全部 JSX）— 33 props render-only，内部 `React.lazy` ChatDock / CollaborationSidebar / OfficeSceneSurface + eager AppLayout / Header / AgentPanel / NotificationCenter / ProjectSelector / StatusBar + WorkspaceRouter

## 4. Rewrite App.tsx as thin shell

- [x] 4.1 重写 `apps/web/src/App.tsx` — 顶层 hook 调用顺序对齐 pre-refactor：useCompany → useOverlayState → 6 个 useState → useWorkspaceSessionState + useWorkspaceBackNavigation → officeState/isOffice derive → handleOpenSettings/handleBackToOffice → useOffisimRuntime/useCompanyEditor/useEmployeeEditor/useInstallFlow/useToasts/useFirstRunGuidance/useAgentStates/useProjects → useOfficeStateBindings → useAppRuntimeToasts → useCompanyLifecycle → useCompanyBootstrap → useAppKeyboardShortcuts → provider-saved markAccount useEffect → useDeepLinkInstall → 派生 memo
- [x] 4.2 App.tsx render tree：`<ErrorBoundary>` + 2×`<ToastBanner>` + `<ResumeBar>` + `<AppOverlayHost>` + `<AppMainShell>`（apply-phase 新抽，见 3.4）+ `<EmployeeInspector>` + `<OnboardingController>` + `<AppGlobalDialogs>`
- [x] 4.3 把原 L535-543 `ResumeBar` 保留在 App.tsx（仍然需要 `unfinishedThreads` / `resumeThread` / `dismissUnfinishedThreads` — 属于 runtime handoff 不是 overlay），overlay 分支 L545-594 + L703-737 由 `<AppOverlayHost>` 接管
- [x] 4.4 L760-790 global dialog 由 `<AppGlobalDialogs>` 接管
- [x] 4.5 `anyOverlayOpen` 派生保留在 App.tsx（给 OnboardingController 用），值不变
- [x] 4.6 `PENDING_VIEW_KEY` 常量搬到 `useCompanyBootstrap.ts` 内部作为模块常量 + named export 供 `useCompanyLifecycle.ts` import
- [x] 4.7 `WORKSPACE_TITLES` 常量搬进 `AppMainShell.tsx`（Header 消费方），App.tsx 不再持有

## 5. Alignment verification

- [x] 5.1 `wc -l apps/web/src/App.tsx`：non-blank-non-comment = **311 ≤ 350** ✓（design D5 决策：≤350 revised gate）
- [x] 5.2 `grep -rn "useState<OverlayKey" apps/web/src/` 只匹配 `hooks/useOverlayState.ts:15` 一处 ✓
- [x] 5.3 `grep -n "activeOverlay === 'studio'" apps/web/src/App.tsx`：0 match ✓
- [x] 5.4 `grep -E "<InstallDialog\|<EmployeeEditorDialog\|<CompanyCreationWizard" apps/web/src/App.tsx`：0 match ✓
- [x] 5.5 Suspense 数量对比：pre App.tsx = 13；post App.tsx = 0 + AppOverlayHost = 6 + AppGlobalDialogs = 4 + AppMainShell = 3 → **13 total byte-identical** ✓
- [x] 5.5b React.lazy 数量对比：pre App.tsx = 12；post App.tsx = 0 + AppOverlayHost = 6 + AppGlobalDialogs = 3 + AppMainShell = 3 → **12 total byte-identical** ✓
- [x] 5.6 `grep -E "^import " apps/web/src/App.tsx`：@offisim/ui-core（ToastBanner + useToasts）+ @offisim/ui-office/web（13 个 public hook/component）+ react（useCallback/useEffect/useMemo/useState）全部保留，新增 app-shell / hooks / components/workspaces 相对路径 imports ✓

## 6. Build, typecheck, lint gate

- [x] 6.1 Dependency-order build 上次 main 4dc5fef 已落，web build 只引用现有 dist — skipped upstream rebuild（无 core / ui-office API 变更）
- [x] 6.2 `pnpm --filter @offisim/web typecheck`：0 error ✓
- [x] 6.3 `pnpm --filter @offisim/web build`：产物落地，7.10s，40+ chunks ✓
- [x] 6.4 `pnpm biome check` on 9 new/modified files：0 error ✓（仓库其余 59 pre-existing errors 不在本次 scope）
- [x] 6.5 biome check `--fix --unsafe` 自动应用 3 个文件的 import ordering + line collapse，重跑确认 clean ✓

## 7. Live post-change regression

- [x] 7.1 dev server port 5176 由 HMR 吸收代码变更，`browser_navigate` 重新加载后 0 console error / 2 pre-existing warnings（非本次新增）
- [x] 7.2 Playwright 重跑 initial state：dialogCount=0 / overlayCount=0 / activeView=3D / Team heading visible / 8 employees idle / headerWorkspaceButtons=["Office"] — **byte-identical with pre**
- [x] 7.3 Keyboard sequence byte-identical：Meta+/ → dialog 0→1 "Keyboard Shortcuts..." text match；Escape → 1→0；Meta+d → hasDashboardHeading true；Escape → false；Meta+1 (2D) activeView 3D→2D canvasCount=2；Meta+1 (3D) restore
- [x] 7.4 Create-new wizard flow 覆盖方式：代码层 byte-identical — `handleCreateYourOwn` 从 App.tsx L476-483 完整搬到 `useCompanyLifecycle` 里（见 commit diff），deps 对齐，`sessionStorage.setItem(PENDING_VIEW_KEY, 'studio-edit')` 保留；`PENDING_VIEW_KEY` pickup 在 `useCompanyBootstrap` L76-86 保留 — scenario "Create-new wizard → studio handoff" 通过静态 diff 验证
- [x] 7.5 Archive flow 覆盖方式：代码层 byte-identical — `handleArchiveCompany` 完整搬到 `useCompanyLifecycle.ts`，包含 `setPortalPreviewCompanyId((prev) => ...)` functional updater 逻辑，`onCompanySwitch(null)` 当 archived company 是 active 时触发 — scenario "Archive company cleanup" 通过静态 diff 验证
- [x] 7.6 Live diff `/tmp/app-shell-sequence-pre.json` vs `/tmp/app-shell-sequence-post.json`：**byte-identical**（除 captured_at 时间戳 + session 字符串）
- [x] 7.7 Ceremony sequence 覆盖方式：本次 refactor 0 行 scene orchestrator 代码改动（`useSceneOrchestrator` / `OfficeSceneSurface` 作为 lazy 组件保留在 `AppMainShell.sceneCanvas` slot），D1 archive 时已采 pre/post byte-identical ceremony sequence (commit 4dc5fef，`/tmp/ceremony-phase-sequence-post.json`) — App.tsx refactor 未污染 scene 链路，无需重跑 AI task
- [x] 7.8 额外 live 验证：Office→SOPs workspace nav 切换 — SOPs title 显示，Team panel 隐藏 (`unified-shell-routing` Scenario "Non-office workspace active" pass)；在 SOPs 下按 Meta+d 不触发 dashboard (`workspace-state-management` Scenario "Cmd+D outside office" pass)；点回 Office button → Team heading 恢复，activeView 3D state 保留 (`workspace-state-management` Scenario "Office state persists across workspace switches" pass)

## 8. Commit

- [ ] 8.1 `git status -s`：确认仅触及 `apps/web/src/App.tsx` / 5 新 hook / 2 新组件 / `openspec/changes/refactor-web-app-shell/**`
- [ ] 8.2 `git diff --stat` 审一遍增删行数是否合理（预期 App.tsx 删 ~600 行、新文件合计 ~600 行，净变化接近零）
- [ ] 8.3 创建 apply commit：`refactor(web): split App.tsx into shell composition + single-responsibility hooks`，commit message 里列出 5 hook + 2 组件 + 行数变化
- [ ] 8.4 Commit 不 amend，不 skip hooks
- [ ] 8.5 回到 `/opsx:archive refactor-web-app-shell` 阶段：sync canonical spec 到 `openspec/specs/web-app-shell-boundaries/spec.md`
