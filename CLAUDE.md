# CLAUDE.md

## Quick Start

```bash
pnpm install          # 安装依赖 (pnpm 10+, Node 20+)
pnpm build            # 全量构建 (turbo, 顺序: shared-types → core → renderer/db-*/doc-engine/... → ui-office → apps)
pnpm test             # 全量测试 (vitest)
pnpm typecheck        # 全量类型检查 (16 packages)
pnpm lint             # Biome check
pnpm lint:fix         # Biome auto-fix
pnpm format           # Biome format
pnpm clean            # 清除 turbo 缓存 + node_modules
```

E2E (Playwright, 需要 `.env.local` 里的 `MINIMAX_API_KEY`):
```bash
cd apps/web && pnpm test:e2e           # dev mode E2E (25 specs)
cd apps/web && pnpm test:e2e:prod      # prod bundle E2E (vite build + preview)
```

单包操作:
```bash
pnpm --filter @offisim/core test        # 跑单包测试
pnpm --filter @offisim/core build       # 构建单包
cd apps/web && pnpm dev                 # 启动 web SPA (port 5176)
cd apps/platform && pnpm dev            # 启动 platform API (port 4100)
pnpm --filter @offisim/desktop dev      # 启动 Tauri 桌面应用 (复用 web port 5176)
```

Docker: `docker compose -f docker/docker-compose.yml up --build`

## Monorepo Structure

```
packages/
  shared-types    — 零依赖类型包, 所有包的基础
  core            — LangGraph kernel, agents, services, repos (Node.js)
  renderer        — 纯逻辑层: tokens, layout engine, prefab catalog
  ui-office       — Office UI 组件 (React 19, 依赖 core + shared-types)
  ui-core         — 共享 UI 原子组件
  db-local        — Drizzle + SQLite (桌面本地存储)
  db-platform     — Drizzle + PostgreSQL (平台数据库)
  doc-engine      — 文档导出 (docx/pdf/pptx/csv/html/txt)
  install-core    — 安装状态机 + planner + materializer
  asset-schema    — Manifest 校验 (AJV)
  registry-client — Marketplace API 客户端
apps/
  web             — Vite + React 19 SPA (浏览器版)
  desktop         — Tauri 2 桌面应用
  platform        — Hono API 服务端
  launcher        — Tauri launcher
```

构建顺序: `shared-types → core → renderer/db-*/doc-engine/... → ui-office → apps`

## Code Style

- Biome: 2-space indent, single quotes, trailing commas, semicolons, 100 char line width
- TypeScript strict mode (`noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`)
- ESM (`"module": "ESNext"`, `"moduleResolution": "bundler"`)
- 测试: vitest, `__tests__/` 目录, `.test.ts` 后缀
- 不写不必要的注释和 docstring

## Environment

- Node 20+, pnpm 10+
- Desktop/Launcher: Rust toolchain + Tauri CLI (`cargo install tauri-cli`)

## Workspace IA

5 个 peer-level workspace, `WorkspaceRouter` 管理。非 Office workspace 渲染在 `FullPageWorkspaceShell`（含 `WorkspacePageHeader` 顶栏: ← Back + 页面标题）:

| Workspace | Key | 描述 |
|-----------|-----|------|
| Office | `office` | 3D/2D 办公场景, `OfficeWorkspaceShellLazy` |
| SOPs | `sops` | sidebar(SOP list) + DAG canvas(Bezier, drag-to-connect) + NL command bar |
| Market | `market` | explore(card grid + detail) / manage(installed + published) |
| Activity Log | `activity-log` | 时间线 + 过滤器 + 事件详情 |
| Settings | `settings` | Provider/Runtime/MCP 配置 |

