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

- `apps/web/vite.config.ts` alias 必须与 `ui-office/package.json` exports 同步。新增 subpath export 时必须同时加 vite alias, 否则 dev mode 动态 import 会 404
- Tauri 包在浏览器 dev 被 stub 为空模块
- Dev 端口锁定: web=5176, launcher=4200, platform=4100 (strictPort)
- 修改 `shared-types` 后必须先 `pnpm --filter @offisim/shared-types build`
- `tauri-repos.test.ts` 依赖 `@offisim/db-local` 构建产物
- Linux/CI 必须 `--filter '!@offisim/desktop' --filter '!@offisim/launcher'` 跳过 Tauri
- Smoke tests 不加载 `.env.local`, 需手动 `export MINIMAX_API_KEY=...`
- Three.js jsdom 测试: `useRef<THREE.Group>.current` 非真 THREE.Group, 需 defensive cast

### Package-Specific Gotchas

详细 gotchas 已下沉到各包自己的 CLAUDE.md:
- **`packages/core/CLAUDE.md`** — Core Runtime, Data Model & Zones, Repository 三副本
- **`packages/ui-office/CLAUDE.md`** — Workspace IA, Navigation, UI/Scene/3D, Prefab 双文件
- **`apps/platform/CLAUDE.md`** — Platform API, 测试 mock 模式

### Cross-Cutting Facts (2026-04-11 audit)

- **desktop 内置 MCP bridge**: `lib.rs` 注册 `mcp_bridge::init()` — desktop 有 web 没有的 MCP 能力。21 条 SQLite 迁移在 `fn migrations()`
- **desktop 是纯 Tauri 壳**: 零 npm deps, frontendDist 直接指 `../../web/dist`
- **8 阶段 ceremony**: idle → gathering → analyzing → planning → dispatching → working → reporting → dismissing
- **doc-engine 的 xlsx** 走 `package.json` 里的 `"xlsx": "https://cdn.sheetjs.com/..tgz"` (install-time 拉, 非 npm registry) — SheetJS 许可原因
- **CI gate 只有本地 husky**: `.husky/pre-commit` 跑 `biome check --staged`。typecheck / test 不在 hook 里。需要跳过时 `git commit --no-verify`

## Ground Truth

- `Docs/business-logic-map.md` — 业务逻辑真相源（产品定义 + 数据模型 + 四循环）
- 产品方向："过程即价值"——凡是系统做了的事，玩家必须能看到、理解、干预
- `Docs/archive/2026-04/` — 已归档的阶段性审计 + T0-T3 UX transparency spec（已全部落地，commit `3e8e11d` + `4ac8390`），不要当作 active artifact

## Truth-source priority (AI 接手必读)

当信息冲突时，严格按此顺序信任：

1. **代码 + `git log`** — 唯一活真相
2. **本 CLAUDE.md + 子包 CLAUDE.md** — 人肉维护的规则与 gotchas
3. **`Docs/` 非 archive 的活文档**（`business-logic-map.md` 等）
4. **MEMORY.md 的 "Current State" 段** — 上一轮 session 的快照，可能过期
5. **memory 里带 `[HISTORICAL]` 或 `[CLOSED]` 标记的文件** — 纯历史快照，不是活状态
6. **`Docs/archive/`** — 历史文档，内部 refs 已冻结

**规则：AI 开工前先 `git log --oneline -10` 核对最近 commit。memory / spec / 活文档与 git 冲突时，永远信 git；发现冲突即刻更新上层文档，不要沉默地跳过。**

## License and Key Model

Open source (MIT), BYO-key. 浏览器直调 vendor API, 无代理。
`subscription` provider 走 `claude acp` via `node:child_process`, 桌面端专用。
