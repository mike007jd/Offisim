## Context

Office 当前 5 个 peer workspace 的契约从 round 1/round 2 屎山热点收口以来一直稳定（`workspace-state-management` / `unified-shell-routing` / `office-tool-discovery` 同期落地）。员工编辑唯一入口是 `EmployeeEditorDialog`，由 `App.tsx` 顶层 `useEmployeeEditor()` mount，经 `AppGlobalDialogs` 渲染，被 Office Roster / `EmployeeInspector` / `ChatPanel` / 键盘快捷键 / Settings External Employees 等多处 `openForEdit(id)` 调用。Studio 的 "Open Studio Editor" 流程不通过它。该对话框最近在 A4 (`stabilize-dialog-and-panel-sizing`) 才把 sizing 收敛到共享常量，是当前 panel-and-dialog-sizing 的主要落地证据之一。

UX overhaul 总计划 §3 把员工提升为承载 list / create / edit / appearance / engine / skills / memory / history 的角色系统。2026-04-25 用户拍板方案 A：Personnel 做第 6 peer workspace，并要求所有员工 list 表面的 Edit 入口走统一路由跳进 Personnel。本 change 范围只到 IA 壳 + 跳转契约 + Profile tab 兜底 edit 能力，C1 (appearance live preview) / C2 (runtime engine binding) 由后续 change 独立填内容。

## Goals / Non-Goals

**Goals**
- `WorkspaceKey` 干净扩到 6，Personnel 是真正一等 peer：Header chip / back navigation / WorkspaceRouter / lazy split 全对齐
- 所有"打开员工"路径都汇聚到 `routeToPersonnel(id, tab)` helper；不再有任何 modal 入口
- Profile tab 在 C0 内即可保住 edit 能力（form 全量保留），不让用户在 C0→C1 之间窗口期失去编辑功能
- `EmployeeEditorDialog` 文件级删除，含 `AppGlobalDialogs` mount 点 + `useRegisterModal('employee-editor', ...)` 注册点 + `apps/web/src/lib/app-view-layout.ts` 注释里的引用（如有）
- Memory / History tab 直接搬运现 dialog 同名 section 的 JSX，不重写

**Non-Goals**
- 不重新设计 Profile 字段分布、不拆 Persona / Config 子区（C1+ 再做）
- Appearance / Runtime / Skills 三 tab 的实际功能（C1 / C2 / 后续 followup）
- Onboarding / first-run 引导更新（独立 phase）
- 移除 `useEmployeeEditor` hook 本身（仍是 Profile tab 的 form state 容器）
- Tauri / desktop 侧独立改动（共享 web 渲染树即可）

## Decisions

### D1. 第 6 个 peer 而非 overlay
**选择**：Personnel = `WorkspaceKey === 'personnel'`，与 Office / SOPs 同级。
**理由**：用户 2026-04-25 明确"方案 A"。Office 内 panel / overlay 形态会让员工系统继续依赖 Office 上下文（必须有 active company 才能进入），并和 Dashboard / Kanban 现有 panel 互斥逻辑混在一起；做 peer 后 Personnel 可独立访问，跨表面 edit 路由也只需要写一种 `setActiveWorkspace`，不需要写"先回 Office 再开 dialog"。
**Alt 考虑过**：(a) 留在 Office 做 right-rail panel 切换 → 和 Dashboard/Kanban panel 互斥逻辑撞车，取消；(b) 全屏 overlay (`OverlayKey += 'personnel'`) → 被既有 `office-editor` / `studio` 同位，但 overlay 没有 history 集成、Back 行为得自己再写一套，且和"peer 体验对等"不符。

### D2. 跨表面 edit 路由 = 共享 helper
**选择**：在 `apps/web/src/lib/workspace-navigation.ts` (或新文件 `personnel-routing.ts`) 暴露 `createRouteToPersonnel({ setActiveWorkspace, updateWorkspaceState })` 工厂，返回 `(id: string, tab?: PersonnelTabId) => void`。所有 list 表面通过 prop 注入或 context 拿到这个 helper，禁止任何地方自己 inline 写两次状态写入。
**理由**：跨表面 edit 是契约最容易回退的地方——任何一个 list 表面遗漏切换、单写一边都会破契约。集中 helper + 测试性 grep "openForEdit" 应零命中。
**Alt 考虑过**：(a) 直接给每个 list 传两个 prop（`setActiveWorkspace`, `updateWorkspaceState`）→ 散点写两步；(b) 用 React context 全局派发 → context 边界跨包难维护；最终选 helper 工厂 + 手注入，简单直接。