- `WorkspaceKey` = `'office' | 'sops' | 'market' | 'activity-log' | 'settings'`
- `AppView` = `WorkspaceKey` + legacy overlays (`employee-creator`, `office-editor`, `company-select`, `studio`)
- Office → `shouldShowAppShell()` → `OfficeWorkspaceShellLazy`; 其余 → `isFullPageWorkspaceView()` → `FullPageWorkspaceShell` + `WorkspaceRouter`
- `useWorkspaceSessionState`: updater `(prev: T) => T`, `updateWorkspaceState(key, updater)` 唯一写入路径
- `useWorkspaceBackNavigation`: 浏览器 history 集成, 先 unwind 内部状态再切 workspace
- 响应式: `computeLayoutTier()` → desktop(>1280) / tablet(769-1280) / narrow(≤768)

## Key Files

| Area | Entry point | Purpose |
|------|-------------|---------|
| Web SPA | `apps/web/src/App.tsx` | Root, workspace routing, runtime init |
| View classification | `apps/web/src/lib/app-view-layout.ts` | AppView 分类, shell 显示逻辑 |
| Workspace types | `apps/web/src/components/workspaces/types.ts` | WorkspaceKey, session state, layout tier |
| LangGraph kernel | `packages/core/src/graph/` | Boss/manager/employee nodes |
| Runtime bridge | `packages/ui-office/src/runtime/offisim-runtime-context.tsx` | React↔core |
| Scene orchestrator | `packages/ui-office/src/hooks/useSceneOrchestrator.ts` | 3D ceremony + movement |
| Scene routing | `packages/ui-office/src/lib/scene-behavior.ts` | Pathfinding + obstacle avoidance |
| Seat allocation | `packages/ui-office/src/lib/seat-registry.ts` | Prefab-aware seat/rest positions |
| Prefab spatial | `packages/ui-office/src/lib/prefab-spatial.ts` | Footprint + anchor per prefab type |
| Chat commands | `packages/ui-office/src/lib/chat-commands.ts` | Slash command registry |
| Ceremony visuals | `packages/ui-office/src/lib/ceremony-visuals.ts` | Phase colors, manager presence, bubble text |
| Zone resolution | `packages/shared-types/src/zone-resolution.ts` | Employee→zone by targetRoles |
| Company templates | `packages/core/src/services/company-template-service.ts` | Template + zone blueprint |
| Settings shared | `packages/ui-office/src/components/settings/SettingsWorkspaceSurface.tsx` | Page/dialog 共享 |
| SOP DAG editor | `packages/ui-office/src/components/sop/SopDagCanvas.tsx` | Canvas: pan/zoom, drag-to-connect, dot grid |
| SOP sidebar | `packages/ui-office/src/components/sop/SopSidebar.tsx` | SOP list sidebar |
| SOP layout algo | `packages/ui-office/src/components/sop/sop-dag-layout.ts` | Topo-sort batch layout, port positions |
| Platform API | `apps/platform/src/routes/` | Hono route handlers |

## Gotchas

### Build & Environment

- `packages/core/src/a2a/` 和 `packages/core/src/gateway/openclaw-client.ts` 是外派 agent 接入的扩展点代码（未来接外部 agent 用），当前未启用也无 UI 入口。核心员工 runtime 是 `anthropic-adapter` / `openai-adapter` / `subscription-adapter (ACP)`，不要混淆
- 浏览器代码必须用 `@offisim/core/browser`, 否则拉入 Node-only 依赖
- `apps/web/vite.config.ts` alias 必须与 `ui-office/package.json` exports 同步。新增 subpath export 时必须同时加 vite alias, 否则 dev mode 动态 import 会 404（dist 可能不存在）
- `subscription` provider 依赖 `node:child_process`, 桌面端专用; `gateway-factory.ts` 用 `require()` 动态加载避免进 browser bundle
- Tauri 包在浏览器 dev 被 stub 为空模块
- Dev 端口锁定: web=5176, launcher=4200, platform=4100 (strictPort)。Tauri beforeDevCommand 自动清理残留
- 修改 `shared-types` 后必须先 `pnpm --filter @offisim/shared-types build`
- `tauri-repos.test.ts` 依赖 `@offisim/db-local` 构建产物
- Linux/CI 必须 `--filter '!@offisim/desktop' --filter '!@offisim/launcher'` 跳过 Tauri
- Smoke tests 不加载 `.env.local`, 需手动 `export MINIMAX_API_KEY=...`
- Three.js jsdom 测试: `useRef<THREE.Group>.current` 非真 THREE.Group, 需 defensive cast
- `AnthropicAdapter` 非官方 endpoint 自动 CORS-friendly (Bearer 替 x-api-key, strip telemetry, `messages.create({stream:true})` 替 `.stream()`)
- `createCheckpointSaver()` 是 async, `SqliteSaver` 懒加载避免 browser 拉 Node 依赖

