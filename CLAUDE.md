# CLAUDE.md

## Quick Start

```bash
pnpm install          # 安装依赖 (pnpm 10+, Node 20+)
pnpm build            # 全量构建 (turbo, 顺序: shared-types → core → renderer/db-*/doc-engine/... → ui-office → apps)
pnpm typecheck        # 全量类型检查 (16 packages)
pnpm lint             # Biome check
pnpm lint:fix         # Biome auto-fix
pnpm format           # Biome format
pnpm clean            # 清除 turbo 缓存 + node_modules
```

单包操作:
```bash
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
- 不写不必要的注释和 docstring

## Validation Policy

- **仓库已移除自动化测试**。不要再引入 vitest / playwright / smoke / AI test / `test` 脚本。
- **验证统一用 live agent 手测**：真实浏览器 / 真实桌面 runtime / 真实用户流，边操作边观察，不靠自动断言自证。
- 绿 typecheck / build 只代表代码能编，不代表功能完成。功能完成必须有 live runtime 证据。
- 若需要记录验证结果，把步骤、观察、截图/日志写进 memory 或 handoff；不要回补自动测试。
- **验证层级不能越界**：web 页面问题只用浏览器层工具（snapshot / screenshot / console / network）。不要为 web 流程调用 AppleScript、系统级前台切换或原生窗口自动化。AppleScript 只允许用于 Tauri / macOS 原生壳验证。

## Product Closure Bar

- **功能完成的标准不是“能跑”，而是“用户真能用”**。新功能必须在 live runtime 里完整走通主路径，不能停在 transport / event / placeholder 层。
- **UX 必须优雅简洁**。默认优先减少层级、噪声、重复状态、营销文案、解释型空话；不要把内部过程日志顶到主内容位。
- **同一功能的多块表面必须讲同一个故事**。chat、scene、status bar、tasks、deliverable、onboarding 之间如果状态不一致，视为未完成。
- **不要靠 fallback 假装完成**。placeholder、legacy prefix、隐藏的兼容分支、只在特定模式可用的半闭环，不算关单。

## Repository Hygiene

- **仓库必须持续做卫生**：死文档、测试残留、历史截图、调试输出、生成产物、临时脚本，不要长期留在版本库里。
- **提交前优先删垃圾，而不是解释垃圾**。`output/`、`screenshots/`、`.playwright-mcp/`、局部 debug 脚本、失效 spec/sample 图，默认不应进仓。
- **deprecated 代码不是常驻资产**。如果 fallback 已无产品 owner，优先列入删除计划；不要无限保留 `Pending removal` 路径。
- **警惕屎山热点**：超长文件、双状态源、跨层事件拼装、巨型组件/服务默认视为风险面，开工前先判断是不是该拆。

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
- **Tauri / browser 双模导入已分叉**: 浏览器 dev 继续走精确 stub, `tauri dev/build` 允许真实加载 `@tauri-apps/api/*` / `plugin-fs` / `plugin-sql`。新增 Tauri 依赖时必须同时补 browser stub 或 alias, 否则浏览器模式会直接炸
- Dev 端口锁定: web=5176, launcher=4200, platform=4100 (strictPort)
- 修改 `shared-types` 后必须先 `pnpm --filter @offisim/shared-types build`
- `tauri-repos.test.ts` 依赖 `@offisim/db-local` 构建产物
- Linux/CI 必须 `--filter '!@offisim/desktop' --filter '!@offisim/launcher'` 跳过 Tauri
- Three.js 非真实运行时对象可能不完整, 代码里要做 defensive cast / null guard, 不要假设测试环境会替你兜底

### Package-Specific Gotchas

详细 gotchas 已下沉到各包自己的 CLAUDE.md:
- **`packages/core/CLAUDE.md`** — Core Runtime, Data Model & Zones, Repository 三副本
- **`packages/ui-office/CLAUDE.md`** — Workspace IA, Navigation, UI/Scene/3D, Prefab 双文件
- **`apps/platform/CLAUDE.md`** — Platform API, 测试 mock 模式

### Cross-Cutting Facts (2026-04-11 audit)

- **desktop 内置 MCP bridge**: `lib.rs` 注册 `mcp_bridge::init()` — desktop 有 web 没有的 MCP 能力。28 条 SQLite 迁移在 `fn migrations()`
- **desktop 是纯 Tauri 壳**: 零 npm deps, frontendDist 直接指 `../../web/dist`
- **desktop Rust 端 plugin 三件套** (Phase 1c 补齐): `Cargo.toml` `tauri-plugin-fs = "2"` + `lib.rs` `.plugin(tauri_plugin_fs::init())` + `capabilities/default.json` `fs:default` + `fs:allow-app-{read,write,meta}-recursive`。**动 vault / Tauri fs 路径前核对这三处都在**, 任一缺失都是 runtime 静默 no-op (Phase 1c 翻车原点)
- **`isTauri()` 统一认 `__TAURI_INTERNALS__`**: Tauri 2 默认 `withGlobalTauri:false` 不注入 `__TAURI__`。新代码不要再依赖 `window.__TAURI__`
- **8 阶段 ceremony**: idle → gathering → analyzing → planning → dispatching → working → reporting → dismissing
- **doc-engine 的 xlsx** 走 `package.json` 里的 `"xlsx": "https://cdn.sheetjs.com/..tgz"` (install-time 拉, 非 npm registry) — SheetJS 许可原因
- **仓库已无自动 gate**: 不再保留 husky / typecheck / test / smoke 自动校验链。验证统一走 live agent。
- **2026-04-14 起自动测试策略作废**: 过去的 `vitest` / `playwright` / `__VAULT_SMOKE__` / auto-smoke 链已删除。以后遇到 runtime / UI / vault / Tauri 问题，直接 live agent 验证，不要重建自动 smoke。
- **2D office 方向已改判并已完成主路径切换**: 旧 SVG 2D 路径已经删除。后续不要复活 SVG scene grammar；2D 场景主渲染保持 `canvas`, DOM 只保留文字/tooltip/panel/按钮等交互壳。

## Ground Truth

- `Docs/business-logic-map.md` — 业务逻辑真相源（产品定义 + 数据模型 + 四循环）
- 产品方向："过程即价值"——凡是系统做了的事，玩家必须能看到、理解、干预
- `Docs/archive/2026-04/` — 已归档的阶段性审计 + T0-T3 UX transparency spec（已全部落地，commit `3e8e11d` + `4ac8390`），不要当作 active artifact

## Truth-source priority (AI 接手必读)

当信息冲突时，严格按此顺序信任：

1. **代码 + `git log`** — 唯一活真相
2. **本 CLAUDE.md + 子包 CLAUDE.md** — 人肉维护的规则与 gotchas
3. **`Docs/` 非 archive 的活文档**（`business-logic-map.md` 等）
4. **`Docs/archive/`** — 历史文档，内部 refs 已冻结

**规则：AI 开工前先 `git log --oneline -10` 核对最近 commit。spec / 活文档与 git 冲突时，永远信 git；发现冲突即刻更新上层文档，不要沉默地跳过。**

## License and Key Model

Open source (MIT), BYO-key. 浏览器直调 vendor API, 无代理。
`subscription` provider 走 `claude acp` via `node:child_process`, 桌面端专用。

### Web Provider Defaults

- `apps/web/vite.config.ts` dev 模式会从 **repo root `.env.local`** 读取 `MINIMAX_*`，并注入成 `VITE_MINIMAX_*`
- `packages/ui-office/src/lib/provider-config.ts` 在 **没有本地已保存 ProviderConfig** 时，会自动用 env 起一个 `MiniMax Global` 默认配置
- 这条能力的目标是 **web live AI 验证 / 演示 / 轻量入口**，不是替代 Tauri 的正式本地工作流
- 若 UI 没显示 key，不要先假设 env 没读到：浏览器侧优先看当前 provider label / model / live request 是否真走 MiniMax；桌面侧 secure key 可能被 secret store 掩码

### Live Product Findings (2026-04-14 audit)

- `web` live 审计已确认：真实 MiniMax 请求能跑通，底部 token / cost / latency 都是真值
- chat 当前 **不是强感知 streaming UX**：用户常先看到 placeholder（如 `Working through the request...`），再一次性落完整答案。后续若修 chat，目标应是“正文 chunk 真正在气泡里增长”
- 3D 员工外观当前与 2D DiceBear 头像 **不是同一来源**：3D 走 `office3d-employees.tsx` 的硬编码 `OUTFIT_COLORS / SKIN_TONES`，2D 走 DiceBear seed。不要假设 2D/3D 已经视觉对齐
- A2A 的产品抽象已定向为 **external department / 外包部门**，不是外部员工 avatar。未来接入先做部门卡、能力、路由和结果归属，不要先塞进办公室座位语义

## Interop

外部 agent 接入 = **A2A only** (HTTP JSON-RPC, `packages/core/src/a2a/`)。
OpenClaw 旧 gateway / SKILL.md 文件导入 / Lobster3D 场景分支已于 2026-04-14 全量移除, 对应 GDD 归档到 `Docs/archive/2026-04/OFFISIM_RUNTIME_EXPERIENCE_GDD.md`。未来若要接入带品牌外观的外包员工, 按 A2A agent card 元数据路由, 不要复活旧 role string 分支。
