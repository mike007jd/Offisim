# CLAUDE.md

## Quick Start

```bash
pnpm install          # 安装依赖 (pnpm 10+, Node 20+)
pnpm build            # 全量构建 (turbo, 顺序: shared-types → core → renderer/db-*/doc-engine/... → ui-office → apps)
pnpm typecheck        # 全量类型检查 (11 packages + 4 apps)
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
  launcher        — dev/support Tauri launcher（非当前生产主入口）
catalog/
  provider-source-registry — provider 元数据 catalog (generated 大文件: curated-catalog / merged-catalog / raw-source-snapshots + sources.json + registry.schema.json + curated-overrides)
```

构建顺序: `shared-types → core → renderer/db-*/doc-engine/... → ui-office → apps`

## Code Style

- Biome: 2-space indent, single quotes, trailing commas, semicolons, 100 char line width
- TypeScript strict mode (`noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`)
- ESM (`"module": "ESNext"`, `"moduleResolution": "bundler"`)
- 不写不必要的注释和 docstring

## Validation Policy

- **仓库已移除产品级自动化测试**。不要再引入 vitest / playwright / 旧 smoke / AI test / 普通 `test` 脚本来当 product 验收。
- **deterministic harness 例外**（2026-04-28 起）：`packages/core/harness/scenarios/` + `packages/core/src/testing/` + `scripts/harness-{contract,replay,provider-adapter}.mjs` 是允许的"确定性回放证明"层。定位是 graph / runtime / permission / plan-review 等不变量的 replay 资产，由 fake/replay gateway 喂确定性输入、对 trace 做 invariant 断言；它**不是** product 验收，也**不替代** live agent 手测。新增 scenario / invariant 走这条；不要把它扩成 vitest/playwright 风格的 product e2e。
- **deterministic harness 反自证规则**（2026-04-29 起）：不要用 LLM mock content 等于 `finalOutputContains` 来证明行为；`FakeGateway` turn 必须带 prompt/tool match；`RecordingToolExecutor` 必须有显式 `toolFixtures`，fixture 缺失应失败；`expectError` 只能用于明确业务异常，不能拿 `FakeGateway exhausted` 当通过条件。
- **验证统一用 live agent 手测**（功能验收）：真实浏览器 / 真实桌面 runtime / 真实用户流，边操作边观察，不靠自动断言自证。
- 绿 typecheck / build / harness contract 只代表代码能编 + graph 不变量没破，不代表功能完成。功能完成必须有 live runtime 证据。
- 若需要记录验证结果，把步骤、观察、截图/日志写进 memory 或 handoff；不要回补 product 自动测试。
- **验证层级不能越界**：web 页面问题只用浏览器层工具（snapshot / screenshot / console / network）。不要为 web 流程调用 AppleScript、系统级前台切换或原生窗口自动化。AppleScript 只允许用于 Tauri / macOS 原生壳验证。

## Product Closure Bar

- **功能完成的标准不是“能跑”，而是“用户真能用”**。新功能必须在 live runtime 里完整走通主路径，不能停在 transport / event / placeholder 层。
- **UX 必须优雅简洁**。默认优先减少层级、噪声、重复状态、营销文案、解释型空话；不要把内部过程日志顶到主内容位。
- **同一功能的多块表面必须讲同一个故事**。chat、scene、status bar、tasks、deliverable、onboarding 之间如果状态不一致，视为未完成。
- **不要靠 fallback 假装完成**。placeholder、legacy prefix、隐藏的兼容分支、只在特定模式可用的半闭环，不算关单。
- **禁止最小化交付口径**。执行型任务默认完整交付整个用户 scope；不要把“先做核心 / MVP / 编译通过 / harness 通过 / 部分验收”包装成完成。
- **完整交付必须闭环到证据**：实现真实修复，同步 spec / docs / tasks，跑要求的 gate，完成必要的 release / live runtime 验证，并把证据和剩余风险写进对应 report / handoff。
- **真实阻塞只能阻塞，不能降级成完成**。缺凭证、外部服务不可达、设备不可用、破坏性风险或产品决策无法推断时，必须保留未勾 task、tag gate、archive gate，并明确写“未完整交付”的根因和所需条件。
- **known limitation 不是验收证据**。如果 live 验证暴露新 blocker，先修能修的真实问题；不能修的直接 surface，不得缩小 scope、口头解释或用 fallback 路径替代原验收。
- **本地工具任务不能错投外包/SDK**。涉及 workspace 文件、路径、shell、bash、pnpm/cargo/npm、越界拒绝、timeout 的任务只能由 internal + gateway 工具员工执行。external A2A 员工和 `claude-agent-sdk` / `codex-agent-sdk` / `openai-agents-sdk` lane 不能被当成本机文件/命令执行者。
- **release 桌面验收要用新 UI dist**。只要改过 `packages/ui-office`，必须先 `pnpm --filter @offisim/ui-office build`，再 `pnpm --filter @offisim/desktop build`，否则 release `.app` 可能还是旧 Kanban/Settings UI。