### Core Runtime

- `HookRegistry` (**同步串行**, `await emit()` 阻塞流控用) ≠ `EventBus` (**异步 fire-and-forget**, 前缀订阅 UI 推送), 不要合并。图节点常常两个都 emit
- `Scratchpad` per-runtime 临时存储, 持久化用 `MemoryService`
- `OffisimRuntimeProvider` init 异步, 依赖就绪的 useEffect 必须 deps 含 `version`, 不要用 `isInitializing`。**原因**: runtime 拆双 Context (`OffisimRuntimeContext` 稳定 + `OffisimRuntimeStatusContext` 易变), `version` 是后者的 bump 计数器, 不放 deps 闭包会陈旧
- Boss node JSON 路由 **三层** 防御: (1) `BOSS_SYSTEM_PROMPT` 规则 (boss-node.ts:35-76) (2) `TASK_KEYWORDS` 正则兜底 (208-218) (3) `targetEmployeeId` / `sopTemplateId` 有效性校验 (221-236)。修改时三层同步
- `NodeContextMiddleware` 共享 1800 char budget (summary 1000 + pack 700), 两半独立查询独立截断, 不要加独立 middleware
- `InstallService.planCache` 是实例属性, `dispose()` 清理, 不要模块层缓存
- Employee repo `create()` 可选 `employee_id`, `transact()` 中必须用预生成 ID (非 `void promise.then()`)

### Workspace IA & Navigation

- `App.tsx` 维护 `view` + `activeWorkspace` 双状态, 必须通过 `handleWorkspaceSwitch` 同步, 不要直接 `setView`
- 不要绕过 `useWorkspaceBackNavigation` 直接操作 history
- `MarketplaceDetailOverlay` 仅保留给 deep-link install, 其余走 workspace page
- `RegistryClient.hasAuthToken`: 调用认证端点（`/me`, `/drafts`）前必须检查, 无 token 时跳过请求
- `INSTALLABLE_KINDS` (marketplace-meta.tsx): 只有 `employee`。Skill 是 `employee.config_json.capabilityIndex` 的嵌入能力包, 不是独立可装实体。`PublishDialog` 只发布 employee, `KIND_FILTERS` 只有 `all`/`employee` 两项。sop / company_template / office_layout / prefab / bundle 的 publish / install 路径都不存在
- `onSessionStateChange` 签名是 `(updater: (prev: T) => T) => void`, useCallback deps 只需 `[onSessionStateChange]`
- `OfficeWorkspaceShell` props 三组: `navigation`, `employee`, `sceneView`

### UI / Scene / 3D

