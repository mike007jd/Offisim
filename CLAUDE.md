# CLAUDE.md

## Quick Start

```bash
pnpm install          # 安装依赖 (pnpm 10+, Node 20+)
pnpm build            # 全量构建 (turbo, 顺序: shared-types → core → ui-office → apps)
pnpm test             # 全量测试 (vitest)
pnpm typecheck        # 全量类型检查 (27 packages)
pnpm lint             # Biome check
pnpm lint:fix         # Biome auto-fix
pnpm format           # Biome format
pnpm clean            # 清除 turbo 缓存 + node_modules
```

单包操作:
```bash
pnpm --filter @offisim/core test        # 跑单包测试
pnpm --filter @offisim/core build       # 构建单包
cd apps/web && pnpm dev                 # 启动 web SPA (port 5176)
cd apps/platform && pnpm dev            # 启动 platform API (port 4100)
pnpm --filter @offisim/desktop dev      # 启动 Tauri 桌面应用 (复用 web port 5176)
```

Docker:
```bash
docker compose -f docker/docker-compose.yml up --build  # 一键启动 web + platform + postgres
```

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
  channels        — 通信渠道抽象
apps/
  web             — Vite + React 19 SPA (浏览器版)
  desktop         — Tauri 2 桌面应用
  platform        — Hono API 服务端
  launcher        — Tauri launcher
