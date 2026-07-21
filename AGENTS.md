# 对话
- 中文回答。

# 完整交付硬规则
- 禁止把“最小化交付 / MVP / 先做核心 / 先过编译”当作用户要求任务的完成口径。用户交给 Codex 执行时，默认目标是完整交付整个 scope。
- 完整交付包含：实现真实修复、同步 spec / docs / task 状态、跑要求的构建与门禁、完成必要的 release / live runtime 验收、记录证据与未完成项。
- 不允许在“部分实现 / 大部分 task 勾选 / 编译通过 / harness 通过 / 找到 blocker 但未闭环”时声称完成。
- 如果遇到凭证、外部服务、设备不可达、破坏性风险或产品决策无法合理推断等真实阻塞，必须明确标成“未完整交付”，保留未勾 task / tag gate / archive gate，不得用 known limitation 或口头解释替代验收。
- 发现额外真实 blocker 时，先修能修的部分并记录证据；不能修的要直接 surface 根因和下一步所需条件，不要缩小 scope 后交付。
- 当前实现事实：生产 live chat 通过 `DesktopAgentRuntimeGateway` 装配 Pi API 引擎及 Codex、Claude Code CLI 编排适配器；每个 run 只走一个 lane，能力 manifest 决定可见控件。
- 目标产品定义：Offisim 是 engine-neutral 的桌面 AI 工作台。`DesktopAgentRuntime` 是唯一 production engine gateway；Pi/API 引擎与 Codex/Claude Code 外部 CLI 编排引擎可以并存，每个 run 只由一个 engine lane 负责，不能混 lane，也不能把外部 CLI 伪装成 Pi provider。
- Settings 的 AI Accounts 壳分两区：API 引擎区编辑 Pi 自管的 provider/model 配置并显示安全摘要；编排引擎区只显示 CLI 安装、登录、版本与官方指引。外部 CLI 的凭据、模型和订阅用量归 CLI 自管，Offisim 不复制、不校验 catalog、不核算账户健康或 API 成本。
- API 引擎允许用户在 Pi `models.json` 中配置的动态 provider/model；用户自配模型的 source 元数据可选。外部 CLI 编排引擎不暴露 Offisim 模型选择器，任务只记录引擎实际返回的 token 数与时长，并标注“订阅内 · 无 API 成本”。
- Project、Offisim Conversation、Native Agent Home/Session/Memory、effective task workspace 是四层。Codex/Claude/Pi 原生 session、compaction、global memory 仍归各自 Agent Home；Offisim 只保存 opaque ref 和安全投影。删除 Project folder 不得删除或项目化这些原生数据。
- 当前架构目标见 `Docs/architecture/2026-07-13-engine-neutral-ai-accounts.md`；旧 `2026-06-18-pi-agent-only-runtime.md` 只保留历史实现背景，不再是产品方向门禁。

# 未上线 / Vibe Coding 债务护栏
- 当前阶段：Offisim 已确认未上线；没有真实用户、生产数据或必须保护的历史兼容合同。不要为了旧本地状态新增迁移、兼容、fallback 或最小补丁。
- 即使完成大清洁，当前干净状态仍然只是 prelaunch baseline，不是上线后的兼容合同；未来不得因为“曾经清理过”重新引入生产迁移、历史兼容、rollout 或 fallback 债务。
- 未上线项目的默认策略不是做 MVP 小补丁，而是把目标行为做完整、直达、可验证。禁止用“先最小可行 / 先临时兜底 / 以后迁移”作为交付口径。
- 看到 `legacy` / `compat` / `fallback` / `migration` / `backfill` / `rollout` / `temporary` / `post-launch` 时，先分类：真实用户数据、外部契约、安全边界、Pi wire、MCP、安装包格式、deep link、project file sandbox 默认保留；纯粹因为 AI 误判已上线而存在的层，走 `prelaunch-assumption-convergence-loop` 分流到最小合适 loop。
- 本地 SQLite 当前事实：`LOCAL_SCHEMA_VERSION` 真值以 `apps/desktop/src-tauri/src/local_db.rs` 常量为准（文档不重复数字），fresh DB 直接应用当前 baseline `schema.sql`；`packages/db-local/src/migrations/` 不保留历史迁移 SQL。旧本地库和无 stamp 库是可丢弃开发产物，删除后由 app 重建。
- 详细策略见 `Docs/architecture/2026-07-02-prelaunch-vibe-debt-policy.md`。这份文档是后续 agent 判断伪迁移、伪兼容和 vibe-coding debt 的入口。

