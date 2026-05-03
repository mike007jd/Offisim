# @offisim/ui-office

Office UI 组件 (React 19), 依赖 core + shared-types。

## Workspace IA & Navigation

- `App.tsx` 通过 `useWorkspaceSessionState()` 持有 `activeWorkspace` + per-workspace session state；workspace URL 由 `apps/web/src/lib/url-routing/` parser/serializer + `useUrlSync()` 统一维护。不要恢复旧的 `view` 双状态或内部 workspace history stack。
- 浏览器 Back/Forward 是 URL parser 驱动；Escape 才允许调用 workspace 内部 drill-back helpers。`useDeepLinkInstall` 仍是 `offisim://install` async channel，独立于 URL routing。
- 所有 peer workspace 拓扑切换消费 `useLayoutTier()` SSOT；Tailwind responsive class 只做 cosmetic，不决定桌面/平板/窄屏的信息架构。
- `MarketplaceDetailOverlay` 仅保留给 deep-link install, 其余走 workspace page
- `RegistryClient.hasAuthToken`: 调用认证端点（`/me`, `/drafts`）前必须检查, 无 token 时跳过请求
- `INSTALLABLE_KINDS` (marketplace-meta.tsx): `['employee', 'skill']`。Skill 是一等可装实体，走 SKILL.md 开放标准；DB 索引在 `skills` 表（`company` / `employee` 两层 scope），磁盘源真相在 vault。`KIND_FILTERS` 已扩到 7 项（`all` / `employee` / `skill` / `sop` / `company_template` / `office_layout` / `prefab`）以配合 platform boot-time official seed 在 Market 展示全部 AssetKind；但 **`INSTALLABLE_KINDS` 仍只含 `employee` + `skill`**，其余 4 类在详情页走 `INSTALLABLE_KINDS.has(detail.kind)` gate，不渲染 install 按钮。新 kind 在 install pipeline 没接通前不要加进 `INSTALLABLE_KINDS`。`PublishDialog` 的 skill publish / install 主路径已落地；剩余是 upload affordance、Claude/Codex sync UX、evidence 收口，不要再按"schema 未落地"理解它
- Market per-company 已装态 SSOT：`hooks/useInstalledListings.ts` 派生 `installedListingIds: ReadonlySet<string>`，由 `installedPackages.origin_listing_id`（employee 路径）+ `skills.source_ref`（marketplace skill 路径，过滤掉 `git:|upload:|claude-code:|codex:` 前缀的 ref）合并；订阅 `market.listing-installed` 事件增量更新，`activeCompanyId` 切换会重新派生。`MarketDetailView` / `MarketListingCard` / `MarketCardGrid` / `MarketplaceDetailOverlay` 通过 `installedListingIds` prop 消费它驱动按钮 `Installed` 状态 + 卡片角标；平台全局 `formatInstallCount(install_count)` 是独立信号不替换。emit 站点：`packages/install-core/src/install-service.ts`（employee 终态）+ `packages/core/src/skills/skill-loader.ts`（marketplace skill 终态），其他 skill source（git/upload/claude-code/codex/fork/self-authored）不 emit。
- `SkillBindingList` 已从单-skill 卡片改为多-skill 列表（`useSkillsForEmployee(companyId, employeeId)` 订阅 `skill.*` 事件前缀）；`SkillInspectorPanel` 是只读 SKILL.md body 预览；编辑能力属 T2.7
- `onSessionStateChange` 签名是 `(updater: (prev: T) => T) => void`, useCallback deps 只需 `[onSessionStateChange]`
- `OffisimRuntimeProvider` init 异步, 依赖就绪的 useEffect 必须 deps 含 `version`, 不要用 `isInitializing`。**原因**: runtime 拆双 Context, `version` 是 bump 计数器, 不放 deps 闭包会陈旧

## UI / Scene / 3D