## Repository Hygiene

- **仓库必须持续做卫生**：死文档、测试残留、历史截图、调试输出、生成产物、临时脚本，不要长期留在版本库里。
- **提交前优先删垃圾，而不是解释垃圾**。`output/`、`screenshots/`、`.playwright-mcp/`、局部 debug 脚本、失效 spec/sample 图，默认不应进仓。
- **deprecated 代码不是常驻资产**。如果 fallback 已无产品 owner，优先列入删除计划；不要无限保留 `Pending removal` 路径。
- **警惕屎山热点**：超长文件、双状态源、跨层事件拼装、巨型组件/服务默认视为风险面，开工前先判断是不是该拆。

## Environment

- Node 20+, pnpm 10+
- Desktop/Launcher: Rust toolchain + Tauri CLI (`cargo install tauri-cli`)

## Workspace IA

6 个 peer-level workspace, 统一走 `AppLayout`。Office 时 side panel 全挂，非 Office 时 side panel 传 null、center 走 `WorkspaceRouter`。Header 按 `activeWorkspace` 自适应。

| Workspace | Key | 描述 |
|-----------|-----|------|
| Office | `office` | 3D/2D 办公场景, AppLayout 全 slot |
| SOPs | `sops` | sidebar(SOP list) + DAG canvas(Bezier, drag-to-connect) + NL command bar |
| Market | `market` | explore(card grid + detail) / manage(installed + published) |
| Personnel | `personnel` | 员工列表 + 详情 + 6 tab inspector (Profile/Appearance/Runtime/Skills/Memory/History) |
| Activity Log | `activity-log` | 时间线 + 过滤器 + 事件详情 |
| Settings | `settings` | Provider/Runtime/MCP 配置 |

- `WorkspaceKey` = `'office' | 'sops' | 'market' | 'personnel' | 'activity-log' | 'settings'`
- `OverlayKey` = `'employee-creator' | 'office-editor' | 'company-select' | 'studio'`（正交于 workspace；员工 edit 不再走 overlay，统一路由 Personnel）
- URL routing SSOT 在 `apps/web/src/lib/url-routing/`：workspace 切换、primary entity、overlay、filter/search 状态先序列化到 URL，再由 `useUrlSync()` 统一写 `history.pushState/replaceState`；不要恢复旧的内部 workspace history stack。
- `useWorkspaceSessionState`: updater `(prev: T) => T`, `updateWorkspaceState(key, updater)` 仍是 session state 唯一写入路径；Escape 可做 workspace 内部 drill-back，浏览器 Back/Forward 走 URL parser。
- 响应式: `computeLayoutTier()` → desktop(>1280) / tablet(769-1280) / narrow(≤768)

## Key Files