### D3. Profile tab = 现 EmployeeEditorDialog 内容**全量**搬过来
**选择**：把现 dialog 的 5 段（Profile / Persona / Config / Memory / History）扁平化成单 Profile tab 一个长表单（含 system prompt preview / workstation selector / provider selector / tool permissions 全留），然后 Memory / History 各拷一份到对应右侧 tab。
**理由**：用户产品红线"功能完成的标准是用户真能用"。如果 C0 把 dialog 删了 + Profile tab 只放 read-only summary，那从 C0 落地到 C1 的窗口期里 form-based 编辑就完全断了。把现 dialog 内容原封不动塞 Profile tab，至少功能不退化；UX 拆分留给 C1。
**Alt 考虑过**：(a) 严格按 queue 字面"Profile 能看就行" → 用户没法编辑员工，违反产品红线，否决；(b) 把 dialog 升级为 inline drawer 共享给两表面 → 等于做了一遍 UI 双载体，浪费工。
**对契约的影响**：`personnel-workspace-surface` 第 6 条 Requirement 明确写 Profile tab 必须 functional + 接现 `useEmployeeEditor.save()`；其他 4 tab placeholder。

### D4. `useEmployeeEditor` hook 保留，签名收敛
**选择**：保留 `useEmployeeEditor()` hook 给 Profile tab 用，但删 `isOpen` / `close` 两个字段（dialog 触发器）。`openForEdit(id)` 改成给 Personnel page 内部调用以"加载这个员工的 form state"——不再 set `isOpen`，纯加载行为。可以重命名为 `loadEmployee(id)`，但暂时保留旧名以减小 diff。
**理由**：hook 内部已经把 form state / 持久化 / 删除 / save 全胶水好了，重写一遍只会引入回归风险。
**Alt 考虑过**：彻底重写为 `usePersonnelEmployeeForm` → 直接拿 dialog 的 form 和 useEmployeeEditor 的 reducer 复用一遍，不值得。

### D5. Personnel 内 back navigation 顺序：tab → selection → workspace history
**选择**：`tryWorkspaceInternalBack('personnel', state)` 先 unwind tab（非 profile 回 profile），再 unwind selection（non-null 回 null），最后 fall through 让 history stack 弹回上个 workspace。
**理由**：tab 是用户在详情内的"二级 navigation"，selection 是"一级"。先 tab 后 selection 符合 web 浏览器返回的直觉。和现 office back 顺序（dashboard → kanban → marketplace → selectedEmployee）同形。
**Alt 考虑过**：直接清 selection（跳过 tab）→ 用户切了一堆 tab 后 back 一下就把整个员工详情关掉，体验破碎。

### D6. Header peer 顺序：Office | SOPs | Market | Personnel | Activity | Settings
**选择**：Personnel 紧跟 Market 后、Activity 前。
**理由**：用户 2026-04-25 明确建议 ——「员工紧跟 Market 后，契合"配置产品生态"的节奏」。Activity / Settings 仍是工程类辅助 peer，放后面。
**Alt 考虑过**：Personnel 放 Office 后 → 太"主操作"导向，但实际上 Personnel 不是高频日常，是配置型。

### D7. WorkspaceRouter 用 lazy import + 独立 wrapper
**选择**：`apps/web/src/components/workspaces/lazy-wrappers/PersonnelPage.tsx` 是 thin wrapper，内部 lazy import `@offisim/ui-office` 的 `PersonnelPage`，对齐 `MarketWorkspacePage` / `SettingsPage` / `ActivityLogPage` 现有模式。`packages/ui-office/src/components/employees/PersonnelPage.tsx` 是真正 IA 实现。
**理由**：bundle 切割保持现状（Personnel 不在初始 chunk），且和其他 peer 一致。
**Alt 考虑过**：直接放 `apps/web` → 和 `MarketWorkspacePage` 不一致，且 Personnel 还要跨包共享 employee primitives（`AvatarCustomizer` / `EmployeeInspector` 等住 ui-office），放 ui-office 更顺。