- `ceremony-visuals.ts`: `getPhaseColor()` 是 phase 颜色唯一真相; 同时持有 `MANAGER_PRESENCE_COLORS` + `DEFAULT_BUBBLE_TEXT`, 不要硬编码
- `CeremonyState` 新增字段必须同步 `createIdleCeremonyState()` 和 `IDLE_CEREMONY`
- `CeremonyHost` (`apps/web/src/components/office-shell/OfficeSceneSurface.tsx`) 隔离 ceremony state, 不要把 `useSceneOrchestrator` 上提到 App
- `SceneCanvas` 的 force-2D fallback 由单一 `useReducer` 管理 (`reportCrash` / `fpsTierOff` / `requestRetry` / `viewModeBumped` 四个 action)。`reportCrash` bumps crashCount，`fpsTierOff` 是 perf 信号不 bump。Explicit user retry 必须 reset：父层 `viewModeNonce: number` 每次 toggle 点击 +1（含 same-value clicks），SceneCanvas 监听 nonce 变化触发 `viewModeBumped`。`<SceneFallbackBadge>` 是 ghost-state (`viewMode='3D' && state.force2D`) 必显的 retry affordance，颜色走 warning tokens。
- 3D lighting SSOT 是 `SceneLightingRig` + `scene-performance-tier.ts`；`useScenePerformanceTier()` 管 FPS 软降级和 2D fallback request，`ScenePostprocessing` 只在 high/medium 动态加载 post chunk。Envmap 是 procedural — `useProceduralRoomEnvironment(active)` 用 three.js 内置 `RoomEnvironment` + `PMREMGenerator.fromScene(env, 0.04)` runtime bake，不再走 drei `<Environment preset>` (drei 默认拉 CDN HDR，Tauri release CSP / offline 必 fail)。
- 3D prefab material SSOT 是 `theme/scene-materials.tsx` + `SceneMaterial`。`components/scene/prefabs/` 禁 inline hex、`meshStandardMaterial` / `meshPhysicalMaterial`、以及 inline `roughness=` / `metalness=` / `transmission=` 数值。
- 2D office canvas 颜色 SSOT 是 `useSceneColors()` → `Scene3DColors`（`scene-2d-theme-tokens` capability）。`Office2DCanvasView.tsx` / `office-2d-canvas-renderer.ts` / `office-2d-render-registry.ts` / `canvas-primitives.ts` / `canvas-layers/*.ts` 11 个文件全部走 `frame.palette`（`SceneCanvasPalette = Pick<Scene3DColors, ...30 fields>`）+ `frame.sceneColors`（registry 用），不再持有 `// raw-hex-allowed-file:` 豁免；employee status color 走 `buildStatusColors(theme)` + `resolveStatusColor()` 在 `useSceneSnapshot` 里 theme-aware；canvas 在 theme 切换的下一个 rAF tick 自动 re-raster（`useCanvasRedrawLoop` 监听 `palette` identity）。新加 2D 视觉元素必须从 palette 取色，禁止再加 inline hex / rgba。
- 2D canvas employee→zone drop pipeline SSOT 是 `useCanvasInteraction` + `office-2d-hitmap.hitTestZone` + `useSceneSnapshot.dropTargetZoneIds`，契约见 `scene-2d-employee-drop` capability；diagnostic ring buffer 在 `office-2d-drop-diagnostic.ts`，导出入口在 Settings → Runtime "2D scene diagnostics"。**渲染层硬规则**：`useSceneSnapshot.zoneEmployees` 与 `office3d-employees` 对 idle 员工的 fallback `restId` 仅在 `agent.workstationId` 为空时生效；`workstationId` 非空必须按 `resolveZone(agent)` 渲染到 assigned zone（drop event emit 后下一帧必须可见），不得让 idle shortcut 覆盖显式 workstation 赋值。
- 3D art-direction SSOT 是 `components/scene/scene-art-direction.ts` + `components/scene/scene-room-shell.tsx` + `Scene3DColors`。`Office3DView` 只从 `scene-room-shell` 引 RoomShell；不要恢复 `gridHelper` debug room、单色地板、或散落 camera/layer 常量。
- 内部员工块人几何 SSOT 是 `components/scene/character-mesh-builder.tsx`。bodyType / gender / hairStyle / clothingAccent 必须全量渲染；brand variants 只用 `<BlockCharacter variant="shared-rig-only">` 提供 limb rig，自带 torso/head/brand geometry。
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
- Chat direct target SSOT：`ChatPanel` 里 direct chat 必须以 `selectedEmployeeId` 为唯一 dispatch target；缺失/错配要抛 `Direct chat target missing — selectedEmployeeId not propagated`，不要 fallback 到 active / first / boss employee。
- Chat assistant commit SSOT：同一 `conversationKey + runId` 只能有一条 assistant message。streaming segment、abort/error、final response 都要收敛到 `finalizeAssistantMessage()`，不要在 UI 层靠隐藏重复气泡兜底。
- `SkillInstallConfirmBubble` 支持 `action='install' | 'fork' | 'edit' | 'create'`；`create` 分支只预览 LLM 生成的完整 SKILL.md，不做 inline edit，frontmatter 错误只显示 reason + Retry/Cancel。
- Skill install outcome 双面 SSOT：copy 由 `@offisim/shared-types.skillInstallOutcomeLabel(outcome)` 唯一产出。chat assistant message (`apps/web/src/runtime/interaction-follow-up.ts`) 和 activity rail (`subscribeInteractionMappers` 订阅 `SKILL_INSTALL_OUTCOME`) 都消费同一函数；slug 由 `SkillInstallCommitter` 从 `row.slug` 填进 outcome，render 时不查 repo。
- Skill install 双 log 防御：`interaction.resolved` mapper 对 `kind === 'skill_install_confirm'` 显式 skip；`interactionResolvedLabel` 不含 skill_install_confirm 分支。`SKILL_OUTCOME_TONE` Record 在 mapper 里；6 种 kind 加新分支需同步该表（编译期强制覆盖）。
- ChatPanel `handleInteractionRespond` 路由：startRun / addMessage / finalizeActiveRun 都用当前视图的 `conversationKey`（`getScopedConversationKey(activeThreadId, targetKey)`），不要用 interaction owner 的 employeeId 拼 key — team chat 时会写到员工 direct chat、用户看不到。`resolveDirectChatTarget` 仍当 safety guard 用（direct chat 视图对不上 interaction owner 时抛错）。
- ChatPanel skill_install_confirm 例外：followUp 是静态一行字，agent resume 会 startRun 自己的 activeRun race 我们的 — 直接 `addMessage(targetKey, { role: 'assistant', ... })`，不进 startRun/finalize 链。其余 interaction kind（permission/plan/agent_question）继续用 startRun + finalize（runtime 驱动的 retry/resend 需要 activeRun）。
- UI 全英文, 不要混入中文
- `primeEventLogStore` 按 `EVENT_PREFIXES` 创建 per-prefix 订阅, cleanup 必须调 `disposeEventLogStore` (幂等)。`EVENT_PREFIXES` + `TYPE_PREFIX_MAP` 新增 filter 时同步
- `useRegistryClient` baseUrl: localStorage → `VITE_PLATFORM_API_URL` → localhost:4100