# 当前架构决策（2026-05-18）
- 开源前结构目标是生产级可维护拆分。
- Offisim 只保留 Tauri v2 桌面产品；不要新增独立 web、browser runtime 或 launcher 产品工作。
- React renderer 位于 `apps/desktop/renderer`，归 desktop ownership；仓库不再保留 standalone web package。
- launcher 已删除；相关端口、脚本、docs、验证路径不得恢复。
- Tauri 仍需要 WebView renderer，所以删除 web 产品不等于删除 React UI；正确方向是把 renderer 收到 desktop ownership 下。
- 最终验收只认当前 worktree 的 release `.app` + Computer Use 真实交互；localhost、dev server、dev webview、browser screenshot 只能作为排查证据。

# UI 框架决策（2026-05-25）
- 新 UI 框架 source of truth 是 `Docs/UI_FRAMEWORK_STACK.md`；设计 source of truth 是 `Docs/design/.v3-dna-brief.md` 和同目录原型。
- Approved stack: React 19 + Vite + Tauri renderer, Tailwind CSS v4, shadcn/ui, assistant-ui, Motion for React (`motion/react`), lucide-react, TanStack Query, Zustand, React Hook Form + Zod, dnd-kit, TanStack Virtual, react-resizable-panels, cmdk, Sonner, Recharts。
- UI ownership 留在 `apps/desktop/renderer`。不要重建共享视觉 UI package；shared packages 只能承载类型、runtime/data contract，不承载视觉组件库。
- Tailwind 只做 token/utility 编译层；shadcn 只做本地 accessible primitives；assistant-ui 只做 assistant surface/runtime primitives；Motion 只做统一动态语法。任何库都不能覆盖 Offisim V3 dense HUD 设计语言。
- 禁止新引入非批准动画框架、组件套件或 CSS-in-JS 层，除非另有明确架构决策。
- 桌面 renderer root / shell / lifecycle 入口禁止再添加外圈 margin、padding、gutter、黑色外框或 `calc(100% - 16px)` 式缩边。WebView 内容必须贴齐可绘制区域；层级和呼吸感只能在内部 panel / toolbar / rail 里处理，不能靠外圈留黑边。

# 验证 / 测试准则
- 不在 `packages/core/src/**/*.test.mjs` 新增或保留 runtime / graph / product 行为测试。
- 当前 Pi adapter 新不变量仍必须走 `scripts/harness-pi-agent-host.mjs`（`pnpm harness:pi-agent-host`，已接入 `pnpm validate`）。production gateway 与跨 engine 不变量走 runtime conformance + engine-specific harness；Codex/Claude 编排引擎只有真实 task、独立 secret boundary、能力声明和 release `.app` 证据齐全才算支持。LangGraph / 自研 pi-loop 时代的 runtime gate 不再作为主路径验收。
- 临时 `node --test` 只允许作为本地探索，不进 git；不要通过给 `packages/core/package.json` 加 `test` script 或 CI gate 来恢复普通 product 自动测试。
- 如果 review 发现源内 `.test.mjs` 和 harness 重复，优先删除源内测试，把仍有价值的不变量迁到 harness。

# Desktop / Computer Use 验收
- 本项目不允许把 dev webview、dev server、dev SPA、localhost 浏览器结果当作桌面端或端到端验收；这些只允许作为本地排查手段，不能写入 live verify / release verify 证据，也不能据此勾验收 task。
- 所有桌面端 live verify / release verify 必须测 release `.app` 本体，并优先用 Computer Use 附着 release app 完成真实交互截图。
- 用 Computer Use 测 Tauri 桌面端时，默认测 release `.app`，不要把 dev webview 结果当作最终桌面验收。
- 验收前先执行桌面 release build，再启动 `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`。
- 若 dev 能跑但 release `.app` 不可交互、黑屏、或 Computer Use 无法附着，按 release 桌面阻塞处理，先查清原因再继续依赖桌面验收结论。
- 桌面 renderer 承载 `Docs/UI_FRAMEWORK_STACK.md` 定义的新 UI 框架。桌面验收直接构建当前 renderer 和 `@offisim/desktop`，不得引入外部桌面 UI 包或预构建 dist 路径。
- release `.app` 启动必须用当前 worktree 的精确 `.app` 路径，不能用 `open -b com.offisim.desktop` 这类 bundle id 方式；多个 worktree 共享 bundle id 时会误附着旧包。
- release `.app` 的窗口附着、截图、点击、关闭、前台切换必须用 Computer Use；不要用 `osascript` / AppleScript 充当桌面验收或窗口控制工具。
- Project workspace 文件浏览必须走 `project_list_dir` / `project_read_file` 这组受 `workspace_root` sandbox 约束的 Tauri command；不要在 webview 里直接用 `tauri-plugin-fs` 读项目目录。

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Offisim** (22368 symbols, 47205 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/Offisim/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Offisim/clusters` | All functional areas |
| `gitnexus://repo/Offisim/processes` | All execution flows |
| `gitnexus://repo/Offisim/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
