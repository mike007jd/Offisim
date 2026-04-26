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
- Settings: `SettingsWorkspaceSurface.tsx` 拆出 primitives + ProviderTab + RuntimeTab。`SettingsPage` 用 capture-phase Escape handler 调 `controller.requestDismiss()` 拦截未保存更改。保存 runtimePolicy 必须含 `toolPermissions`。reinit 超时用独立 effect（只依赖 `isReinitializing`），版本检测 effect 独立（依赖 `runtimeVersion`），不要合并
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