## Layout Shift

- Tabs surfaces that preserve state or host heavy content declare a fixed min-height and use `forceMount + TABS_RETAIN_STATE_CLASS`.
- `WorkspacePageShell` loading skeletons reserve `--workspace-min-content-height` per workspace before ready content mounts.
- Canvas / 3D / iframe slots reserve size with `aspect-ratio` or explicit min-height before the embedded runtime mounts.
- `StreamingBubble` bounds streamed content with `max-h-[60vh]`, inner scroll, and `overscroll-contain`.

## Onboarding tour

- Tour slot 注册 SSOT 在 `components/onboarding/tour-context.tsx`，步骤表在 `tour-steps.ts`。需要被高亮的控件必须调用 `useTourTarget(slot)`，不要再放 `data-onboarding-target`。
- `OnboardingTour` 只读 slot map 和 persisted onboarding state；目标未挂载时显示 workspace switch hint，不把步骤误标完成。
- First-run welcome 只在 `welcome_seen=false`、provider 未配置、无 company、tour 未 dismissed 时显示；Skip 同时写 `welcome_seen` + `tour_dismissed`。

## Prefab 双文件

`renderer/prefab/builtin-catalog.ts` 是**目录定义**(190+ frozen 对象), `ui-office/lib/prefab-spatial.ts` 是**空间 spec** (footprint/anchor/rotation)。两者通过 prefabId 关联但互不依赖。新增 prefab 必须在两边各加一份。

## Project (G1 — workspace_root binding)