| Area | Entry point | Purpose |
|------|-------------|---------|
| Web SPA | `apps/web/src/App.tsx` | Root, workspace routing, runtime init |
| View types | `apps/web/src/lib/app-view-layout.ts` | OverlayKey, OfficeViewMode 类型 |
| Workspace types | `apps/web/src/components/workspaces/types.ts` | WorkspaceKey, session state, layout tier |
| Personnel page | `packages/ui-office/src/components/employees/PersonnelPage.tsx` | List + detail + 6-tab inspector (employee edit lives here) |
| Personnel routing | `apps/web/src/lib/personnel-routing.ts` | `routeToPersonnel(id, tab)` — single entry for cross-surface employee edit |
| URL routing | `apps/web/src/lib/url-routing/` | parser + serializer + fallback + `useUrlSync`; deep links / Back / Forward 的 canonical path |
| Project create/edit | `packages/ui-office/src/components/project/ProjectCreateDialog.tsx` | Single dialog for both create + edit modes; opened from header selector + chat strip |
| Project context strip | `packages/ui-office/src/components/project/ProjectContextStrip.tsx` | Strip at top of ChatPanel; `Project · {name} · {folder?}` + Open folder + Edit |
| Folder picker bridge | `packages/ui-office/src/lib/folder-picker.ts` | `pickWorkspaceFolder` / `revealWorkspaceFolder` SSOT — Tauri dialog + opener plugins; web throws `FolderPickerUnavailableError` |
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
- **验证命令按依赖顺序串行跑**: `shared-types -> ui-core -> core -> ui-office -> web`。不要并行跑 `core/ui-office/web`; `web build` 会读 `core/dist`，并行时容易拿到旧产物产生假失败/假通过。
- **Tauri release CSP 与 platform dev origin 必须同步**: release `.app` 的 `connect-src` 至少包含 `http://localhost:4100` / `https://localhost:4100` / `tauri://localhost`，与 `apps/platform/src/startup.ts` 的 dev CORS 口径一起维护；不要为了过 CSP 放开任意 localhost 端口。
- `tauri-repos.test.ts` 依赖 `@offisim/db-local` 构建产物
- Linux/CI 必须 `--filter '!@offisim/desktop' --filter '!@offisim/launcher'` 跳过 Tauri
- Three.js 非真实运行时对象可能不完整, 代码里要做 defensive cast / null guard, 不要假设测试环境会替你兜底

### Package-Specific Gotchas

详细 gotchas 已下沉到各包自己的 CLAUDE.md:
- **`packages/core/CLAUDE.md`** — Core Runtime, Data Model & Zones, Repository 三副本
- **`packages/ui-office/CLAUDE.md`** — Workspace IA, Navigation, UI/Scene/3D, Prefab 双文件
- **`apps/platform/CLAUDE.md`** — Platform API, 测试 mock 模式

### Cross-Cutting Facts

