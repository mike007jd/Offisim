# @offisim/ui-office

Office UI 组件 (React 19), 依赖 core + shared-types。

## Workspace IA & Navigation

- `App.tsx` 通过 `useWorkspaceSessionState()` 持有 `activeWorkspace` + per-workspace session state；workspace 切换走 `setActiveWorkspace` / `updateWorkspaceState`，不要恢复旧的 `view` 双状态或绕开 `useWorkspaceBackNavigation`
- 不要绕过 `useWorkspaceBackNavigation` 直接操作 history
- `MarketplaceDetailOverlay` 仅保留给 deep-link install, 其余走 workspace page
- `RegistryClient.hasAuthToken`: 调用认证端点（`/me`, `/drafts`）前必须检查, 无 token 时跳过请求
- `INSTALLABLE_KINDS` (marketplace-meta.tsx): `['employee', 'skill']`。Skill 是一等可装实体，走 SKILL.md 开放标准；DB 索引在 `skills` 表（`company` / `employee` 两层 scope），磁盘源真相在 vault。`KIND_FILTERS` 已扩到 7 项（`all` / `employee` / `skill` / `sop` / `company_template` / `office_layout` / `prefab`）以配合 platform boot-time official seed 在 Market 展示全部 AssetKind；但 **`INSTALLABLE_KINDS` 仍只含 `employee` + `skill`**，其余 4 类在详情页走 `INSTALLABLE_KINDS.has(detail.kind)` gate，不渲染 install 按钮。新 kind 在 install pipeline 没接通前不要加进 `INSTALLABLE_KINDS`。`PublishDialog` 的 skill publish / install 主路径已落地；剩余是 upload affordance、Claude/Codex sync UX、evidence 收口，不要再按"schema 未落地"理解它
- `SkillBindingList` 已从单-skill 卡片改为多-skill 列表（`useSkillsForEmployee(companyId, employeeId)` 订阅 `skill.*` 事件前缀）；`SkillInspectorPanel` 是只读 SKILL.md body 预览；编辑能力属 T2.7
- `onSessionStateChange` 签名是 `(updater: (prev: T) => T) => void`, useCallback deps 只需 `[onSessionStateChange]`
- `OffisimRuntimeProvider` init 异步, 依赖就绪的 useEffect 必须 deps 含 `version`, 不要用 `isInitializing`。**原因**: runtime 拆双 Context, `version` 是 bump 计数器, 不放 deps 闭包会陈旧

## UI / Scene / 3D