```

构建顺序: `shared-types → core → renderer/db-*/doc-engine/... → ui-office → apps`
Turbo 自动处理依赖拓扑, 手动开发时注意 `^build` 依赖链。

## Code Style

- Biome: 2-space indent, single quotes, trailing commas, semicolons, 100 char line width
- TypeScript strict mode (`noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`)
- ESM (`"module": "ESNext"`, `"moduleResolution": "bundler"`)
- 测试: vitest, `__tests__/` 目录, `.test.ts` 后缀
- 不写不必要的注释和 docstring — 代码自解释

## Environment

- Node 20+, pnpm 10+
- Desktop/Launcher 构建需要 Rust toolchain + Tauri CLI (`cargo install tauri-cli`)

## Gotchas

- `@offisim/core` 有 browser subpath (`@offisim/core/browser`) — 浏览器代码必须用它,
  否则会拉入 LangGraph/OpenAI SDK 等 Node-only 依赖
- `apps/web/vite.config.ts` 的 ui-office alias 列表必须与
  `packages/ui-office/package.json` 的 `exports` 字段保持同步
- `subscription` provider 依赖 `node:child_process`, 只能在桌面端运行,
  浏览器中会被 `shouldRejectSubscriptionInRenderer()` 拦截
- Tauri 包 (`@tauri-apps/*`) 在浏览器 dev 中被 stub 为空模块
- `gateway-factory.ts` 的 `subscription` case 用 `require()` 动态加载,
  避免 `node:child_process` 进入浏览器 bundle
- Dev 端口已锁定: web=5176 (`strictPort: true`), launcher=4200, platform=4100。
  Tauri `beforeDevCommand` 会先执行 `scripts/ensure-port-free.mjs` 杀掉占用端口的旧进程,
  防止 Vite 自动跳端口导致 Tauri `devUrl` 连到错误页面。
  关闭 Tauri 窗口不等于 `tauri dev` 进程结束, 但下次启动会自动清理残留
- Platform API 的错误处理: DB 连接错误返回 503, 非 500
- 修改 `shared-types` 的类型后必须先 `pnpm --filter @offisim/shared-types build`,
  否则依赖它的包 (core, ui-office 等) 看不到新类型
- `apps/web` 的 `tauri-repos.test.ts` 依赖 `@offisim/db-local` 构建产物,
  需要先 `pnpm --filter @offisim/db-local build` 或全量 `pnpm build`
- Three.js 组件在 jsdom 测试中, `useRef<THREE.Group>` 的 `.current` 不是真正的
  THREE.Group (没有 `.position.set()`), 需要 defensive cast + optional chaining
- `ceremony-visuals.ts` 的 `getPhaseColor()` 是 ceremony phase 颜色的唯一真相,
  新增 phase 相关颜色映射时必须调用它, 不要硬编码 hex 值
- `ceremony-visuals.ts` 同时持有 `MANAGER_PRESENCE_COLORS` 和 `DEFAULT_BUBBLE_TEXT`,
  涉及 manager 标记或 bubble 默认文本时从这里取, 不要在组件里硬编码
- `CeremonyState` 新增字段必须同步更新 `createIdleCeremonyState()` 和导出的
  `IDLE_CEREMONY` 常量 (`useSceneOrchestrator.ts`), 否则 SceneCanvas 的 fallback 会缺字段
- Scene ceremony state 通过 `CeremonyHost` (App.tsx) 隔离在独立组件中,
  不要把 `useSceneOrchestrator` 直接放在 App 里, 否则高频 ceremony 变化会级联全树 re-render
- Linux/CI 环境下构建和测试必须跳过 Tauri 包:
  `pnpm --filter '!@offisim/desktop' --filter '!@offisim/launcher' build`
  CI (`.github/workflows/ci.yml`) 仅在 PR 时触发 quality job (ubuntu), 无 macOS desktop job
- `HookRegistry` 和 `EventBus` 是两个独立的 pub/sub 通道:
  EventBus = 内部 UI 通知（同步, prefix-matching, 驱动 React hooks 和场景）;
  HookRegistry = 外部扩展钩子（异步, 有 timeout, 面向未来的插件/instrumentation）。
  两者监听同一领域事件但服务不同消费者, 不要合并
- `Scratchpad` 是 per-runtime 的临时跨节点笔记本, `disposeRuntime()` 时自动 clear。
  不要把它当持久存储用, 持久化用 `MemoryService`
- SceneCanvas 3D 崩溃后自动回退 2D, `crashCountRef` 记录崩溃次数,
  ≥2 次后锁定 2D 不再允许手动切回, 防止 crash loop
- Zone ID 在 DB 中格式为 `companyId::slug` (如 `abc::zone-dev`)。
  `templateToZone(t, companyId)` 已自动 normalize, 不会返回裸 slug。
  从 DB ID 提取 slug 用 `extractZoneSlug()` — 不要手写 `.split('::')`。
  `ui-office/lib/zone-config.ts` 已废弃, 不要导入
- 员工→zone 分配必须用 `resolveZoneForRole()` (zone-resolution.ts) 按 `targetRoles` 匹配,
  不要用 `ROLE_TO_DEPARTMENT` + `zone-${dept}` 构造 zone slug —
  `company-template-service` 已移除此模式, 因为 `content` 部门没有对应的 `zone-content`
- 公司模板可通过 `CompanyTemplate.zones?: TemplateZoneBlueprint[]` 自定义 zone 布局,
  无 zones 字段时 fallback 到 `SYSTEM_ZONE_TEMPLATES` (7 zone)。
  定义新 zone 时用 `createZoneBlueprint()` 工厂函数, archetype 默认值自动填充,
  只需声明 slug/archetype/label/坐标/尺寸 + workspace 的 targetRoles/deskSlots
- 每个模板的 zones 必须满足: 包含 `rest` + `meeting` archetype (REQUIRED_ARCHETYPES),
  同一 role 不能出现在多个 workspace zone 的 targetRoles 中,
  所有员工的 role_slug 都能匹配到某个 workspace zone
- `OffisimRuntimeProvider` 的 runtime init 是异步的, `runtimeRef` 是 ref 不触发 re-render。
  依赖 runtime 就绪的 useEffect 必须把 `version` 放在 deps 里 —
  init 完成后会 `setVersion(v+1)` 通知这些 effect。
  不要用 `isInitializing` 作为信号, 它不在这些 effect 的 deps 中
- `SettingsDialog` 保存 runtimePolicy 时必须包含 `toolPermissions` 字段,
  否则已有的 tool permission 配置会被静默覆盖为默认值
- Chat 命令系统集中在 `chat-commands.ts` (ui-office/lib),
  三种类型: `runtime` (发给 AI), `client` (本地 JS), `panel` (打开 UI)。
  新增命令只需在 `CHAT_COMMANDS` 数组添加条目, ChatInput 和 ChatPanel 自动发现。
  @mention 只做 inline 文本插入, 不切 direct chat — 进入 direct chat 的唯一方式是 Inspector Chat 按钮
- UI 全英文。新增面向用户的字符串必须用英文, 不要混入中文
- `companies.default_model_policy_json` 实际存储公司描述 (`{ description: "..." }`),
  字段名有误导性但已被多处读写依赖, 不要重命名
- Role 字段统一为 `RoleSlug` branded type (shared-types/roles.ts):
  EmployeeRow, SopStep, CompanyTemplateEmployee, StepTaskOutput, 事件 payload。
  不要用裸 `string` 声明 role 相关字段
- Marketplace 安装目前只支持 `employee` 和 `skill` 类型的包,
  `sop`/`company_template`/`office_layout` 的 materializer 尚未完成
- `GitAutoCommitService` 仅在桌面端(Tauri)生效, 通过 `git.rs` Rust bridge 执行 git 操作。
  浏览器端 no-op。由 HookRegistry `task.completed` hook 触发, 受 `runtimePolicy.gitAutoCommit` 开关控制
- SOP 远程同步 (`SopSyncService`) 比较 definition 时先 `JSON.parse` 两侧再 stringify,
  避免 key 顺序差异导致误判更新
- `useRegistryClient` hook 是 Marketplace 和 InstallFlow 的共享 RegistryClient 入口,
  baseUrl 从 `localStorage('offisim.registry.base-url')` → `VITE_PLATFORM_API_URL` → `localhost:4100` fallback
- `EventLog` 的 `EVENT_PREFIXES` 现有 20 个前缀, `TYPE_PREFIX_MAP` 类型收窄为
  `Record<EventFilterType, string[]>`, 新增 filter tab 时两处必须同步更新
- Boss node 是 JSON 路由器（不用 tool_use）, 输出 `action` 字段路由到 delegate/direct_reply/meeting 等。
  路由有两层防御: (1) `BOSS_SYSTEM_PROMPT` 的规则 + 决策优先级 + few-shot, (2) `TASK_KEYWORDS` 正则 heuristic
  把弱模型误判的 `direct_reply` override 为 `delegate_manager`。
  修改 Boss 路由行为时两层必须同步, 否则 prompt 改了但 heuristic 没跟上（或反过来）
- Smoke tests (`vitest.smoke.config.ts`) 不自动加载 `.env.local`,
  必须 `export MINIMAX_API_KEY=... && pnpm --filter @offisim/core exec vitest run --config vitest.smoke.config.ts`
- `NodeContextMiddleware` 有共享 1800 字符 budget: summary block (1000) + context pack (700)。
  构造时第三参数接受可选 `AgentContextPackService`, browser-runtime 和 tauri-runtime 已注册。
  不要再加独立的 context middleware — 扩展现有的共享 budget
- 员工 3D 定位通过 `SeatRegistry` (ui-office/lib/seat-registry.ts) 从 prefab instances 解析。
  有 prefab 的 zone 用 anchor 坐标，不够的位置用 fallback（zone center + SEAT_OFFSETS）。
  不要在 `useSceneOrchestrator` 或 `office3d-employees` 里硬编码员工位置
- Prefab 空间数据（footprint + anchors）在 `ui-office/lib/prefab-spatial.ts`，按 prefabId 查表。
  新增 prefab 类型时必须在 `SPATIAL_SPECS` 数组补 footprint/anchor 数据，
  否则 Studio 编辑器碰撞检测和员工定位都会退回 gridSize 粗略模式
- `computeRestSeatPosition()` (seat-registry.ts) 是 rest 区确定性螺旋布局的唯一实现，
  orchestrator 和 employees 的 fallback 都调用它。不要重复这段 angle/radius 公式
- SOP 可视化通过 `SopTimelineView` (ui-office/components/sop) 渲染 DAG 时间轴。
  `getExecutionBatches()` 是 `SopService.getExecutionOrder()` 的本地纯函数副本
  （避免实例化 SopService 仅为调用纯方法）。两处逻辑必须保持同步
- `PlanCreatedPayload.sopTemplateId` 贯穿 core→UI：
  `planCreated()` 工厂 → `pm-planner-node` 两条 SOP 路径 → `useSopRuntimeState(sopTemplateId)` 过滤。
  新增 plan 事件字段时注意此链路完整性
- Platform API 安全模式:
  listing 访问必须通过 `getVisibleListing(db, condition)` 或 `requireVisibleListingById(db, id)`,
  它们强制 `status = 'listed'` 过滤。不要直接 `db.select().from(listings).where(eq(id, ...))` —
  这会暴露 hidden/retired listing。受影响端点: GET listing by id/slug、versions、reviews
- `optionalAuth` 在 email 冲突时设置 `authLinkConflict: true`（已绑定 ba_user_id 的用户被
  不同 OAuth 账号尝试 link），`requireAuth` 返回 `AUTH_LINK_CONFLICT` 401。
  修改 auth 流程时注意此状态通过 `PlatformEnv.Variables` 传递
- Reviews 路由有 self-review 防护: 通过 creators JOIN 比较 `user_id`，
  创作者不能评自己的 listing (403)
- Rate limiter 只信任 `X-Forwarded-For` 最右第 N 个 IP (`TRUSTED_PROXY_DEPTH` 环境变量),
  不信任 `X-Real-IP`。生产部署必须配置反向代理覆盖 XFF
- `PrefabDefinition` 是基于 `composite` 的 discriminated union:
  `CompositePrefabDefinition` (composite: true, 必须有 children, 无 render2D) 和
  `AtomicPrefabDefinition` (composite: false, 必须有 render2D, 无 children)。
  新增 prefab 时编译器会强制要求正确字段
- `InstallService.planCache` 是实例属性（非模块单例），`dispose()` 时自动清理。
  browser-runtime 和 tauri-runtime 的 dispose 链路已接入。
  不要在模块层面缓存 install plan
- Employee repos (`create()`) 接受可选的 `employee_id` 字段用于 pre-generated ID。
  在 `transact()` 同步事务中必须使用预生成 ID，不要用 `void promise.then()` 捕获返回值 —
  Promise.then 回调是微任务，不会在当前同步代码中执行
- Platform 路由中 creator 所有权校验统一走 `requireCreator` 中间件 (`middleware/auth.ts`),
  通过 `getRequiredCreatorId(c)` 取 creator_id。共享的 creator lookup 用
  `findCreatorIdByUserId(db, userId)`。不要在每个 handler 里手写
  `db.select().from(creators).where(eq(creators.user_id, ...))` — 这是已淘汰的模式。
  `/me` 是例外（非 creator 返回 null），必须注册在 `publish.use('/drafts/*', requireCreator)` 之前
- `primeEventLogStore(eventBus)` 创建 20 个 EventBus 订阅（每个 EVENT_PREFIX 一个），
  必须在 useEffect cleanup 里调 `disposeEventLogStore(eventBus)` 解绑，否则组件重 mount 会累积订阅。
  App.tsx 和 OffisimRuntimeProvider unmount 都已调用，`disposeEventLogStore` 幂等（WeakMap 检查）
- Platform 测试的 `createMockDb([results])` 按 callIndex 顺序消费 DB 调用结果。
  给路由加新 middleware（如 `requireCreator`）会在 handler 之前多查一次 DB，
  现有测试的 mock 数组必须在最前面插入 middleware 的查询结果，否则 callIndex 错位导致
  403/400/404 语义漂移。重构中间件后必须同步更新所有相关测试的 mock 序列

## License and Key Model

Offisim is open source (MIT) and BYO-key — users supply their own vendor
credentials (`anthropic`, `openai`, `openai-compat`, `minimax` via
`openai-compat`, etc.). The browser bundle calls vendor APIs directly;
Offisim does not host any proxy or shared key path. The `subscription`
provider runs `claude acp` via `node:child_process` and is desktop-only.