- **desktop 内置 MCP bridge**: `lib.rs` 注册 `mcp_bridge::init()` — desktop 有 web 没有的 MCP 能力。本地 SQLite 现在是未上线口径的单基线 schema：`packages/db-local/src/schema.sql`，desktop 启动时由 `local_db.rs` 直接 bootstrap，不保留 migration 链。
- **desktop 是纯 Tauri 壳**: 零 npm deps, frontendDist 直接指 `../../web/dist`
- **desktop Rust 端 plugin 三件套** (Phase 1c 补齐): `Cargo.toml` `tauri-plugin-fs = "2"` + `lib.rs` `.plugin(tauri_plugin_fs::init())` + `capabilities/default.json` `fs:default` + `fs:allow-app-{read,write,meta}-recursive`。**动 vault / Tauri fs 路径前核对这三处都在**, 任一缺失都是 runtime 静默 no-op (Phase 1c 翻车原点)
- **desktop 必须 single-instance**: `tauri-plugin-single-instance = "2"` 要放在 `apps/desktop/src-tauri/src/lib.rs` 的 `.plugin(...)` 最前面，先于 `tauri-plugin-sql` / 其他 plugin 初始化。否则第二个 Tauri dev / binary 会和已运行实例共用 `appDataDir/offisim.db`，撞上 SQLite 写锁后表现成前端 runtime 初始化挂住、黑屏 webview。
- **`isTauri()` 统一认 `__TAURI_INTERNALS__`**: Tauri 2 默认 `withGlobalTauri:false` 不注入 `__TAURI__`。新代码不要再依赖 `window.__TAURI__`
- **8 阶段 ceremony**: idle → gathering → analyzing → planning → dispatching → working → reporting → dismissing
- **本地工具路由 SSOT**: `packages/core/src/agents/task-tool-intent.ts`（`detectTaskToolIntent` + `evidenceToolsForIntent`）。boss / pm-planner preflight / yolo / direct-setup 在入口算一次存到 `state.taskToolIntent`，下游消费 state field（不许再 grep 文本）。Bare-noun / narrative prose 不触发；只接 verb+object pairs / 显式 tool tokens / 中文 imperative。
- **路由 rebind 事件**: `task.assignment.rerouted`（`shared-types/events/task.ts`），`source: 'manager' | 'pm-planner'`，`reason: 'requires-local-tools' | 'employee-not-found' | 'employee-disabled' | 'no-recommendation-fallback'`。manager 把 LLM-picked external 过滤掉时、`pm-planner/sanitize-rebind.ts` 换 missing/disabled 员工时都要 emit + `logger.info` 镜像。activity feed 形态：连续 3+ 同 source+reason+taskRunId collapse 成一行 `×N` badge。
- **Tauri bounded preview IPC**: `project_read_file_preview(path, cwd, max_bytes)` Rust hardcap 64 KB + UTF-8 boundary walk-back。文件树 UI（`ProjectWorkspaceFiles.tsx`）只能用这个，不准调 `project_read_file`（那是 agent tool lane unbounded 入口）。
- **Desktop builtin tool sandbox**: 实现在 `apps/desktop/src-tauri/src/builtin_tools.rs`（commit `3f618ce9`），暴露给 employee / YOLO tool pool 的 `read_file` / `write_file` / `bash` 都受 workspace_root 约束 + 硬上限：read 8 MB / write 8 MB / bash 默认输出 1 MB / preview 64 KB。这些 builtin **只在 `gateway` lane 注入**（commit `50c1e296`），SDK lane 永远拿不到。
- **doc-engine 的 xlsx** 走 `package.json` 里的 `"xlsx": "https://cdn.sheetjs.com/..tgz"` (install-time 拉, 非 npm registry) — SheetJS 许可原因
- **仓库已无产品级自动 gate**: 不再保留 husky / 产品 typecheck / 产品 test / 旧 smoke 自动校验链。产品验收走 live agent。
- **2026-04-14 起产品自动测试策略作废**: 过去的 `vitest` / `playwright` / `__VAULT_SMOKE__` / auto-smoke 链已删除。runtime / UI / vault / Tauri 问题走 live agent，不要重建那一套。
- **2026-04-28 起 deterministic harness 是允许形态**: `packages/core/harness/scenarios/*.json` + `packages/core/src/testing/{scenario-runner,invariant-assertions,fake-gateway,replay-gateway,trace-recorder}` + `scripts/harness-{contract,replay,provider-adapter}.mjs`。新增 graph / permission / plan-review / DAG / LLM record-replay 不变量走这条。生产 hash/canonical helper 在 `packages/core/src/utils/`，`testing/canonical-json` 和 `testing/hash` 只保留兼容 re-export；删 testing 文件夹时不要误删生产 util。
- **2D office 方向已改判并已完成主路径切换**: 旧 SVG 2D 路径已经删除。后续不要复活 SVG scene grammar；2D 场景主渲染保持 `canvas`, DOM 只保留文字/tooltip/panel/按钮等交互壳。
- **Project = name + description + 可选 workspace_root + 专属 thread**：`projects.workspace_root` 是 nullable TEXT 列，属于当前单基线 SQLite schema。Tauri 端 `tauri-plugin-dialog` + `tauri-plugin-opener` 已注册，capabilities 含 `dialog:allow-open` / `opener:allow-reveal-item-in-dir` / `opener:allow-open-path`。folder picker SSOT 在 `packages/ui-office/src/lib/folder-picker.ts`（其他组件不直接 import `@tauri-apps/plugin-{dialog,opener}`）。Web 端 vite alias 把这两个 plugin stub 到 `apps/web/src/polyfills/` 下空函数，folder UI 走 disabled hint。`ProjectService.createProject` 改成对象参数 `{ name, description?, workspaceRoot? }`（不再 positional）。Project picker 已交付 desktop workspace file tree：`project_list_dir` + `project_read_file` 受 workspace_root 约束，浏览器显示 desktop-only 状态。
- **Layout-shift contract**: `layout-shift-stability` capability owns CLS budgets. Tabs unmount policy SSOT is `TABS_RETAIN_STATE_CLASS` in `@offisim/ui-core`; web self-hosts Inter + JetBrains Mono variable woff2 with `font-display: swap`.
- **3D lighting/material contract**: `SceneLightingRig` + `scene-performance-tier.ts` own 3D light tiers, FPS soft downgrade, dev hot toggles, PCF soft shadows, and post-processing. Prefab 3D materials must go through `theme/scene-materials.tsx`; no inline prefab hex / `roughness=` / `metalness=` / `transmission=` literals.
- **Responsive workspace contract**: workspace topology uses `useLayoutTier()` as SSOT. Tailwind breakpoints are cosmetic only; peer workspace layout changes must satisfy desktop/tablet/narrow decision rows.

