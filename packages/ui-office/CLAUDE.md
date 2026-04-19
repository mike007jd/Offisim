# @offisim/ui-office

Office UI 组件 (React 19), 依赖 core + shared-types。

## Workspace IA & Navigation

- `App.tsx` 维护 `view` + `activeWorkspace` 双状态, 必须通过 `handleWorkspaceSwitch` 同步, 不要直接 `setView`
- 不要绕过 `useWorkspaceBackNavigation` 直接操作 history
- `MarketplaceDetailOverlay` 仅保留给 deep-link install, 其余走 workspace page
- `RegistryClient.hasAuthToken`: 调用认证端点（`/me`, `/drafts`）前必须检查, 无 token 时跳过请求
- `INSTALLABLE_KINDS` (marketplace-meta.tsx): `['employee', 'skill']`（T2.1 起）。Skill 是一等可装实体，走 SKILL.md 开放标准；DB 索引在 `skills` 表（`company` / `employee` 两层 scope），磁盘源真相在 vault。`KIND_FILTERS` 三项 `all`/`employee`/`skill`。`PublishDialog` 的 skill publish flow + 安装 `kind==='skill'` 分支属 T2.1 followup（尚未全落地）
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
- Install: `startRegistryInstall` 开头有 `txnIdRef.current` 并发守卫，不要删除
- SOP: `handleRun` 执行前校验 role_slug 存在性, 缺失角色时 warning toast
- UI 文案密度: 副标题仅在标题本身有歧义时使用。删除营销文案、不要重复展示同一信息
- Company 共享 primitive 在 `company-editor-primitives.tsx`, zone layout 在 `company-editor-layout.ts`
- Chat 命令: `chat-commands.ts` 三类 (runtime/client/panel), 新增只加 `CHAT_COMMANDS`。@mention 不切 direct chat
- UI 全英文, 不要混入中文
- `primeEventLogStore` 按 `EVENT_PREFIXES` 创建 per-prefix 订阅, cleanup 必须调 `disposeEventLogStore` (幂等)。`EVENT_PREFIXES` + `TYPE_PREFIX_MAP` 新增 filter 时同步
- `useRegistryClient` baseUrl: localStorage → `VITE_PLATFORM_API_URL` → localhost:4100

## Prefab 双文件

`renderer/prefab/builtin-catalog.ts` 是**目录定义**(190+ frozen 对象), `ui-office/lib/prefab-spatial.ts` 是**空间 spec** (footprint/anchor/rotation)。两者通过 prefabId 关联但互不依赖。新增 prefab 必须在两边各加一份。