- `ceremony-visuals.ts`: `getPhaseColor()` 是 phase 颜色唯一真相; 同时持有 `MANAGER_PRESENCE_COLORS` + `DEFAULT_BUBBLE_TEXT`, 不要硬编码
- `CeremonyState` 新增字段必须同步 `createIdleCeremonyState()` 和 `IDLE_CEREMONY`
- `CeremonyHost` (`apps/web/src/components/office-shell/OfficeSceneSurface.tsx`) 隔离 ceremony state, 不要把 `useSceneOrchestrator` 上提到 App
- 3D 崩溃 ≥2 次锁定 2D (`crashCountRef`)
- 员工定位统一走 `SeatRegistry` (3D/2D), 不要硬编码位置或恢复 4 象限布局
- 渲染用 `resolveEmployeeSceneZoneId()`, 不要用 `resolveEmployeeZoneDynamic()` (避免掉 UNASSIGNED_ZONE)
- 移动路由走 `scene-behavior.ts` → `buildTransitRoute()`, 不要直接 `handle.moveTo()`
- 新增 prefab 必须在 `prefab-spatial.ts` SPATIAL_SPECS 补数据
- Settings: `SettingsWorkspaceSurface.tsx` 现仅导出 `SettingsTab` 类型 + `useSettingsWorkspaceController` hook（旧的 `SettingsWorkspaceSurface` React 组件已删，活路径是 `SettingsPage` → `SettingsTabNav` + `SettingsContentArea`）。`SettingsPage` 用 capture-phase Escape handler 调 `controller.requestDismiss()` 拦截未保存更改。保存 runtimePolicy 必须含 `toolPermissions`。reinit 超时用独立 effect（只依赖 `isReinitializing`），版本检测 effect 独立（依赖 `runtimeVersion`），不要合并
- Settings tab 内部用 `SettingsSection` (无 border / bg / radius，顶部 1px 分割线 + 段标题) 作为主排版 primitive；`SurfaceCard` 仅留给"独立配置实体"（如 desktop `VaultDirectorySection`）。**panel-and-dialog-sizing spec 禁止 cards-in-cards**：每 Settings tab body ≤ 1 层 SurfaceCard，禁止在 SurfaceCard / SettingsSection 内再嵌 `<Card>` (`ui-core`) 或手写 `rounded-[20px]` 内卡。MCP 子页 server list 按 `transport` 分组（stdio / sse），每组顶部一行 `${transport.toUpperCase()} · ${count}` 标签；row 用 flat list (`rounded-md` + hover bg, 无 full-time border)，`key={server.serverId ?? 'local:'+server.name}` 稳定。Sticky save bar 在 `SettingsContentArea.tsx`，External tab 隐藏；按钮文案分支 = `No changes to save` / `Save provider + runtime changes` / `Saving…` (+ `Reinitializing runtime` hint) / `Save failed — retry` (+ inline Retry button 复用 `handleSave`)；`controller.isReinitializing` 独立暴露给 hint 用，`controller.isSaving` 仍是 `isSaving || isReinitializing` 合并值
- Studio: 保存错误用 `useToasts` + `<ToastBanner>`, 不要写内联 error banner
- Studio 编辑层级 = Plot → Zone → Asset 显式三态，唯一真相在 `useStudioHierarchyLevel()` (`StudioState.tsx`)，从 `selectedZoneId / selectedInstanceId / isEditingZone` 派生。`PlotZoneBreadcrumb` 三段 + `StudioPalette` 三态分支 + `StudioProperties` 顶部锚行都消费同一 hook。Esc 在 `StudioPage` 顶层 handler 单层退栈：placement active → cancel；Asset → Zone (exitEditZone)；Zone → Plot (unfocusZone)；Plot 不消费。`exitEditZone` 现在会清 `focusedZoneId`（保留 `selectedZoneId`），别再恢复"全清"旧语义。PlotSize 持久化只走 `localStorage`（key `offisim:studio:plot-size:<companyId|create>`，`CREATE_PLOT_KEY` 常量在 `studio-plot-size-storage.ts`），**不要落 DB 列**；create→edit 自动迁移由 `resetForCompany` 触发。
- Studio Asset 编辑契约：`StudioGhost.validatePlacement` 三 reason (`outside-zone` → `category-not-allowed` → `overlap`，priority 决定 label 文案)；zone-edit 模式下 ghost group + `TransformControls` translate 都通过 `clampFootprintToRect` 锁在 focused zone AABB 内（visual clamp，blocked 状态独立计算保留 reason），别在外面再加 rebound 动画或在 store 里耦合空间逻辑。
- Install: `startRegistryInstall` 开头有 `txnIdRef.current` 并发守卫，不要删除
- SOP: 选中 SOP 后是四区 builder shell：左 `SopSidebar`、中 `SopDagCanvas`、右 `SopInspectorPanel`、底部 `SopNlCommandBar` 同屏；inspector 只读，编辑仍走节点双击 / 右键菜单。DAG ports 必须每次渲染，非 edit mode 用低透明 + 不抢 pointer，edit mode 才激活 drag-to-connect。`handleRun` 执行前校验 role_slug 存在性, 缺失角色时 warning toast
- UI 文案密度: 副标题仅在标题本身有歧义时使用。删除营销文案、不要重复展示同一信息
- Company 共享 primitive 在 `company-editor-primitives.tsx`, zone layout 在 `company-editor-layout.ts`
- Chat 命令: `chat-commands.ts` 三类 (runtime/client/panel), 新增只加 `CHAT_COMMANDS`。@mention 不切 direct chat
- UI 全英文, 不要混入中文
- `primeEventLogStore` 按 `EVENT_PREFIXES` 创建 per-prefix 订阅, cleanup 必须调 `disposeEventLogStore` (幂等)。`EVENT_PREFIXES` + `TYPE_PREFIX_MAP` 新增 filter 时同步
- `useRegistryClient` baseUrl: localStorage → `VITE_PLATFORM_API_URL` → localhost:4100