## Ground Truth

- 产品方向："过程即价值"——凡是系统做了的事，玩家必须能看到、理解、干预
- 业务逻辑真相在代码里
- 稳定能力的规范化描述落在 `openspec/specs/`，采用 refactor-first-then-spec 流程（先把代码从屎山状态重构出来，再把稳定结构落成 spec）。已覆盖列表直接看目录。

## Truth-source priority (AI 接手必读)

当信息冲突时，严格按此顺序信任：

1. **代码 + `git log`** — 唯一活真相
2. **本 CLAUDE.md + 子包 CLAUDE.md** — 人肉维护的规则与 gotchas
3. **`openspec/specs/`** — 稳定能力的规范化描述，未覆盖的 capability 仍以代码为准
4. **`Docs/` 下的 working notes** — 信息参考，不是契约

**规则：AI 开工前先 `git log --oneline -10` 核对最近 commit。openspec / CLAUDE.md 与 git 冲突时，永远信 git；发现冲突即刻更新上层文档，不要沉默地跳过。**

## OpenSpec Archive Gate (T1.4 — 2026-04-19 起强制)

每次 `/opsx:archive` 之前，Claude **必须**跑以下三查，任一项不过禁止 archive：

1. **Spec 一致性**：change 的 `specs/<capability>/spec.md` 是否仍表达真实落地 scope？落地和 spec 的用词 / 字段 / 流程有偏差时，先更新 spec，再 archive。
2. **Tasks 一致性**：`tasks.md` 所声称 `[x] 已完成` 的项是否真的落地？live verify 是否真跑了？有 "部分通过" 不许悄悄勾，必须保留未勾 + 补 verify record 节说明。
3. **文档 / 注释一致性**：相关 CLAUDE.md / README / `openspec/specs/` / 代码内 JSDoc 是否还在输出过期 claim？若发现过期，同一 change 内补上。

**此外**：若 change 碰到 `openspec/protocols-ledger.md` 列出的任何协议 / SDK / 标准（A2A / MCP / Tauri / LangGraph / Better Auth / SKILL.md / agentskills.io），**必须同步更新台账相应行**（`Repo claim` + `一致？` + `下一步`）。

**原因**：A2A 2026-04-14→18 翻盘事件证明 spec / tasks / code / docs 与上游协议的同步纪律若不常规化，几个月内就会累积出"产品已经前进、底层口径停旧版"的冒烟风险。Archive gate 是制度化防线。

**为什么写这里不写 openspec skill**：Claude 开工前读 CLAUDE.md 是硬规则（Truth-source priority #2），openspec skill 只在触发时读。

## License and Key Model

Open source (MIT), BYO-key. 浏览器直调 vendor API, 无代理。

### Web Provider Defaults

- `apps/web/vite.config.ts` dev 模式会从 **repo root `.env.local`** 读取 `MINIMAX_*`，并注入成 `VITE_MINIMAX_*`
- `packages/ui-office/src/lib/provider-config.ts` 在 **没有本地已保存 ProviderConfig** 时，会自动用 env 起一个 `MiniMax Global` 默认配置
- 这条能力的目标是 **web live AI 验证 / 演示 / 轻量入口**，不是替代 Tauri 的正式本地工作流
- 若 UI 没显示 key，不要先假设 env 没读到：浏览器侧优先看当前 provider label / model / live request 是否真走 MiniMax；桌面侧 secure key 可能被 secret store 掩码

