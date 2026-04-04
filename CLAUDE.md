# CLAUDE.md

## Quick Start

```bash
pnpm install          # 安装依赖 (pnpm 10+, Node 20+)
pnpm build            # 全量构建 (turbo, 顺序: shared-types → core → ui-office → apps)
pnpm test             # 全量测试 (vitest, ~1890+ tests)
pnpm typecheck        # 全量类型检查 (27 packages)
pnpm lint             # Biome check
pnpm lint:fix         # Biome auto-fix
pnpm format           # Biome format
pnpm clean            # 清除 turbo 缓存 + node_modules
pnpm check:provider-policy  # CI guard: 扫描生产代码中的 vendor-direct 用法
```

单包操作:
```bash
pnpm --filter @offisim/core test        # 跑单包测试
pnpm --filter @offisim/core build       # 构建单包
cd apps/web && pnpm dev                 # 启动 web SPA (port 5176)
cd apps/platform && pnpm dev            # 启动 platform API (port 4100)
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

## Product Boundary: AI Runtime Policy

Offisim must use its own agent/runtime pipeline as the only production AI path.

The distinction is **self-developed runtime vs vendor-direct**, not about any specific transport name.
`subscription` is one currently-implemented self-developed transport adapter (ACP via `claude acp`).
Future self-developed transports are equally valid production paths.
External vendor direct connections (`openai`, `anthropic`, `openai-compat`) are NOT valid production paths.

### Hard Rules

1. **Production AI path**
   - All user-facing AI interactions must go through the Offisim agent/runtime flow
     (boss -> manager -> employee graph nodes, orchestrated by OrchestrationService).
   - Direct `gateway.chat()` from UI code is never a valid production path.

2. **Provider classification**
   - Production-allowed: self-developed transport adapters (currently `subscription`).
   - Adapter-only: `openai`, `anthropic`, `openai-compat` — these exist in `gateway-factory.ts`
     as transport-layer code for the runtime to use internally, but must not be selectable
     as production provider in UI or runtime creation.
   - Future self-developed transports can be added to the production-allowed set by updating
     this policy.

3. **No vendor-direct transport in production**
   - Do not add or retain production paths that directly call OpenAI, Anthropic, OpenRouter,
     or other vendor endpoints as a product capability.
   - Tauri desktop bridge (`provider_chat` -> `reqwest` -> vendor API) must not be a production path.
   - Browser and shared runtime code must not bypass the Offisim runtime pipeline.

4. **Unified recorded path**
   - All AI calls must be recorded through `recordedLlmCall()` / `recordedLlmStream()`.
   - All AI calls must produce audit data in `llm_calls` table and emit runtime events
     (`llm.call.started`, `llm.call.completed`, `llm.usage.recorded`).
   - System services that call `llmGateway.chat()` directly must be migrated to a
     `RecordedSystemLlmCaller` wrapper with stable `nodeName` identifiers.

5. **Test-only exceptions**
   - Direct provider calls are allowed only in isolated test/dev code (`__tests__/`, `e2e/`).
   - Test-only code must not be imported by production runtime or UI code.
   - `gateway-factory.ts` is transport-layer infrastructure — it may support all providers
     for testing and adapter development, but production runtime must guard which providers
     are accepted.

6. **Review rule**
   - Any change touching provider config, runtime creation, gateway construction, or AI
     service calls must be reviewed against this policy.
   - If a change makes vendor-direct usage easier, broader, or more implicit in production
     paths, it is the wrong direction.