## Prefab 双文件

`renderer/prefab/builtin-catalog.ts` 是**目录定义**(190+ frozen 对象), `ui-office/lib/prefab-spatial.ts` 是**空间 spec** (footprint/anchor/rotation)。两者通过 prefabId 关联但互不依赖。新增 prefab 必须在两边各加一份。

## Project (G1 — workspace_root binding)

- **`packages/ui-office/src/lib/folder-picker.ts`** 是 Tauri-vs-browser 平台分支唯一抽象。`pickWorkspaceFolder()` 桌面调 `@tauri-apps/plugin-dialog` 的 `open({ directory: true })`，浏览器抛 `FolderPickerUnavailableError`；`revealWorkspaceFolder(path)` 桌面调 `@tauri-apps/plugin-opener` 的 `revealItemInDir`（fallback `openPath`），浏览器同样 throw。`isFolderPickerAvailable()` 走 `isTauri()`（reads `__TAURI_INTERNALS__`，**不**读 `window.__TAURI__`）。`packages/ui-office/src/components/project/**` 之外的组件**不要直接 import** `@tauri-apps/plugin-dialog` / `@tauri-apps/plugin-opener`。
- **`ProjectCreateDialog.tsx`** 是 create + edit 同一个组件，`mode: 'create' | 'edit'` + 可选 `initial: ProjectRow`。复用 `dialog-shell` 的 `DIALOG_SIZING_CLASS` SSOT。Folder row 在桌面渲染 path display + Choose / Clear；浏览器渲染 disabled hint "Available on desktop"。空 name 禁用 CTA。父组件（App.tsx）持有 `projectDialog` state + 渲染 `<ProjectCreateDialog>`，selector / context strip 通过 `onRequestCreate` / `onRequestEdit` callback 触发。
- **`ProjectContextStrip.tsx`** 在 ChatPanel 顶部、team / direct chat 都展示，`activeProject == null` 时返回 null（**零 DOM**，不留空 row）。`Project · {name} · {formatWorkspaceRootHint(workspace_root)}`，desktop + folder 绑定时显示 Open folder 按钮，永远显示 Edit 按钮。Open folder 失败由父层 toast 接 `onError`，文案 `Folder not found at <path>. Edit project to rebind.`。
- **`useProjects.ts`** `createProject(input)` / `updateProject(projectId, patch)` 都是对象参数；不再有 positional `(name, description?)` 形式。trim + null coercion 内置。
- **数据**：`projects.workspace_root` 是 nullable TEXT，三 backend repo（drizzle / memory / Tauri SQL）通过 Drizzle schema 自动写读；`ProjectUpdatePatch` 类型显式允许 `workspace_root: string | null`（null = unbind）。Migration `026_projects_workspace_root.sql` (db-local) + `034_projects_workspace_root.sql` (Docs/ canonical for desktop runtime) 同步存在；**改 lib.rs `migrations()` 时务必同步两份**。
- **Tauri 端三件套（dialog / opener）已就位**：`Cargo.toml` `tauri-plugin-dialog = "2"` + `tauri-plugin-opener = "2"`；`lib.rs` `.plugin(...)` 已注册；`capabilities/default.json` 含 `dialog:default` + `dialog:allow-open` + `opener:default` + `opener:allow-reveal-item-in-dir` + `opener:allow-open-path`。少任意一项 desktop 静默 no-op，**改前先核对三处都在**（同 fs plugin 三件套 gotcha 同款翻车点）。
- **Web vite stub**：`apps/web/src/polyfills/tauri-plugin-{dialog,opener}.ts` 是 noop 函数，vite alias + `optimizeDeps.exclude` 都已加；新增其他 Tauri plugin 时按同款补 stub，否则 web dev 动态 import 会 404。
