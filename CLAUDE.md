# CLAUDE.md

## Quick Start

```bash
pnpm install          # 安装依赖 (pnpm 10+, Node 20+)
pnpm build            # 全量构建 (turbo, 顺序: shared-types → core → ui-office → apps)
pnpm test             # 全量测试 (vitest, ~1460+ tests)
pnpm typecheck        # 全量类型检查 (16 packages)
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