- **`packages/ui-office/src/lib/folder-picker.ts`** 是 Tauri-vs-browser 平台分支唯一抽象。`pickWorkspaceFolder()` 桌面调 `@tauri-apps/plugin-dialog` 的 `open({ directory: true })`，浏览器抛 `FolderPickerUnavailableError`；`revealWorkspaceFolder(path)` 桌面调 `@tauri-apps/plugin-opener` 的 `revealItemInDir`（fallback `openPath`），浏览器同样 throw。`isFolderPickerAvailable()` 走 `isTauri()`（reads `__TAURI_INTERNALS__`，**不**读 `window.__TAURI__`）。`packages/ui-office/src/components/project/**` 之外的组件**不要直接 import** `@tauri-apps/plugin-dialog` / `@tauri-apps/plugin-opener`。
- **`ProjectCreateDialog.tsx`** 是 create + edit 同一个组件，`mode: 'create' | 'edit'` + 可选 `initial: ProjectRow`。复用 `dialog-shell` 的 `DIALOG_SIZING_CLASS` SSOT。Folder row 在桌面渲染 path display + Choose / Clear；浏览器渲染 disabled hint "Available on desktop"。空 name 禁用 CTA。父组件（App.tsx）持有 `projectDialog` state + 渲染 `<ProjectCreateDialog>`，Workspace Project selector 通过 `onRequestCreate` / `onRequestEdit` callback 触发。
- **`ProjectSelector.tsx`** 是 Office Workspace 里的 Project control，桌面主 header 不再渲染它；窄屏可放在 header overflow 里保证入口可达。选中 project 的 summary 展示 `Workspace folder`、task / deliverable counts、Open、Edit，并承载 `ProjectWorkspaceFiles`。Open folder 失败由父层 toast 接 `onError`，文案 `Folder not found at <path>. Edit project to rebind.`。
- **`ProjectWorkspaceFiles.tsx`** 是 workspace_root 文件树 UI，挂在 project picker selected summary 内。桌面通过 `project_list_dir` 列目录、`project_read_file_preview(path, cwd, max_bytes)` 读 bounded 文本预览（默认 8 KB，Rust 端硬上限 64 KB，UTF-8 boundary walk-back 安全；不要再调 `project_read_file` 给文件树预览，它是 agent tool lane 的 unbounded 入口）。Selection state 是 `useReducer` 单 state machine（`Selection = null | loading | ready | error`），禁止再开 `selectedFile` / `preview` / `previewLoading` 平行 scalar。`<ProjectWorkspaceFiles>` **不再**挂 `key=` prop（旧的 project switch remount 已用内部 `useEffect([workspaceRoot])` 替代，cosmetic re-render 不再 blow nav state）。浏览器只显示 `Desktop files only`，不调用 Tauri API。
- **`useProjects.ts`** `createProject(input)` / `updateProject(projectId, patch)` 都是对象参数；不再有 positional `(name, description?)` 形式。trim + null coercion 内置。
- **数据**：`projects.workspace_root` 是 nullable TEXT，三 backend repo（drizzle / memory / Tauri SQL）通过 Drizzle schema 自动写读；`ProjectUpdatePatch` 类型显式允许 `workspace_root: string | null`（null = unbind）。当前未上线口径不保留 DB migration 链；改 persistence shape 时同步 `packages/db-local/src/schema.ts` 与 `packages/db-local/src/schema.sql`。
- **Tauri 端三件套（dialog / opener）已就位**：`Cargo.toml` `tauri-plugin-dialog = "2"` + `tauri-plugin-opener = "2"`；`lib.rs` `.plugin(...)` 已注册；`capabilities/default.json` 含 `dialog:default` + `dialog:allow-open` + `opener:default` + `opener:allow-reveal-item-in-dir` + `opener:allow-open-path`。少任意一项 desktop 静默 no-op，**改前先核对三处都在**（同 fs plugin 三件套 gotcha 同款翻车点）。文件树不用 `tauri-plugin-fs` 直读 workspace_root，必须走 `project_list_dir` / `project_read_file`，避免绕开 workspace sandbox。
- **Web vite stub**：`apps/web/src/polyfills/tauri-plugin-{dialog,opener}.ts` 是 noop 函数，vite alias + `optimizeDeps.exclude` 都已加；新增其他 Tauri plugin 时按同款补 stub，否则 web dev 动态 import 会 404。