- `ceremony-visuals.ts`: `getPhaseColor()` 是 phase 颜色唯一真相; 同时持有 `MANAGER_PRESENCE_COLORS` + `DEFAULT_BUBBLE_TEXT`, 不要硬编码
- `CeremonyState` 新增字段必须同步 `createIdleCeremonyState()` 和 `IDLE_CEREMONY`
- `CeremonyHost` (App.tsx) 隔离 ceremony state, 不要把 `useSceneOrchestrator` 放 App 里
- 3D 崩溃 ≥2 次锁定 2D (`crashCountRef`)
- 员工定位统一走 `SeatRegistry` (3D/2D), 不要硬编码位置或恢复 4 象限布局
- 渲染用 `resolveEmployeeSceneZoneId()`, 不要用 `resolveEmployeeZoneDynamic()` (避免掉 UNASSIGNED_ZONE)
- 移动路由走 `scene-behavior.ts` → `buildTransitRoute()`, 不要直接 `handle.moveTo()`
- 新增 prefab 必须在 `prefab-spatial.ts` SPATIAL_SPECS 补数据
- Settings: `SettingsWorkspaceSurface.tsx` 拆出 primitives + ProviderTab + RuntimeTab。`SettingsPage` 用 capture-phase Escape handler 调 `controller.requestDismiss()` 拦截未保存更改。保存 runtimePolicy 必须含 `toolPermissions`
- UI 文案密度: 副标题仅在标题本身有歧义时使用, 不要每个 section 都加描述段落。删除营销文案、不要重复展示同一信息（如 provider name 只显示一处）
- Company 共享 primitive 在 `company-editor-primitives.tsx`, zone layout 在 `company-editor-layout.ts`
- Chat 命令: `chat-commands.ts` 三类 (runtime/client/panel), 新增只加 `CHAT_COMMANDS`。@mention 不切 direct chat
- UI 全英文, 不要混入中文
- `primeEventLogStore` 创建 20 订阅, cleanup 必须调 `disposeEventLogStore` (幂等)。`EVENT_PREFIXES` + `TYPE_PREFIX_MAP` 新增 filter 时同步

### Data Model & Zones

- Zone ID: DB 格式 `companyId::slug`, 用 `templateToZone(t, companyId)` normalize, `extractZoneSlug()` 提取。`companyId` 必填, preview/create 模式传 `STUDIO_PREVIEW_COMPANY_ID` / `WIZARD_PREVIEW_COMPANY_ID` sentinel (shared-types/zone.ts)。跨 company 重写用 `reparentZoneId(companyId, zoneId)` —— 注意 `normalizeZoneId` 对已含 `::` 的输入是 pass-through, 不能用来重锚。`saveZonesToDb` 用 `reparentZoneId` 强制按真实 companyId 重写 sentinel 前缀, DB 永远看不到 sentinel
- Render layer zone 查找 (Office3DView / Office2DView / office3d-shared / scene-nav / useSceneOrchestrator / StudioState.updateZoneId) 有意保持 strict `z.zoneId === zoneId` ——  Track A (2026-04-11) 杀了 drift 源头 (StudioPage 两处 bare-slug fallback + templateToZone 空 guard), 所有流到 render 的 zone 都是 prefixed, 无需 fuzzy 比较。**例外**: `StudioState.addZoneFromPreset` 用 `crypto.randomUUID()` 作 zoneId (raw UUID, 无 `::`), Studio 内部 zone+instance 自洽, 保存时 `reparentZoneId` 重写成 `${companyId}::${uuid}`, 不会泄漏到 render layer。不要为了"一致性"把 raw UUID 改成 prefixed —— Studio 未保存状态没有真实 companyId, 跟 saveZonesToDb 的重写是互补的
- 员工→zone 用 `resolveZoneForRole()` 按 targetRoles, 不要用 `ROLE_TO_DEPARTMENT`
- 模板 `CompanyTemplate.zones?` 自定义, 无时 fallback `SYSTEM_ZONE_TEMPLATES` (7)。用 `createZoneBlueprint()` 工厂
- zones 约束: 必须有 `rest`+`meeting` archetype, role 不可多 zone, 所有 role 需匹配
- `companies.default_model_policy_json` 实际存公司描述, 字段名误导但不可重命名
- Role 统一 `RoleSlug` branded type (shared-types/roles.ts)
- `getExecutionBatches()` 是 `SopService.getExecutionOrder()` 本地副本, 两处必须同步
- `PlanCreatedPayload.sopTemplateId` 贯穿 core→UI, 新增字段注意链路完整性
- Marketplace 安装**实际只有 employee 物化路径** (`materializer.ts:195-207` 唯一分支)。Skill 不是独立实体, 是嵌入到 employee `config_json.capabilityIndex` 的能力包 (L74-98)。CLAUDE.md 早期"支持 employee/skill"措辞误导。sop / company_template / office_layout / prefab 全部未完成
- `GitAutoCommitService` 桌面端专用, 浏览器 no-op
- `SopSyncService` 先 JSON.parse 再 stringify 比较 definition, 避免 key 顺序差异
- `useRegistryClient` baseUrl: localStorage → `VITE_PLATFORM_API_URL` → localhost:4100