### Live Product Findings

- `web` live：真实 MiniMax 请求跑通，底部 token / cost / latency 都是真值
- **Agent SDK execution lanes 已正式开放（commits `3e99f940` `feat: add agent sdk execution lanes` + `d5e0f4c9` `Add SOP-driven dual runtime engine support`）**：核心员工 runtime 现走 4 lane —— `gateway`（默认 HTTP）、`claude-agent-sdk`、`codex-agent-sdk`、`openai-agents-sdk`。Tauri 侧统一注册在 `apps/web/src/lib/tauri-engine-adapters.ts`；trusted host 命令对应 `claude_agent_execute` / `codex_agent_execute`，sidecars 在 `apps/desktop/src-tauri/src/{claude,codex}_agent_host.rs` + `resources/codex-agent-host.mjs`；Web 不注入 fetch 仍走 SDK 默认 transport。Provider 元数据 catalog 在 `catalog/provider-source-registry/` (commit `61427aab`)。**1.0 交付口径**：SDK lane 是 text/reasoning-only，不是 Offisim tool lane；文件、shell、memory、todo、skill、MCP、builtin tool 只允许在 `gateway` lane 暴露和验收，不能把 SDK lane 文本回复当作工具执行证据。SDK adapter 收到 tool request 必须 fail closed；local file/shell routing 不能选择 external A2A 员工。
- chat 一轮 streaming fix 已落（`fix-chat-streaming-ux` archived），但仍非强感知 streaming；二次迭代目标是正文 chunk 在气泡里增长
- 2D DiceBear 卡通头像和 3D 块人两种渲染引擎，颜色优先级 = `persona_json.appearance` 在则用 appearance；不在则 fallback `outfitColorFromSeed(seed)` / `skinToneFromSeed(seed)` / `hairColorFromSeed(seed)` / accent seed resolver。统一入口 `resolveOutfitColor(seed, appearance?)` / `resolveSkinTone(seed, appearance?)` / `resolveHairColor(seed, appearance?)` / `resolveAccentColor(seed, appearance?)`。DiceBear `top` 走 `HAIR_STYLE_TO_AVATAARS_TOP` v9 enum 映射（bald → `topProbability: 0`）。3D 内部员工几何 SSOT 是 `character-mesh-builder.tsx`：bodyType / gender / hairStyle / clothingAccent 全量渲染；品牌外包员工只复用 shared rig，不消费内部员工发型/五官/vest。`AgentState` 携带 pre-resolved `avatarSeed` + parsed `appearance`，不再保留 `persona_json` 镜像
- A2A 产品抽象 = **品牌外观外包员工**（external employee with brand avatar）。接不同 A2A 产品 → 办公室场景出现对应品牌员工 avatar（OpenClaw / Hermes / Codex 等，发版带内置 **支持列表**；没命中的走 **custom** 通用外包样式）。走员工语义：席位 / zone / ceremony 和内部员工一致，仅 2D+3D 渲染按 brandKey 分支。**不与 DiceBear / 块人内部员工共用资产** —— DiceBear + 块人专供内部员工（核心逻辑），外包员工每 brand 独立 2D+3D 资产
- 历史误判：2026-04-18 前代码里按"外包 department"抽象落过一轮（`ExternalDepartmentDefinition` / `department_dispatcher` / `sourceKind:'department'` / `assigneeKind:'department'`）。**产品没有"外包 department"概念**，只有内部 department 是正常业务抽象。Phase 2b 3-change 翻盘：schema + dispatch → brand avatar → install 入口

## Interop

外部 agent 接入 = **A2A only** (HTTP JSON-RPC, `packages/core/src/a2a/`)。
OpenClaw 旧 gateway / SKILL.md 文件导入 / 旧 role string 场景分支已于 2026-04-14 全量移除；OpenClaw 作为 A2A brand avatar 仍保留在外包员工支持列表中。未来若要接入带品牌外观的外包员工, 按 A2A agent card 元数据路由, 不要复活旧 role string 分支。