## Risks / Trade-offs

**[Risk] Profile tab 表单密度比原 dialog 还高（少了内部 5 tab 切换的减载）**
→ 用 SurfaceCard 分段 + 顶部 sticky save bar；C0 不追求紧凑，C1 / C2 拆 tab 后自然释放。短期接受。

**[Risk] 现有 `useAppKeyboardShortcuts.anyModalOpen` 拦截 list 中其他快捷键**
→ Personnel 不是 modal，不会出现在 modal stack 里；现役 anyModalOpen 路径保留即可。`useRegisterModal('employee-editor', 'dialog')` 调用点删除后 modal stack 不再被 employee-editor 入栈，反而更干净。

**[Risk] 跨表面 list 的 Edit handler 散点遗漏**
→ Mitigation：用 grep 工程化检查 — `grep -rn "openForEdit\|EmployeeEditorDialog\|employeeEditor\." apps/ packages/` 应只剩 `useEmployeeEditor` hook 内部、Profile tab 调用、archive 文档；archive gate 必跑此 grep。

**[Risk] AppGlobalDialogs / App.tsx 对 `employeeEditor` prop 的依赖在 dialog 拆掉后留下死引用**
→ Mitigation：删除 `AppGlobalDialogs` 接 prop，删除 App.tsx `useEmployeeEditor()` 顶层调用，删除 `app-view-layout.ts` 注释；typecheck 会立刻暴露任何遗漏。

**[Risk] Memory / History tab 直接搬现 dialog JSX，可能引入未注意的 hook 依赖**
→ Mitigation：搬运时连同其依赖的 `useCompanyZones` / `useCompany` 一起拷过去；apply 时手验 memory + history tab 渲染。

**[Risk] External employee 在 Personnel Profile tab 的只读 banner 行为变化**
→ Mitigation：Profile tab 直接复用现 dialog 的 `is_external === 1` 判断 + AvatarCustomizer 的只读 banner；C0 内不动 external 路径。

**[Risk] Studio 内 employee-editor 入口改路由后，Studio dirty 状态可能丢**
→ 现 Studio 已有自己的 dirty 处理（`OfficeEditorOverlay` 本地 dirty），切换 workspace 触发 `OffisimRuntimeProvider key={companyId}` re-mount 不会发生（同一 company）；switching workspace 不卸 overlay 树，安全。

## Migration Plan

无 db migration / 无外部依赖。代码层面分以下 batch（apply 阶段单 commit 完成，不需要 staged rollout）：

1. **Types & state**：types.ts 加 personnel 相关字段 + factory + SESSION_KEY；useWorkspaceSessionState 加 personnel 分支；workspace-navigation 加 nav item
2. **Personnel page 实现**：ui-office 新 PersonnelPage + 6 tab；apps/web lazy wrapper；WorkspaceRouter 加分支
3. **跨表面 edit 路由**：helper + Office Roster / EmployeeInspector / ChatPanel / Settings External 各调用点切换；`useAppKeyboardShortcuts` 路由
4. **删 EmployeeEditorDialog**：删文件 / index export / AppGlobalDialogs 分支 / App.tsx mount / `useRegisterModal('employee-editor', ...)` / app-view-layout.ts 注释
5. **CLAUDE.md & 子包 CLAUDE.md** 更新（5→6 peer）

回滚：单 commit 可 `git revert` 一次性回退。中间 batch 不会跑 prod。

## Open Questions

- **Q1**: `OverlayKey` union 仍含 `employee-creator`（创建路径走 `EmployeeCreatorOverlay`，是 InterviewWizard，不是 EmployeeEditorDialog）。本 change **不动** create 路径。create 走 wizard、edit 走 Personnel 是符合产品语义的拆分。如果用户后面想把 create 也吃进 Personnel，开独立 followup change（"Personnel 内 inline create"）。
- **Q2**: Personnel 列表是否需要支持外部员工 brand avatar 渲染？默认是 — 列表项调用现成 `EmployeeAvatar` 共享 primitive，自动按 `is_external + brand_key` 分支。
- **Q3**: Personnel 在 desktop 三栏的 panel width 是否要 persistence？C0 不做（hardcode 默认值），C1 followup 可加 `leftPanelWidth` / `rightPanelWidth` 到 `PersonnelSessionState`。