### Platform API

- DB 连接错误返回 503, 非 500
- listing 必须用 `getVisibleListing()`/`requireVisibleListingById()` (强制 `status='listed'`), 不要直接 query
- `optionalAuth` email 冲突设 `authLinkConflict: true`, `requireAuth` 返回 `AUTH_LINK_CONFLICT` 401
- Reviews self-review 防护: creators JOIN 比较 user_id (403)
- Rate limiter 只信 `X-Forwarded-For` 最右第 N 个 IP (`TRUSTED_PROXY_DEPTH`), 不信 `X-Real-IP`
- creator 所有权走 `requireCreator` 中间件, 用 `getRequiredCreatorId(c)` / `findCreatorIdByUserId()`。`/me` 例外, 注册在 requireCreator 之前
- 测试 `createMockDb([results])` 按 callIndex 消费。加 middleware 前置 DB 查询会导致 mock 错位, 需同步调整

### Source-Verified Facts (2026-04-11 audit)

These are non-obvious code truths surfaced by the 5-agent source-level audit. Authoritative when in conflict with prose elsewhere.

- **desktop 内置 MCP bridge**: `apps/desktop/src-tauri/src/lib.rs:155` 注册 `mcp_bridge::init()` 插件 — desktop 有 web 没有的 MCP 能力。21 条 SQLite 迁移列在 lib.rs:6-137
- **desktop 是纯 Tauri 壳**: 零 npm deps, frontendDist 直接指 `../../web/dist`, 无独立前端
- **platform 没有后台队列**: `routes/publish.ts:251-309` Submit 同步调 `processModerationJob()` 立即返 202
- **platform 用 SHA-256 哈希存 API token** (不是明文); Better Auth 自动 upsert Offisim user; email 冲突设 `authLinkConflict=true`
- **platform fork 谱系**用 WITH RECURSIVE CTE 上下追 10 层 (`routes/market.ts:421-520`)
- **scene 第二次崩溃硬锁 2D**: 之后即使用户手动切回也无效 (`SceneCanvas.tsx:81-134`)
- **8 阶段 ceremony**: idle → gathering → analyzing → planning → dispatching → working → reporting → dismissing
- **doc-engine 的 xlsx** 来自 `cdn.sheetjs.com` (运行时拉, 不是 npm) — SheetJS 许可原因
- **renderer 与 ui-office 的 prefab**: `renderer/prefab/builtin-catalog.ts` 是**目录定义**(190+ frozen 对象), `ui-office/lib/prefab-spatial.ts` 是**空间 spec** (footprint/anchor/rotation), 两者通过 prefabId 关联但互不依赖。新增 prefab 必须在两边各加一份
- **CI gate 只有本地 husky**: 无 `.github/workflows/`。`.husky/pre-commit` 跑 `biome check --staged`（依赖 biome.json 的 `vcs` 块解析 staged 文件）。typecheck / test 不在 hook 里跑（太慢），仍靠开发者自觉。`--staged` 模式只检查本次改动，避免 legacy lint debt 阻塞新 commit。需要跳过时 `git commit --no-verify`
- **Repository 三套手写副本** (drizzle 1714L / memory 1508L / tauri 1657L) — 任何 repo 接口变更必须三处同步。`apps/web/src/__tests__/unit/repository-parity.test.ts` 通过 runtime reflect 守护: drizzle/tauri 严格相等，memory 必须是超集（class 实现 helper 如 `snapshot`/`key`/`setActive` 允许）。使用时直接 `import from '../../../../../packages/core/dist/...'` 绕过 vitest 的 `@offisim/core` alias 前缀吞噬子路径

## License and Key Model

Open source (MIT), BYO-key. 浏览器直调 vendor API, 无代理。
`subscription` provider 走 `claude acp` via `node:child_process`, 桌面端专用。
